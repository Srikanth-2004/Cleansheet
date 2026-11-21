import type { Role } from '../../contracts/billing';

export interface ServerActor {
  uid: string;
  email: string;
  role: Role;
  academyName: string;
  teamName: string;
  playerId: string;
  playerName: string;
}

export class ServerAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ServerAuthError';
    this.status = status;
    this.code = code;
  }
}

export function sanitizeText(value: unknown, maxLength = 300): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function isStrictPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isStrictConsentVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(value);
}

export function isStrictOtp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

export function isStrictPhone(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

function actorFromEmailOrUid(uid: string, email: string): ServerActor | null {
  const coachUid = process.env.CLEANSHEET_COACH_UID?.trim();
  const parentUid = process.env.CLEANSHEET_PARENT_UID?.trim();
  const coachEmail = process.env.CLEANSHEET_COACH_EMAIL?.trim().toLowerCase();
  const parentEmail = process.env.CLEANSHEET_TEST_PARENT_EMAIL?.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  const base = {
    academyName: 'First Touch Academy',
    teamName: 'U12',
    playerId: 'player-u12-demo',
    playerName: 'Demo Player',
  };

  if ((coachUid && uid === coachUid) || (coachEmail && normalizedEmail === coachEmail)) {
    return { uid, email, role: 'coach', ...base };
  }
  if ((parentUid && uid === parentUid) || (parentEmail && normalizedEmail === parentEmail)) {
    return { uid, email, role: 'parent', ...base };
  }
  return null;
}

async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string }> {
  const apiKey =
    process.env.FIREBASE_WEB_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();

  if (!apiKey) {
    throw new ServerAuthError(
      503,
      'FIREBASE_AUTH_UNCONFIGURED',
      'Server Firebase Auth verification is not configured.',
    );
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new ServerAuthError(401, 'INVALID_TOKEN', 'Firebase ID token could not be verified.');
  }

  const payload = (await response.json()) as {
    users?: Array<{ localId?: string; email?: string; disabled?: boolean }>;
  };
  const user = payload.users?.[0];
  if (!user?.localId || user.disabled) {
    throw new ServerAuthError(401, 'INVALID_TOKEN', 'Authenticated account is invalid or disabled.');
  }

  return { uid: user.localId, email: user.email ?? '' };
}

export async function requireServerActor(
  request: Request,
  expectedRole?: Role,
): Promise<ServerActor> {
  const authHeader = request.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    throw new ServerAuthError(401, 'UNAUTHENTICATED', 'Missing Authorization Bearer token.');
  }

  const allowDevFixtures =
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_USE_FIXTURES !== 'false';

  let actor: ServerActor | null = null;

  if (allowDevFixtures && token === 'fixture-coach-token') {
    actor = {
      uid: 'fixture-coach',
      email: 'coach@firsttouch.demo',
      role: 'coach',
      academyName: 'First Touch Academy',
      teamName: 'U12',
      playerId: 'player-u12-demo',
      playerName: 'Demo Player',
    };
  } else if (allowDevFixtures && token === 'fixture-parent-token') {
    actor = {
      uid: 'fixture-parent',
      email: 'parent@firsttouch.demo',
      role: 'parent',
      academyName: 'First Touch Academy',
      teamName: 'U12',
      playerId: 'player-u12-demo',
      playerName: 'Demo Player',
    };
  } else {
    const verified = await verifyFirebaseIdToken(token);
    actor = actorFromEmailOrUid(verified.uid, verified.email);
  }

  if (!actor) {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Account is not linked to an academy role.');
  }

  if (expectedRole && actor.role !== expectedRole) {
    throw new ServerAuthError(
      403,
      'FORBIDDEN',
      `Only an authorised ${expectedRole} can access this endpoint.`,
    );
  }

  return actor;
}
