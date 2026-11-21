import { isStrictConsentVersion, requireServerActor } from '@/lib/server/firebase-auth';
import { apiError, apiSuccess, handleApiError, parseJsonBody } from '@/lib/server/firebase-route-helpers';
import { setRuntimeOutreachConsent } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const actor = await requireServerActor(request, 'parent');
    const body = await parseJsonBody(request);
    if (typeof body.granted !== 'boolean' || !isStrictConsentVersion(body.consentVersion)) {
      return apiError('INVALID_CONSENT', 'Consent choice and valid version are required.', 400);
    }
    return apiSuccess(setRuntimeOutreachConsent(actor, body.granted, body.consentVersion));
  } catch (err) {
    return handleApiError(err);
  }
}
