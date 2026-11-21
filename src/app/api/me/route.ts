import { requireServerActor } from '@/lib/server/firebase-auth';
import { apiSuccess, handleApiError } from '@/lib/server/firebase-route-helpers';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const actor = await requireServerActor(request);
    return apiSuccess({
      role: actor.role,
      academyName: actor.academyName,
      teamName: actor.teamName,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
