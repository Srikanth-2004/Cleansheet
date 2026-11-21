import { requireServerActor } from '@/lib/server/firebase-auth';
import { apiSuccess, handleApiError } from '@/lib/server/firebase-route-helpers';
import { enrolRuntimeSubscription } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const actor = await requireServerActor(request, 'parent');
    return apiSuccess(enrolRuntimeSubscription(actor));
  } catch (err) {
    return handleApiError(err);
  }
}
