import { createHash } from 'node:crypto';
import type { Actor, Checkout, CoachNotification, Fee, FeeStore, PaymentRail } from '../../contracts/billing.js';
import type { Records } from './firestore.js';
import { HttpError } from './http.js';

type Order = Checkout & { parentUid: string };
export type CollectionReservation = { rail: PaymentRail; reference: string };

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const paymentKey = (rail: PaymentRail, id: string) => `${rail}-${digest(id)}`;

export function paymentNotification(fee: Fee, occurredAt: string): CoachNotification & { playerId: string } {
  return {
    id: `payment-completed-${fee.id}`, kind: 'payment_completed', subjectLabel: fee.playerName,
    amountPaise: fee.amountPaise, occurredAt, playerId: fee.playerId,
  };
}

export function createFeeStore(records: Records): FeeStore {
  const { db, ref, read, collection, scenario } = records;
  return {
    findActor: uid => read<Actor>('actors', uid),
    findFee: (period, playerId) => read<Fee>('fees', `${playerId}-${period}`),

    async createFee(actor, period, amountPaise) {
      const id = `${actor.playerId}-${period}`;
      return db.runTransaction(async tx => {
        const existing = await read<Fee>('fees', id, tx);
        if (existing) {
          if (existing.amountPaise === amountPaise) return existing;
          throw new HttpError(409, 'FEE_CONFLICT', 'A fee for this month already exists with a different amount.');
        }
        const fee: Fee = {
          id, playerId: actor.playerId, playerName: actor.playerName, period, amountPaise, currency: 'INR', status: 'unpaid',
        };
        tx.create(ref('fees', id), fee);
        return fee;
      });
    },

    async listNotifications(actor) {
      const snapshots = await collection('notifications').where('playerId', '==', actor.playerId).get();
      return snapshots.docs
        .map(snapshot => snapshot.data() as CoachNotification & { coachUid?: string })
        .filter(notification => !notification.coachUid || notification.coachUid === actor.uid)
        .map(({ id, kind, subjectLabel, amountPaise, occurredAt }) => ({ id, kind, subjectLabel, amountPaise, occurredAt }))
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    },

    async listPaidFees(actor, period) {
      if (actor.role !== 'coach') throw new HttpError(403, 'FORBIDDEN', 'Only a coach can view paid fees.');
      const roster = Array.isArray(actor.coachPlayerIds) ? actor.coachPlayerIds : [];
      const playerIds = [...new Set([actor.playerId, ...roster.filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id))])];
      const snapshots = await db.getAll(...playerIds.map(playerId => ref('fees', `${playerId}-${period}`)));
      return snapshots
        .flatMap((snapshot, index) => {
          const fee = snapshot.data() as Fee | undefined;
          if (fee?.status !== 'paid' || fee.playerId !== playerIds[index] || fee.period !== period) return [];
          return [{
            feeId: fee.id, playerName: fee.playerName,
            amountPaise: fee.amountPaise, netPaise: fee.amountPaise - (fee.refundedPaise ?? 0),
          }];
        })
        .sort((left, right) => left.playerName.localeCompare(right.playerName));
    },

    async reserveCheckout(uid, feeId) {
      return db.runTransaction(async tx => {
        const orderId = `cs-${digest(`${scenario}:${feeId}`).slice(0, 30)}`;
        const [parent, fee, existing, reservation] = await Promise.all([
          read<Actor>('actors', uid, tx), read<Fee>('fees', feeId, tx), read<Order>('orders', orderId, tx),
          read<CollectionReservation>('collections', feeId, tx),
        ]);
        if (parent?.role !== 'parent' || !parent.customer || fee?.playerId !== parent.playerId) {
          throw new HttpError(404, 'FEE_NOT_FOUND', 'The fee was not found.');
        }
        if (fee.status === 'paid') throw new HttpError(409, 'FEE_ALREADY_PAID', 'This fee is already paid.');
        if (existing?.parentUid === uid) return checkoutView(existing);
        if (existing || reservation) throw new HttpError(409, 'COLLECTION_IN_PROGRESS', 'A collection path is already active.');
        const order: Order = { feeId, orderId, amountPaise: fee.amountPaise, currency: fee.currency, customer: parent.customer, parentUid: uid };
        tx.update(ref('fees', feeId), { status: 'processing' });
        tx.create(ref('orders', orderId), order);
        tx.create(ref('collections', feeId), { rail: 'pg', reference: orderId });
        return checkoutView(order);
      });
    },

    async getCheckout(uid, orderId) {
      const [parent, order] = await Promise.all([read<Actor>('actors', uid), read<Order>('orders', orderId)]);
      if (parent?.role === 'parent' && order?.parentUid === uid) {
        const fee = await read<Fee>('fees', order.feeId);
        if (fee?.playerId === parent.playerId) return checkoutView(order);
      }
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'The checkout order was not found.');
    },

    async applyVerifiedPayment(orderId, providerPaymentId, amountPaise) {
      if (!providerPaymentId || providerPaymentId.length > 128) {
        throw new HttpError(400, 'INVALID_PAYMENT_ID', 'A valid provider payment reference is required.');
      }
      return db.runTransaction(async tx => {
        const order = await read<Order>('orders', orderId, tx);
        if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'The checkout order was not found.');
        const id = paymentKey('pg', providerPaymentId);
        const [fee, payment, reservation] = await Promise.all([
          read<Fee>('fees', order.feeId, tx), read('payments', id, tx),
          read<CollectionReservation>('collections', order.feeId, tx),
        ]);
        if (!fee || amountPaise !== order.amountPaise || fee.amountPaise !== order.amountPaise || fee.currency !== order.currency
          || reservation?.rail !== 'pg' || reservation.reference !== orderId) {
          throw new HttpError(409, 'PAYMENT_MISMATCH', 'The fee and verified order require reconciliation.');
        }
        const result = { feeId: fee.id, feeStatus: 'paid' as const };
        if (fee.status === 'paid' && fee.providerPaymentId === providerPaymentId && (fee.paymentRail ?? 'pg') === 'pg') return result;
        if (fee.status === 'paid' || payment) {
          throw new HttpError(409, 'DUPLICATE_COLLECTION', 'A conflicting payment requires reconciliation.');
        }
        const occurredAt = new Date().toISOString();
        tx.update(ref('fees', fee.id), { status: 'paid', providerPaymentId, paymentRail: 'pg' });
        tx.create(ref('payments', id), { feeId: fee.id, orderId, providerPaymentId, amountPaise: fee.amountPaise, currency: fee.currency, occurredAt });
        tx.create(ref('notifications', fee.id), paymentNotification(fee, occurredAt));
        return result;
      });
    },
  };
}

function checkoutView({ parentUid: _parentUid, ...checkout }: Order): Checkout {
  return checkout;
}
