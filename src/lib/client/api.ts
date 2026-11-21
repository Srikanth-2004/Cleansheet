import { getCurrentIdToken, isFixtureModeEnabled } from './firebase';
import {
  fixtureApproveCoachRefund,
  fixtureConfirmFee,
  fixtureCreateCheckout,
  fixtureEnrolSubscription,
  fixtureGetCoachSummary,
  getFixtureState,
  fixtureGetMe,
  fixtureGetParentBilling,
  fixtureGetParentFees,
  fixtureListCoachNotifications,
  fixtureListCoachRefunds,
  fixtureRazFeePreview,
  fixtureRecordParentDecision,
  fixtureSetOutreachConsent,
  fixtureStartContact,
  fixtureVerifyContact,
  fixtureVerifyOrder,
} from './fixtures';
import type {
  ApiResponse,
  CheckoutSessionData,
  CoachNotificationsData,
  CoachPaidFee,
  CoachRefundsData,
  CoachSummaryData,
  ContactStartData,
  ContactVerifyData,
  CreateFeeData,
  CycleDecisionData,
  Locale,
  MeData,
  OutreachConsentData,
  ParentBillingData,
  ParentDecision,
  ParentFeesData,
  RazPreviewData,
  RefundCaseView,
  SubscriptionEnrolData,
  VerifyOrderData,
} from './types';

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
    const response = await fetch(url, { ...init, headers });
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

export async function fetchCoachPayments(period: string): Promise<ApiResponse<{ payments: CoachPaidFee[] }>> {
  if (isFixtureModeEnabled()) {
    const payments = getFixtureState().fees
      .filter(fee => fee.period === period && fee.status === 'paid')
      .map(fee => ({ feeId: fee.id, playerName: fee.playerName, amountPaise: fee.amountPaise, netPaise: fee.amountPaise - (fee.refundedPaise ?? 0) }));
    return { ok: true, data: { payments } };
  }
  return requestJson(`/api/coach/payments?period=${encodeURIComponent(period)}`, { method: 'GET' });
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

  return callLiveSarvam();
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

export async function fetchParentBilling(): Promise<ApiResponse<ParentBillingData>> {
  if (isFixtureModeEnabled()) {
    return fixtureGetParentBilling();
  }
  return requestJson<ParentBillingData>('/api/parent/billing', { method: 'GET' });
}

export async function startContactVerification(input: {
  phone: string;
  consentVersion: string;
}): Promise<ApiResponse<ContactStartData>> {
  if (isFixtureModeEnabled()) {
    return fixtureStartContact(input.phone);
  }
  return requestJson<ContactStartData>('/api/parent/contact/start', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyContactOtp(input: {
  challengeId: string;
  otp: string;
}): Promise<ApiResponse<ContactVerifyData>> {
  if (isFixtureModeEnabled()) {
    return fixtureVerifyContact(input.challengeId, input.otp);
  }
  return requestJson<ContactVerifyData>('/api/parent/contact/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateOutreachConsent(input: {
  granted: boolean;
  consentVersion: string;
}): Promise<ApiResponse<OutreachConsentData>> {
  if (isFixtureModeEnabled()) {
    return fixtureSetOutreachConsent(input.granted);
  }
  return requestJson<OutreachConsentData>('/api/parent/outreach-consent', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function enrolSubscription(): Promise<ApiResponse<SubscriptionEnrolData>> {
  if (isFixtureModeEnabled()) {
    return fixtureEnrolSubscription();
  }
  return requestJson<SubscriptionEnrolData>('/api/parent/subscription/enrol', {
    method: 'POST',
  });
}

export function recognizeParentCancellationAnswer(audio: Blob, locale: 'en-IN' | Locale) {
  const formData = new FormData();
  const extension = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm';
  formData.append('audio', audio, `cancellation-answer.${extension}`);
  formData.append('locale', locale);
  return requestJson<{ answer: 'yes' | 'no' | 'unknown' }>(
    '/api/parent/billing/cancellation-answer',
    { method: 'POST', body: formData },
    isFixtureModeEnabled() ? 'fixture-parent-token' : undefined,
  );
}

export async function submitParentCycleDecision(
  cycleId: string,
  decision: ParentDecision,
): Promise<ApiResponse<CycleDecisionData>> {
  if (isFixtureModeEnabled()) {
    return fixtureRecordParentDecision(cycleId, decision);
  }
  return requestJson<CycleDecisionData>(
    `/api/parent/billing/cycles/${encodeURIComponent(cycleId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    },
  );
}

export async function fetchCoachNotifications(): Promise<ApiResponse<CoachNotificationsData>> {
  if (isFixtureModeEnabled()) {
    return fixtureListCoachNotifications();
  }
  return requestJson<CoachNotificationsData>('/api/coach/billing/notifications', {
    method: 'GET',
  });
}

export async function fetchCoachRefunds(): Promise<ApiResponse<CoachRefundsData>> {
  if (isFixtureModeEnabled()) {
    return fixtureListCoachRefunds();
  }
  return requestJson<CoachRefundsData>('/api/coach/refunds', { method: 'GET' });
}

export async function approveCoachRefund(
  caseId: string,
  amountPaise: number,
): Promise<ApiResponse<RefundCaseView>> {
  if (isFixtureModeEnabled()) {
    return fixtureApproveCoachRefund(caseId, amountPaise);
  }
  return requestJson<RefundCaseView>(
    `/api/coach/refunds/${encodeURIComponent(caseId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ amountPaise }),
    },
  );
}
