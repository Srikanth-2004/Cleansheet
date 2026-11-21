import { isStrictOtp, requireServerActor, sanitizeText } from '@/lib/server/firebase-auth';
import { apiError, apiSuccess, handleApiError, parseJsonBody } from '@/lib/server/firebase-route-helpers';
import { verifyRuntimeContactChallenge } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const actor = await requireServerActor(request, 'parent');
    const body = await parseJsonBody(request);
    const challengeId = sanitizeText(body.challengeId, 64);
    const otp = sanitizeText(body.otp, 12);
    if (!/^cs-[a-f0-9]{32}$/.test(challengeId) || !isStrictOtp(otp)) {
      return apiError('INVALID_OTP_REQUEST', 'Provide the active challenge ID and 6-digit OTP.', 400);
    }
    return apiSuccess(verifyRuntimeContactChallenge(actor, challengeId, otp));
  } catch (err) {
    return handleApiError(err);
  }
}
