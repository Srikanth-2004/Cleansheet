import { randomUUID } from 'node:crypto';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Actor } from '../../contracts/billing.js';
import { documentClient, getStorageConfig } from './dynamo-store.js';
import { HttpError } from './http.js';

const challengeMs = 5 * 60_000;
const resendMs = 60_000;
const maxAttempts = 5;
const isConditional = (error: unknown) => error instanceof Error && error.name === 'ConditionalCheckFailedException';

interface ContactRecord {
  challengeId: string;
  maskedPhone: string;
  status: 'pending' | 'verified' | 'blocked';
  step: 'sending' | 'ready' | 'verifying' | 'done';
  expiresAt: number;
  resendAfter: number;
  attempts: number;
}

export interface ContactVerification {
  start(actor: Actor, phone: string, consentVersion: string): Promise<{ challengeId: string; maskedPhone: string; expiresAt: string }>;
  verify(actor: Actor, challengeId: string, otp: string): Promise<{ contactStatus: 'verified'; maskedPhone: string }>;
}

export interface OtpProvider {
  send(input: { verificationId: string; phone: string; consentAt: string }): Promise<void>;
  verify(verificationId: string, otp: string): Promise<{ referenceId: string }>;
}

export function createSecureIdSandboxProvider(config: { clientId: string; clientSecret: string }, request = fetch): OtpProvider {
  if (!config.clientId || !config.clientSecret) {
    throw new HttpError(503, 'SECURE_ID_UNAVAILABLE', 'Secure ID Sandbox is not configured.');
  }

  async function post(path: 'send' | 'verify', body: object) {
    let response: Response;
    try {
      response = await request(`https://sandbox.cashfree.com/verification/mobile360/otp/${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: {
          'content-type': 'application/json', 'x-api-version': '2024-12-01',
          'x-client-id': config.clientId, 'x-client-secret': config.clientSecret,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new HttpError(502, 'SECURE_ID_UNAVAILABLE', 'Secure ID could not be reached.');
    }
    if (!response.ok) {
      if (path === 'verify' && [400, 422].includes(response.status)) {
        throw new HttpError(422, 'OTP_REJECTED', 'Secure ID did not accept the code.');
      }
      throw new HttpError(502, 'SECURE_ID_UNAVAILABLE', 'Secure ID could not complete the request.');
    }
    try {
      const value: unknown = await response.json();
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // A malformed provider response cannot confirm contact verification.
    }
    throw new HttpError(502, 'SECURE_ID_RESPONSE_INVALID', 'Secure ID returned an unexpected response.');
  }

  return {
    async send({ verificationId, phone, consentAt }) {
      const value = await post('send', {
        verification_id: verificationId, mobile_number: phone, notification_modes: ['SMS'],
        user_consent: { timestamp: consentAt, purpose: 'Verify the linked adult contact for CleanSheet billing.', obtained: true, type: 'EXPLICIT' },
      });
      if (value.verification_id !== verificationId || value.status !== 'OTP_GENERATED') {
        throw new HttpError(502, 'SECURE_ID_RESPONSE_INVALID', 'Secure ID did not confirm the OTP request.');
      }
    },

    async verify(verificationId, otp) {
      const value = await post('verify', { verification_id: verificationId, otp });
      if (value.verification_id !== verificationId) {
        throw new HttpError(502, 'SECURE_ID_RESPONSE_INVALID', 'Secure ID returned a different verification reference.');
      }
      if (value.status !== 'SUCCESS' || typeof value.reference_id !== 'number' || !Number.isSafeInteger(value.reference_id)) {
        throw new HttpError(422, 'OTP_REJECTED', 'Secure ID did not confirm the contact.');
      }
      return { referenceId: String(value.reference_id) };
    },
  };
}

export function createContactVerification(
  config = getStorageConfig(),
  db = documentClient,
  provider = createSecureIdSandboxProvider({
    clientId: process.env.CASHFREE_SECURE_ID_CLIENT_ID ?? '',
    clientSecret: process.env.CASHFREE_SECURE_ID_CLIENT_SECRET ?? '',
  }),
): ContactVerification {
  const { table, pk } = config;
  const key = (uid: string) => ({ pk, sk: `CONTACT#${uid}` });

  async function read(uid: string) {
    const response = await db.send(new GetCommand({ TableName: table, Key: key(uid), ConsistentRead: true }));
    return response.Item as ContactRecord | undefined;
  }

  async function finish(uid: string, challengeId: string, from: ContactRecord['step'], referenceId?: string) {
    const status = referenceId ? 'verified' : 'blocked';
    await db.send(new UpdateCommand({
      TableName: table, Key: key(uid), ConditionExpression: 'challengeId = :challenge AND #step = :from',
      UpdateExpression: referenceId
        ? 'SET #status = :status, #step = :done, verifiedAt = :time, providerReference = :ref'
        : 'SET #status = :status, #step = :done',
      ExpressionAttributeNames: { '#status': 'status', '#step': 'step' },
      ExpressionAttributeValues: {
        ':challenge': challengeId, ':from': from, ':status': status, ':done': 'done',
        ...(referenceId ? { ':time': new Date().toISOString(), ':ref': referenceId } : {}),
      },
    }));
  }

  return {
    async start(actor, inputPhone, consentVersion) {
      const phone = indianMobile(inputPhone);
      if (!phone || actor.role !== 'parent' || phone !== indianMobile(actor.customer?.phone)) {
        throw new HttpError(403, 'CONTACT_NOT_LINKED', 'Use the mobile number linked to the parent account.');
      }
      const now = Date.now();
      const consentAt = new Date(now).toISOString();
      const challengeId = `cs-${randomUUID().replaceAll('-', '')}`;
      const maskedPhone = `******${phone.slice(-4)}`;
      const record: ContactRecord = {
        challengeId, maskedPhone, status: 'pending', step: 'sending', expiresAt: now + challengeMs,
        resendAfter: now + resendMs, attempts: 0,
      };
      try {
        await db.send(new PutCommand({
          TableName: table, Item: { ...key(actor.uid), ...record, consentAt, consentVersion },
          ConditionExpression: 'attribute_not_exists(pk) OR (#status <> :verified AND resendAfter <= :now AND (#step <> :verifying OR expiresAt <= :now))',
          ExpressionAttributeNames: { '#status': 'status', '#step': 'step' },
          ExpressionAttributeValues: { ':verified': 'verified', ':verifying': 'verifying', ':now': now },
        }));
      } catch (error) {
        if (!isConditional(error)) throw error;
        const current = await read(actor.uid);
        if (current?.status === 'verified') throw new HttpError(409, 'CONTACT_ALREADY_VERIFIED', 'This parent contact is already verified.');
        throw new HttpError(429, 'CONTACT_RETRY_LATER', 'Wait before starting another verification.');
      }

      try {
        await provider.send({ verificationId: challengeId, phone, consentAt });
      } catch (error) {
        await finish(actor.uid, challengeId, 'sending');
        throw error;
      }
      await db.send(new UpdateCommand({
        TableName: table, Key: key(actor.uid), ConditionExpression: 'challengeId = :challenge AND #step = :sending',
        UpdateExpression: 'SET #step = :ready', ExpressionAttributeNames: { '#step': 'step' },
        ExpressionAttributeValues: { ':challenge': challengeId, ':sending': 'sending', ':ready': 'ready' },
      }));
      return { challengeId, maskedPhone, expiresAt: new Date(record.expiresAt).toISOString() };
    },

    async verify(actor, challengeId, otp) {
      if (actor.role !== 'parent') throw new HttpError(403, 'FORBIDDEN', 'Access is denied.');
      const record = await read(actor.uid);
      if (!record || record.challengeId !== challengeId) {
        throw new HttpError(404, 'CHALLENGE_NOT_FOUND', 'The current contact challenge was not found.');
      }
      const result = { contactStatus: 'verified' as const, maskedPhone: record.maskedPhone };
      if (record.status === 'verified') return result;

      try {
        await db.send(new UpdateCommand({
          TableName: table, Key: key(actor.uid),
          ConditionExpression: 'challengeId = :challenge AND #step = :ready AND expiresAt > :now AND attempts < :limit',
          UpdateExpression: 'SET #step = :verifying ADD attempts :one',
          ExpressionAttributeNames: { '#step': 'step' },
          ExpressionAttributeValues: {
            ':challenge': challengeId, ':ready': 'ready', ':now': Date.now(), ':limit': maxAttempts,
            ':verifying': 'verifying', ':one': 1,
          },
        }));
      } catch (error) {
        if (!isConditional(error)) throw error;
        throw new HttpError(409, 'CHALLENGE_UNAVAILABLE', 'This challenge is expired, in progress, or has reached its attempt limit.');
      }

      let verified: { referenceId: string };
      try {
        verified = await provider.verify(challengeId, otp);
      } catch (error) {
        if (error instanceof HttpError && error.code === 'OTP_REJECTED') {
          await db.send(new UpdateCommand({
            TableName: table, Key: key(actor.uid), ConditionExpression: 'challengeId = :challenge AND #step = :verifying',
            UpdateExpression: 'SET #step = :ready', ExpressionAttributeNames: { '#step': 'step' },
            ExpressionAttributeValues: { ':challenge': challengeId, ':verifying': 'verifying', ':ready': 'ready' },
          }));
        } else {
          await finish(actor.uid, challengeId, 'verifying');
        }
        throw error;
      }
      await finish(actor.uid, challengeId, 'verifying', verified.referenceId);
      return result;
    },
  };
}

function indianMobile(phone: string | undefined) {
  const digits = phone?.trim().replace(/^\+91[ -]?/, '');
  return digits && /^[6-9][0-9]{9}$/.test(digits) ? digits : undefined;
}
