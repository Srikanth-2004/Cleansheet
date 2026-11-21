import { getCurrentIdToken, isFixtureModeEnabled } from './firebase';
import {
  fixtureConfirmFee,
  fixtureCreateCheckout,
  fixtureGetCoachSummary,
  fixtureGetMe,
  fixtureGetParentFees,
  fixtureRazFeePreview,
  fixtureVerifyOrder,
} from './fixtures';
import type {
  ApiResponse,
  CheckoutSessionData,
  CoachSummaryData,
  CreateFeeData,
  Locale,
  MeData,
  ParentFeesData,
  RazPreviewData,
  VerifyOrderData,
} from './types';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  overrideToken?: string,
): Promise<ApiResponse<T>> {
  const token = overrideToken ?? (await getCurrentIdToken());
  if (!token) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in with Google first so your session token can be verified.',
      },
    };
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(apiUrl(url), { ...init, headers });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        error: {
          code: `HTTP_${response.status}`,
          message: `Server returned status ${response.status} without JSON.`,
        },
      };
    }
    return (await response.json()) as ApiResponse<T>;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network request failed.',
      },
    };
  }
}

export async function fetchMe(): Promise<ApiResponse<MeData>> {
  if (isFixtureModeEnabled()) {
    return fixtureGetMe();
  }
  return requestJson<MeData>('/api/me', { method: 'GET' });
}

export async function fetchCoachSummary(period: string): Promise<ApiResponse<CoachSummaryData>> {
  if (isFixtureModeEnabled()) {
    return fixtureGetCoachSummary(period);
  }
  return requestJson<CoachSummaryData>(
    `/api/coach/summary?period=${encodeURIComponent(period)}`,
    { method: 'GET' },
  );
}

export async function fetchParentFees(period: string): Promise<ApiResponse<ParentFeesData>> {
  if (isFixtureModeEnabled()) {
    return fixtureGetParentFees(period);
  }
  return requestJson<ParentFeesData>(
    `/api/parent/fees?period=${encodeURIComponent(period)}`,
    { method: 'GET' },
  );
}

export async function previewRazFee(input: {
  audio?: Blob;
  mimeType?: string;
  text?: string;
  locale: Locale;
  period: string;
  fixtureOnly?: boolean;
}): Promise<ApiResponse<RazPreviewData>> {
  const fixtureMode = isFixtureModeEnabled();
  if (fixtureMode && input.fixtureOnly) {
    return fixtureRazFeePreview(input);
  }
  const overrideToken = fixtureMode ? 'fixture-coach-token' : undefined;

  const callLiveSarvam = async (): Promise<ApiResponse<RazPreviewData>> => {
    if (input.audio) {
      const formData = new FormData();
      const ext = input.mimeType?.includes('mp4')
        ? 'mp4'
        : input.mimeType?.includes('ogg')
          ? 'ogg'
          : input.mimeType?.includes('wav')
            ? 'wav'
            : 'webm';
      formData.append('audio', input.audio, `raz-command.${ext}`);
      formData.append('locale', input.locale);
      formData.append('period', input.period);
      return requestJson<RazPreviewData>(
        '/api/raz/fee-preview',
        {
          method: 'POST',
          body: formData,
        },
        overrideToken,
      );
    }

    return requestJson<RazPreviewData>(
      '/api/raz/fee-preview',
      {
        method: 'POST',
        body: JSON.stringify({
          text: input.text ?? '',
          locale: input.locale,
          period: input.period,
        }),
      },
      overrideToken,
    );
  };

  const liveResult = await callLiveSarvam();
  if (
    fixtureMode &&
    !liveResult.ok &&
    (liveResult.error.code === 'SARVAM_NOT_CONFIGURED' ||
      liveResult.error.code === 'NETWORK_ERROR')
  ) {
    return fixtureRazFeePreview(input);
  }

  return liveResult;
}

export async function confirmCoachFee(input: {
  period: string;
  amountPaise: number;
}): Promise<ApiResponse<CreateFeeData>> {
  if (isFixtureModeEnabled()) {
    return fixtureConfirmFee(input);
  }
  return requestJson<CreateFeeData>('/api/coach/fees', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createFeeCheckout(feeId: string): Promise<ApiResponse<CheckoutSessionData>> {
  if (isFixtureModeEnabled()) {
    return fixtureCreateCheckout(feeId);
  }
  return requestJson<CheckoutSessionData>(`/api/fees/${encodeURIComponent(feeId)}/checkout`, {
    method: 'POST',
  });
}

export async function verifyOrder(orderId: string): Promise<ApiResponse<VerifyOrderData>> {
  if (isFixtureModeEnabled()) {
    return fixtureVerifyOrder(orderId);
  }
  return requestJson<VerifyOrderData>(`/api/orders/${encodeURIComponent(orderId)}/verify`, {
    method: 'POST',
  });
}
