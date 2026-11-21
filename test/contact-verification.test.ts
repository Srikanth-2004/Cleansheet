import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Actor } from '../src/contracts/billing.js';
import { createContactVerification, createSecureIdSandboxProvider, type OtpProvider } from '../src/lib/server/contact-verification.js';
import type { documentClient } from '../src/lib/server/dynamo-store.js';

const parent: Actor = {
  role: 'parent', uid: 'parent', playerId: 'demo-player', playerName: 'Demo Player', academyName: 'Demo', teamName: 'U12',
  customer: { id: 'parent', name: 'Demo Parent', email: 'parent@example.invalid', phone: '9999999999' },
};

test('the Secure ID adapter confirms only a matching response and returns only its reference', async () => {
  const request: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://sandbox.cashfree.com/verification/mobile360/otp/verify');
    assert.deepEqual(JSON.parse(String(init?.body)), { verification_id: 'cs-test', otp: '123456' });
    return Response.json({ verification_id: 'cs-test', reference_id: 1234, status: 'SUCCESS', personal_details: { full_name: 'fixture' } });
  };
  const adapter = createSecureIdSandboxProvider({ clientId: 'fixture', clientSecret: 'fixture' }, request);
  assert.deepEqual(await adapter.verify('cs-test', '123456'), { referenceId: '1234' });
  const wrongRef = createSecureIdSandboxProvider({ clientId: 'fixture', clientSecret: 'fixture' }, async () => {
    return Response.json({ verification_id: 'different', reference_id: 1234, status: 'SUCCESS' });
  });
  await assert.rejects(wrongRef.verify('cs-test', '123456'), { code: 'SECURE_ID_RESPONSE_INVALID' });
});

test('a mismatched number or a different parent never reaches the OTP provider', async () => {
  const blocked = async () => { throw new Error('The OTP provider must not be called'); };
  const provider: OtpProvider = { send: blocked, verify: blocked };
  const db = { send: async (command: GetCommand) => {
    assert.equal(command.input.Key?.sk, 'CONTACT#other-parent');
    return {};
  } } as unknown as typeof documentClient;
  const verification = createContactVerification({ table: 'fixture', pk: 'fixture' }, db, provider);
  await assert.rejects(verification.start(parent, '8888888888', 'v1'), { code: 'CONTACT_NOT_LINKED' });
  await assert.rejects(verification.verify({ ...parent, uid: 'other-parent' }, 'cs-other-challenge', '123456'), { code: 'CHALLENGE_NOT_FOUND' });
});

test('the request records consent and the masked number, and an expired challenge cannot be verified', async () => {
  let put: PutCommand | undefined;
  const db = { send: async (command: PutCommand | GetCommand | UpdateCommand) => {
    if (command instanceof PutCommand) { put = command; return {}; }
    if (command instanceof GetCommand) return { Item: put?.input.Item };
    if (command.input.UpdateExpression?.includes('ADD attempts')) {
      assert.match(command.input.ConditionExpression ?? '', /expiresAt > :now AND attempts < :limit/);
      throw Object.assign(new Error(), { name: 'ConditionalCheckFailedException' });
    }
    return {};
  } } as unknown as typeof documentClient;
  const service = createContactVerification({ table: 'fixture', pk: 'fixture' }, db, {
    send: async input => { assert.equal(input.phone, '9999999999'); },
    verify: async () => { throw new Error('An unavailable challenge cannot call the provider'); },
  });
  const challenge = await service.start(parent, '+919999999999', 'v1');
  assert.equal(challenge.maskedPhone, '******9999');
  assert.equal(put?.input.Item?.consentVersion, 'v1');
  assert.doesNotMatch(JSON.stringify(put?.input.Item), /9999999999/);
  await assert.rejects(service.verify(parent, challenge.challengeId, '123456'), { code: 'CHALLENGE_UNAVAILABLE' });
});
