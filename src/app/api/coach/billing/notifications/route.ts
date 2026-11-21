import { requireServerActor } from '@/lib/server/firebase-auth';
import { apiSuccess, handleApiError } from '@/lib/server/firebase-route-helpers';
import { listRuntimeCoachNotifications } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const actor = await requireServerActor(request, 'coach');
    return apiSuccess(listRuntimeCoachNotifications(actor));
  } catch (err) {
    return handleApiError(err);
  }
}
