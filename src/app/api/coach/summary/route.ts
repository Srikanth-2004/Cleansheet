import { requireServerActor } from '@/lib/server/firebase-auth';
import { apiSuccess, handleApiError } from '@/lib/server/firebase-route-helpers';
import { getRuntimeCoachSummary } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const actor = await requireServerActor(request, 'coach');
    const url = new URL(request.url);
    const period = url.searchParams.get('period') ?? '2026-11';
    return apiSuccess(getRuntimeCoachSummary(actor, period));
  } catch (err) {
    return handleApiError(err);
  }
}
