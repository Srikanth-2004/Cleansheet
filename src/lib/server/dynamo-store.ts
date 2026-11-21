import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Actor, Checkout, CoachNotification, Fee, FeeStore } from '../../contracts/billing.js';
import { HttpError } from './http.js';

type Key = { pk: string; sk: string };
type OrderRecord = Checkout & { parentUid: string };

export const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const isConditionalError = (error: unknown) => error instanceof Error
  && ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(error.name);

export function getStorageConfig() {
  const table = process.env.CLEANSHEET_DYNAMODB_TABLE;
  const scenario = process.env.CLEANSHEET_SCENARIO_ID;
  if (!table || !scenario || !/^[a-zA-Z0-9_-]{1,64}$/.test(scenario)) {
    throw new HttpError(503, 'STORE_UNAVAILABLE', 'The demo data store is not configured.');
  }
  return { table, pk: `DEMO#${scenario}` };
}

export function createDynamoFeeStore(
  config = getStorageConfig(),
  db = documentClient,
): FeeStore {
  const { table, pk } = config;
  const key = (sk: string): Key => ({ pk, sk });
  async function read<T>(sk: string) {
    const response = await db.send(new GetCommand({ TableName: table, Key: key(sk), ConsistentRead: true }));
    return response.Item as (T & Key) | undefined;
  }

  async function findActor(uid: string) {
    return read<Actor>(`ACTOR#${uid}`);
  }

  async function readOrder(orderId: string) {
    return read<OrderRecord>(`ORDER#${orderId}`);
  }

  return {
    findActor,

    async findFee(period, playerId) {
      return read<Fee>(`FEE#${playerId}-${period}`);
    },

    async createFee(actor, period, amountPaise) {
      const id = `${actor.playerId}-${period}`;
      const sk = `FEE#${id}`;
      const fee: Fee = {
        id, playerId: actor.playerId, playerName: actor.playerName,
        period, amountPaise, currency: 'INR', status: 'unpaid',
      };
      try {
        await db.send(new PutCommand({
          TableName: table, Item: { ...key(sk), ...fee }, ConditionExpression: 'attribute_not_exists(pk)',
        }));
        return fee;
      } catch (error) {
        if (!isConditionalError(error)) throw error;
        const existing = await read<Fee>(sk);
        if (!existing) throw error;
        if (existing.amountPaise === amountPaise) return existing;
        throw new HttpError(409, 'FEE_CONFLICT', 'A fee for this month already exists with a different amount.');
      }
    },

    async listNotifications() {
      const response = await db.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': 'NOTIFICATION#' },
        ProjectionExpression: 'id, kind, subjectLabel, amountPaise, occurredAt',
        ConsistentRead: true,
      }));
      return (response.Items as CoachNotification[] | undefined ?? [])
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    },

    async reserveCheckout(uid, feeId) {
      const [parent, fee] = await Promise.all([findActor(uid), read<Fee>(`FEE#${feeId}`)]);
      if (parent?.role !== 'parent' || !parent.customer || !fee || fee.playerId !== parent.playerId) {
        throw new HttpError(404, 'FEE_NOT_FOUND', 'The fee was not found.');
      }
      if (fee.status === 'paid') throw new HttpError(409, 'FEE_ALREADY_PAID', 'This fee is already paid.');

      const orderId = `cs-${digest(`${pk}:${feeId}`).slice(0, 30)}`;
      const existing = await readOrder(orderId);
      if (existing?.parentUid === uid) return checkoutView(existing);
      const collectionKey = `COLLECTION#${feeId}`;
      if (await read(collectionKey)) throw new HttpError(409, 'COLLECTION_IN_PROGRESS', 'A collection path is already active.');
      const order: OrderRecord = {
        feeId, orderId, amountPaise: fee.amountPaise,
        currency: fee.currency, customer: parent.customer, parentUid: uid,
      };
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [
          { Update: {
            TableName: table, Key: key(`FEE#${feeId}`),
            UpdateExpression: 'SET #status = :processing',
            ConditionExpression: 'attribute_exists(pk) AND #status <> :paid',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':processing': 'processing', ':paid': 'paid' },
          } },
          { Put: { TableName: table, Item: { ...key(`ORDER#${orderId}`), ...order }, ConditionExpression: 'attribute_not_exists(pk)' } },
          { Put: {
            TableName: table, Item: { ...key(collectionKey), rail: 'pg', reference: orderId },
            ConditionExpression: 'attribute_not_exists(pk)',
          } },
        ] }));
      } catch (error) {
        if (!isConditionalError(error)) throw error;
        const reserved = await readOrder(orderId);
        if (reserved?.parentUid === uid) return checkoutView(reserved);
        if (await read(collectionKey)) throw new HttpError(409, 'COLLECTION_IN_PROGRESS', 'A collection path is already active.');
        if ((await read<Fee>(`FEE#${feeId}`))?.status === 'paid') {
          throw new HttpError(409, 'FEE_ALREADY_PAID', 'This fee is already paid.');
        }
        throw error;
      }
      return checkoutView(order);
    },

    async getCheckout(uid, orderId) {
      const [parent, order] = await Promise.all([findActor(uid), readOrder(orderId)]);
      if (parent?.role !== 'parent' || order?.parentUid !== uid) {
        throw new HttpError(404, 'ORDER_NOT_FOUND', 'The checkout order was not found.');
      }
      const fee = await read<Fee>(`FEE#${order.feeId}`);
      if (fee?.playerId !== parent.playerId) throw new HttpError(404, 'ORDER_NOT_FOUND', 'The checkout order was not found.');
      return checkoutView(order);
    },

    async applyVerifiedPayment(orderId, providerPaymentId) {
      if (!providerPaymentId || providerPaymentId.length > 128) {
        throw new HttpError(400, 'INVALID_PAYMENT_ID', 'A valid provider payment reference is required.');
      }
      const order = await readOrder(orderId);
      if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'The checkout order was not found.');
      const feeKey = `FEE#${order.feeId}`;
      const fee = await read<Fee>(feeKey);
      if (!fee || fee.amountPaise !== order.amountPaise || fee.currency !== order.currency) {
        throw new HttpError(409, 'PAYMENT_MISMATCH', 'The fee and verified order require reconciliation.');
      }
      const result = { feeId: fee.id, feeStatus: 'paid' as const };
      if (fee.providerPaymentId === providerPaymentId && fee.status === 'paid') return result;
      if (fee.status === 'paid') throw new HttpError(409, 'DUPLICATE_COLLECTION', 'This fee already has a different payment.');

      const paymentKey = `PAYMENT#PG#${digest(providerPaymentId)}`;
      const occurredAt = new Date().toISOString();
      const notification: CoachNotification = {
        id: `payment-completed-${fee.id}`, kind: 'payment_completed', subjectLabel: fee.playerName,
        amountPaise: fee.amountPaise, occurredAt,
      };
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [
          { Update: {
            TableName: table, Key: key(feeKey),
            UpdateExpression: 'SET #status = :paid, providerPaymentId = :payment',
            ConditionExpression: 'attribute_exists(pk) AND #status <> :paid AND amountPaise = :amount AND currency = :currency',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':paid': 'paid', ':payment': providerPaymentId, ':amount': order.amountPaise, ':currency': order.currency },
          } },
          { Put: {
            TableName: table,
            Item: { ...key(paymentKey), orderId, providerPaymentId, feeId: fee.id, amountPaise: fee.amountPaise, currency: fee.currency, occurredAt },
            ConditionExpression: 'attribute_not_exists(pk)',
          } },
          { Put: {
            TableName: table, Item: { ...key(`NOTIFICATION#${fee.id}`), ...notification },
            ConditionExpression: 'attribute_not_exists(pk)',
          } },
        ] }));
        return result;
      } catch (error) {
        if (!isConditionalError(error)) throw error;
        const current = await read<Fee>(feeKey);
        if (current?.status === 'paid' && current.providerPaymentId === providerPaymentId) return result;
        if (current?.status === 'paid' || await read(paymentKey)) {
          throw new HttpError(409, 'DUPLICATE_COLLECTION', 'A conflicting payment requires reconciliation.');
        }
        throw error;
      }
    },
  };
}

function checkoutView(order: OrderRecord): Checkout {
  return {
    feeId: order.feeId, orderId: order.orderId, amountPaise: order.amountPaise,
    currency: order.currency, customer: order.customer,
  };
}
