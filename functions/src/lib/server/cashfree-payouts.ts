import { cashfreeSandboxRequest, isCashfreeReference, toPaise, type CashfreeCredentials } from './cashfree-http.js';
import { digest } from './fee-store.js';
import type { Records } from './firestore.js';
import { HttpError } from './http.js';

type Payout = {
  status: 'approved' | 'submitting' | 'pending' | 'paid' | 'failed' | 'reversed';
  beneficiaryId: string;
  approvedBy: string;
  amountPaise: number;
  transferId?: string;
};

type ProviderTransfer = {
  transfer_id: string;
  cf_transfer_id: string;
  status: string;
  status_code?: string;
  transfer_amount: number;
  beneficiary_details?: { beneficiary_id: string };
};

export function createCashfreePayouts(credentials: CashfreeCredentials, request = fetch) {
  const call = cashfreeSandboxRequest('payout', '2024-01-01', credentials, request);
  return {
    create: (id: string, approved: Payout) => call<ProviderTransfer>('/transfers', {
      transfer_id: id,
      transfer_amount: approved.amountPaise / 100,
      beneficiary_details: { beneficiary_id: approved.beneficiaryId },
    }),
    get: (id: string) => call<ProviderTransfer>(`/transfers?transfer_id=${encodeURIComponent(id)}`),
  };
}

export async function runApprovedPayout(
  records: Records, id: string, operation: 'submit' | 'reconcile', gateway: ReturnType<typeof createCashfreePayouts>,
) {
  const { db, ref, read } = records;
  const transferId = `cs-po-${digest(`${records.scenario}:${id}`).slice(0, 30)}`;
  const reserved = await db.runTransaction(async tx => {
    const intent = await read<Payout>('payouts', id, tx);
    if (!intent || !intent.approvedBy?.trim() || !Number.isSafeInteger(intent.amountPaise) || intent.amountPaise <= 100
      || !isCashfreeReference(intent.beneficiaryId)) {
      throw new HttpError(409, 'PAYOUT_NOT_APPROVED', 'A valid approved payout to a saved beneficiary is required.');
    }
    if (intent.status !== 'approved') {
      if (intent.transferId !== transferId) throw new HttpError(409, 'PAYOUT_REFERENCE_MISMATCH', 'The payout reference requires review.');
      return { intent, submit: false };
    }
    if (operation !== 'submit') throw new HttpError(409, 'PAYOUT_NOT_SUBMITTED', 'The payout has not been submitted.');
    tx.update(ref('payouts', id), { status: 'submitting', transferId, submittedAt: new Date().toISOString() });
    return { intent, submit: true };
  });
  const { intent } = reserved;
  const provider = reserved.submit ? await gateway.create(transferId, intent) : await gateway.get(transferId);
  if (provider?.transfer_id !== transferId || !isCashfreeReference(provider.cf_transfer_id)
    || toPaise(provider.transfer_amount) !== intent.amountPaise || provider.beneficiary_details?.beneficiary_id !== intent.beneficiaryId) {
    throw new HttpError(409, 'PAYOUT_MISMATCH', 'The provider transfer does not match the approved payout.');
  }
  const status = provider.status === 'SUCCESS' && provider.status_code === 'COMPLETED' ? 'paid'
    : provider.status === 'REVERSED' ? 'reversed'
      : ['FAILED', 'REJECTED'].includes(provider.status) ? 'failed' : 'pending';
  return db.runTransaction(async tx => {
    const current = await read<Payout>('payouts', id, tx);
    if (current?.transferId !== transferId || current.beneficiaryId !== intent.beneficiaryId || current.amountPaise !== intent.amountPaise) {
      throw new HttpError(409, 'PAYOUT_CHANGED', 'The payout changed while it was being reconciled.');
    }
    const terminal = ['paid', 'failed', 'reversed'].includes(current.status);
    if (terminal && !(current.status === 'paid' && status === 'reversed')) return { transferId, status: current.status };
    tx.update(ref('payouts', id), { status, providerTransferId: provider.cf_transfer_id, reconciledAt: new Date().toISOString() });
    return { transferId, status };
  });
}
