import { NextRequest, NextResponse } from 'next/server';

const WINDOW_MS = 60_000;
const SENSITIVE_LIMIT = 30;
const DEFAULT_LIMIT = 90;

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim() || 'unknown';
  }
  return request.headers.get('x-real-ip') ?? 'local';
}

function checkRateLimit(key: string, limit: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets.entries()) {
      if (v.resetAt <= now) {
        rateBuckets.delete(k);
      }
    }
  }

  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function getAllowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (!origin) {
    return null;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return null;
  }

  const requestOrigin = request.nextUrl.origin;
  if (origin === requestOrigin) {
    return origin;
  }

  // Match same-origin when the browser accesses 127.0.0.1 vs localhost or via a reverse proxy Host header.
  const hostHeader = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '')
    .split(',')[0]
    .trim();
  if (hostHeader && /^[a-z0-9.-]+(:\d+)?$/i.test(hostHeader) && parsedOrigin.host === hostHeader) {
    const proto = (request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', ''))
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (`${proto}:` === parsedOrigin.protocol) {
      return origin;
    }
  }

  const configured = (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (configured.includes(origin)) {
    return origin;
  }

  return null;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const varyHeader = 'Origin, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site';
  const fetchSite = request.headers.get('sec-fetch-site');

  // Block cross-site state-changing API calls before authentication.
  if (
    fetchSite === 'cross-site' &&
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    request.method !== 'OPTIONS'
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'FORBIDDEN_CROSS_SITE',
          message: 'Cross-site API mutations are blocked.',
        },
      },
      {
        status: 403,
        headers: {
          Vary: varyHeader,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }

  const allowedOrigin = getAllowedOrigin(request);
  if (request.headers.get('origin') && !allowedOrigin) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'CORS_FORBIDDEN',
          message: 'Origin is not permitted to access this API.',
        },
      },
      {
        status: 403,
        headers: {
          Vary: varyHeader,
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  if (request.method === 'OPTIONS') {
    const preflightHeaders = new Headers({
      Vary: varyHeader,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
    if (allowedOrigin) {
      preflightHeaders.set('Access-Control-Allow-Origin', allowedOrigin);
    }
    return new NextResponse(null, { status: 204, headers: preflightHeaders });
  }

  const isSensitive =
    pathname.startsWith('/api/raz/') || pathname.startsWith('/api/parent/contact/');
  const limit = isSensitive ? SENSITIVE_LIMIT : DEFAULT_LIMIT;
  const bucketKey = `${getClientIp(request)}:${isSensitive ? 'sensitive' : 'api'}`;
  const rate = checkRateLimit(bucketKey, limit);

  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please pause briefly and try again.',
        },
      },
      {
        status: 429,
        headers: {
          Vary: varyHeader,
          'Retry-After': String(rate.retryAfter),
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set('Vary', varyHeader);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  if (allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  }
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
