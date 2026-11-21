import {
  isStrictConsentVersion,
  isStrictPhone,
  requireServerActor,
  sanitizeText,
} from '@/lib/server/firebase-auth';
import { apiError, apiSuccess, handleApiError, parseJsonBody } from '@/lib/server/firebase-route-helpers';
import { startRuntimeContactChallenge } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const actor = await requireServerActor(request, 'parent');
    const body = await parseJsonBody(request);
    const phone = sanitizeText(body.phone, 24);
    if (!isStrictPhone(phone) || !isStrictConsentVersion(body.consentVersion)) {
      return apiError('INVALID_CONTACT', 'Enter a valid phone number and consent version.', 400);
    }
    return apiSuccess(startRuntimeContactChallenge(actor, phone, body.consentVersion));
  } catch (err) {
    return handleApiError(err);
  }
}
