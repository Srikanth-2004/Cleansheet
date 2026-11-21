import { requireServerActor, sanitizeText } from '@/lib/server/firebase-auth';
import { apiError, apiSuccess, handleApiError, parseJsonBody } from '@/lib/server/firebase-route-helpers';
import { recordRuntimeParentDecision } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireServerActor(request, 'parent');
    const { id } = await context.params;
    const cycleId = sanitizeText(id, 128);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cycleId)) {
      return apiError('INVALID_CYCLE_ID', 'Invalid billing cycle ID.', 400);
    }
    const body = await parseJsonBody(request);
    if (body.decision !== 'keep' && body.decision !== 'cancel_subscription') {
      return apiError('INVALID_DECISION', 'Choose keep or cancel_subscription.', 400);
    }
    return apiSuccess(recordRuntimeParentDecision(actor, cycleId, body.decision));
  } catch (err) {
    return handleApiError(err);
  }
}
