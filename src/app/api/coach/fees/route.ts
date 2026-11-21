import { requireServerActor } from '@/lib/server/firebase-auth';
import { apiSuccess, handleApiError, parseJsonBody } from '@/lib/server/firebase-route-helpers';
import { createRuntimeCoachFee } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const actor = await requireServerActor(request, 'coach');
    const body = await parseJsonBody(request);
    const period = typeof body.period === 'string' ? body.period : '';
    const amountPaise = Number(body.amountPaise);
    return apiSuccess(createRuntimeCoachFee(actor, period, amountPaise));
  } catch (err) {
    return handleApiError(err);
  }
}
