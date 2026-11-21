import { randomUUID } from 'node:crypto';
import type { Actor } from '../../contracts/billing.js';
import type { Records } from './firestore.js';
import { HttpError } from './http.js';

const challengeMs = 5 * 60_000;
const resendMs = 60_000;
const maxAttempts = 5;

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

export function createContactVerification(records: Records, provider: OtpProvider): ContactVerification {
  const { db, read, ref } = records;

  async function transition(uid: string, challengeId: string, from: ContactRecord['step'], updates: object) {
    return db.runTransaction(async tx => {
      const record = await read<ContactRecord>('contacts', uid, tx);
      if (record?.challengeId !== challengeId || record.step !== from) {
        throw new HttpError(409, 'CHALLENGE_UNAVAILABLE', 'The contact challenge is no longer current.');
      }
      tx.update(ref('contacts', uid), updates);
    });
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
      const expiresAt = now + challengeMs;
      await db.runTransaction(async tx => {
        const current = await read<ContactRecord>('contacts', actor.uid, tx);
        if (current?.status === 'verified') throw new HttpError(409, 'CONTACT_ALREADY_VERIFIED', 'This parent contact is already verified.');
        if (current && (current.resendAfter > now || (current.step === 'verifying' && current.expiresAt > now))) {
          throw new HttpError(429, 'CONTACT_RETRY_LATER', 'Wait before starting another verification.');
        }
        tx.set(ref('contacts', actor.uid), {
          challengeId, maskedPhone, status: 'pending', step: 'sending', expiresAt,
          resendAfter: now + resendMs, attempts: 0, consentAt, consentVersion,
        });
      });
      try {
        await provider.send({ verificationId: challengeId, phone, consentAt });
      } catch (error) {
        await transition(actor.uid, challengeId, 'sending', { step: 'done', status: 'blocked' });
        throw error;
      }
      await transition(actor.uid, challengeId, 'sending', { step: 'ready' });
      return { challengeId, maskedPhone, expiresAt: new Date(expiresAt).toISOString() };
    },

    async verify(actor, challengeId, otp) {
      if (actor.role !== 'parent') throw new HttpError(403, 'FORBIDDEN', 'Access is denied.');
      const record = await db.runTransaction(async tx => {
        const current = await read<ContactRecord>('contacts', actor.uid, tx);
        if (current?.challengeId !== challengeId) throw new HttpError(404, 'CHALLENGE_NOT_FOUND', 'The current contact challenge was not found.');
        if (current.status === 'verified') return current;
        if (current.step !== 'ready' || current.expiresAt <= Date.now() || current.attempts >= maxAttempts) {
          throw new HttpError(409, 'CHALLENGE_UNAVAILABLE', 'This challenge is expired, in progress, or has reached its attempt limit.');
        }
        tx.update(ref('contacts', actor.uid), { step: 'verifying', attempts: current.attempts + 1 });
        return current;
      });
      const result = { contactStatus: 'verified' as const, maskedPhone: record.maskedPhone };
      if (record.status === 'verified') return result;

      let providerReference: string;
      try {
        providerReference = (await provider.verify(challengeId, otp)).referenceId;
      } catch (error) {
        const rejected = error instanceof HttpError && error.code === 'OTP_REJECTED';
        await transition(actor.uid, challengeId, 'verifying', rejected ? { step: 'ready' } : { step: 'done', status: 'blocked' });
        throw error;
      }
      await transition(actor.uid, challengeId, 'verifying', {
        step: 'done', status: 'verified', verifiedAt: new Date().toISOString(), providerReference,
      });
      return result;
    },
  };
}

function indianMobile(phone: string | undefined) {
  const digits = phone?.trim().replace(/^\+91[ -]?/, '');
  return digits && /^[6-9][0-9]{9}$/.test(digits) ? digits : undefined;
}
