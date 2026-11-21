import { requireServerActor, sanitizeText } from '@/lib/server/firebase-auth';
import { apiError, apiSuccess, handleApiError, parseJsonBody } from '@/lib/server/firebase-route-helpers';
import { approveRuntimeCoachRefund } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const actor = await requireServerActor(request, 'coach');
    const { caseId } = await context.params;
    const cleanCaseId = sanitizeText(caseId, 128);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanCaseId)) {
      return apiError('INVALID_CASE_ID', 'Invalid refund case ID.', 400);
    }
    const body = await parseJsonBody(request);
    const amountPaise = Number(body.amountPaise);
    return apiSuccess(approveRuntimeCoachRefund(actor, cleanCaseId, amountPaise));
  } catch (err) {
    return handleApiError(err);
  }
}
