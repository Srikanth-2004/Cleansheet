'use client';

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  createFeeCheckout,
  enrolSubscription,
  fetchParentBilling,
  fetchParentFees,
  startContactVerification,
  submitParentCycleDecision,
  updateOutreachConsent,
  verifyContactOtp,
  verifyOrder,
} from '@/lib/client/api';
import { openCashfreeSandboxCheckout, openCashfreeSandboxSubscription } from '@/lib/client/cashfree';
import {
  FIXTURE_SANDBOX_OTP,
  setFixtureFeeStatusForTesting,
  setFixtureSimulatedOutcome,
} from '@/lib/client/fixtures';
import {
  type CheckoutSessionData,
  DEFAULT_DEMO_PERIOD,
  formatPaise,
  type MeData,
  type ParentBillingData,
  type ParentDecision,
  type ParentFee,
} from '@/lib/client/types';
import { ArrowIcon, RefreshIcon } from './icons';
import { ParentCancellationPrompt } from './ParentCancellationPrompt';
import {
  AnimatedAlert,
  AnimatedNumber,
  BlurReveal,
  CheckDraw,
  LifecyclePipeline,
  MagneticButton,
  MorphPill,
  ParticleBurst,
  type PipelineStage,
  SpotlightCard,
  TextShimmer,
  ToggleSwitch,
} from './motion/primitives';

interface ParentFeeViewProps {
  me: MeData;
  fixtureMode: boolean;
  returnOrderId?: string | null;
  refreshSignal?: number;
}

const formatAnimatedRupees = (paise: number) =>
  formatPaise(paise % 100 === 0 ? paise : Math.round(paise / 100) * 100);

export function ParentFeeView({
  me,
  fixtureMode,
  returnOrderId = null,
  refreshSignal = 0,
}: ParentFeeViewProps) {
  const modalTitleId = useId();
  const phoneInputId = useId();
  const otpInputId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const autoVerifiedRef = useRef<string | null>(null);
  const celebratedFeeIdsRef = useRef<Set<string>>(new Set());

  const [period] = useState<string>(DEFAULT_DEMO_PERIOD);
  const [fees, setFees] = useState<ParentFee[]>([]);
  const [billing, setBilling] = useState<ParentBillingData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyFeeId, setBusyFeeId] = useState<string | null>(null);
  const [verifyingOrderId, setVerifyingOrderId] = useState<string | null>(null);
  const [paidBurstCount, setPaidBurstCount] = useState<number>(0);

  const [phoneInput, setPhoneInput] = useState<string>('+91 98765 43210');
  const [challengeId, setChallengeId] = useState<string>('');
  const [maskedPhone, setMaskedPhone] = useState<string>('');
  const [otpInput, setOtpInput] = useState<string>('');
  const [contactBusy, setContactBusy] = useState<boolean>(false);
  const [billingBusy, setBillingBusy] = useState<boolean>(false);
  const [showCancellation, setShowCancellation] = useState(false);

  const [activeCheckout, setActiveCheckout] = useState<{
    fee: ParentFee;
    session: CheckoutSessionData;
  } | null>(null);
  const [lastOrderIdByFee, setLastOrderIdByFee] = useState<Record<string, string>>({});

  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const loadParentWorkspace = useCallback(async () => {
    setLoading(true);
    const [feeRes, billingRes] = await Promise.all([
      fetchParentFees(period),
      fetchParentBilling(),
    ]);
    setLoading(false);

    if (feeRes.ok) {
      setFees(feeRes.data.fees);
      setErrorMessage('');
    } else {
      setErrorMessage(`${feeRes.error.code}: ${feeRes.error.message}`);
    }

    if (billingRes.ok) {
      setBilling(billingRes.data);
    }
  }, [period]);

  useEffect(() => {
    void loadParentWorkspace();
  }, [loadParentWorkspace, refreshSignal]);

  const handleVerifyOrder = useCallback(
    async (orderId: string) => {
      setErrorMessage('');
      setVerifyingOrderId(orderId);
      const res = await verifyOrder(orderId);
      setVerifyingOrderId(null);

      if (res.ok) {
        setLastOrderIdByFee((prev) => ({ ...prev, [res.data.feeId]: orderId }));
        if (res.data.feeStatus === 'paid') {
          if (!celebratedFeeIdsRef.current.has(res.data.feeId)) {
            celebratedFeeIdsRef.current.add(res.data.feeId);
            setPaidBurstCount((c) => c + 1);
          }
          setStatusMessage(
            `Payment verified for order ${orderId}. Fee ${res.data.feeId} is now marked paid.`,
          );
        } else {
          setStatusMessage(
            `Order ${orderId} is still ${res.data.feeStatus}. Use Recheck Status once Cashfree confirms.`,
          );
        }
        await loadParentWorkspace();
      } else {
        setErrorMessage(`${res.error.code}: ${res.error.message}`);
      }
    },
    [loadParentWorkspace],
  );

  useEffect(() => {
    if (!returnOrderId || autoVerifiedRef.current === returnOrderId) {
      return;
    }
    autoVerifiedRef.current = returnOrderId;
    void handleVerifyOrder(returnOrderId);
  }, [returnOrderId, handleVerifyOrder]);

  async function handleStartCheckout(fee: ParentFee) {
    setErrorMessage('');
    setStatusMessage('');
    setBusyFeeId(fee.id);

    const res = await createFeeCheckout(fee.id);
    setBusyFeeId(null);

    if (!res.ok) {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
      return;
    }

    const session = res.data;
    setLastOrderIdByFee((prev) => ({ ...prev, [fee.id]: session.orderId }));

    if (fixtureMode || session.paymentSessionId.startsWith('session-fixture-')) {
      setActiveCheckout({ fee, session });
      dialogRef.current?.showModal();
      return;
    }

    try {
      setStatusMessage(
        `Opening Cashfree Sandbox checkout for order ${session.orderId}…`,
      );
      await openCashfreeSandboxCheckout(session.paymentSessionId);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to open Cashfree Sandbox hosted checkout.',
      );
    }
  }

  async function handleFixtureCheckoutOutcome(outcome: 'paid' | 'processing') {
    if (!activeCheckout) {
      return;
    }
    const { fee, session } = activeCheckout;
    dialogRef.current?.close();
    setActiveCheckout(null);

    setFixtureSimulatedOutcome(outcome);
    setFixtureFeeStatusForTesting(fee.id, 'processing', session.orderId);
    await handleVerifyOrder(session.orderId);
  }

  async function handleStartContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setStatusMessage('');
    setContactBusy(true);

    const res = await startContactVerification({
      phone: phoneInput,
      consentVersion: 'v1.0',
    });
    setContactBusy(false);

    if (res.ok) {
      setChallengeId(res.data.challengeId);
      setMaskedPhone(res.data.maskedPhone);
      setStatusMessage(
        fixtureMode
          ? `Secure ID OTP challenge created for ${res.data.maskedPhone}. Sandbox test code: ${FIXTURE_SANDBOX_OTP}.`
          : `Verification code sent to ${res.data.maskedPhone}.`,
      );
      await loadParentWorkspace();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setStatusMessage('');
    setContactBusy(true);

    const res = await verifyContactOtp({
      challengeId,
      otp: otpInput.trim(),
    });
    setContactBusy(false);

    if (res.ok) {
      setChallengeId('');
      setOtpInput('');
      setMaskedPhone(res.data.maskedPhone);
      setStatusMessage(`Secure ID contact verified (${res.data.maskedPhone}).`);
      await loadParentWorkspace();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  async function handleToggleConsent() {
    if (!billing) return;
    setErrorMessage('');
    setBillingBusy(true);
    const nextGranted = billing.outreachConsent !== 'granted';
    const res = await updateOutreachConsent({
      granted: nextGranted,
      consentVersion: 'v1.0',
    });
    setBillingBusy(false);

    if (res.ok) {
      setStatusMessage(`Relay voice outreach consent updated to ${res.data.outreachConsent}.`);
      await loadParentWorkspace();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  async function handleEnrolSubscription() {
    setErrorMessage('');
    setBillingBusy(true);
    const res = await enrolSubscription();
    setBillingBusy(false);

    if (res.ok) {
      if (!fixtureMode && res.data.subscriptionSessionId) {
        try {
          await openCashfreeSandboxSubscription(res.data.subscriptionSessionId);
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to open Cashfree mandate checkout.');
          return;
        }
      }
      setStatusMessage(res.data.status === 'active' ? 'Subscription is active.' : 'Mandate is awaiting Cashfree authorization.');
      await loadParentWorkspace();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  async function handleCycleDecision(decision: ParentDecision) {
    if (!billing?.cycle) return;
    setErrorMessage('');
    setBillingBusy(true);
    const res = await submitParentCycleDecision(billing.cycle.id, decision);
    setBillingBusy(false);

    if (res.ok) {
      setStatusMessage(
        decision === 'cancel_subscription'
          ? res.data.subscriptionStatus === 'cancelled'
            ? 'Subscription cancelled. The coach has been notified.'
            : 'Cancellation requested. The coach will be notified once Cashfree confirms.'
          : `Cycle confirmed (${res.data.cycleStatus}). Recurring charge path reserved.`,
      );
      await loadParentWorkspace();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  const feePaid = fees.some((f) => f.status === 'paid');
  const contactVerified = billing?.contactStatus === 'verified';
  const mandateActive = Boolean(billing?.subscription);

  const stages: PipelineStage[] = [
    {
      id: 'fee-due',
      code: '01',
      label: 'Fee Published',
      state: fees.length > 0 ? 'done' : 'active',
    },
    {
      id: 'secure-id',
      code: '02',
      label: 'Secure ID OTP',
      state: contactVerified ? 'done' : challengeId ? 'active' : 'pending',
    },
    {
      id: 'mandate',
      code: '03',
      label: 'Mandate / Choice',
      state:
        billing?.cycle?.status === 'decision_recorded' || billing?.cycle?.status === 'closed'
          ? 'done'
          : mandateActive
            ? 'active'
            : 'pending',
    },
    {
      id: 'settled',
      code: '04',
      label: 'Cashfree Verified',
      state: feePaid ? 'done' : fees.length > 0 ? 'active' : 'pending',
    },
  ];

  const otpChars = Array.from({ length: 6 }, (_, i) => otpInput[i] ?? '');

  return (
    <div>
      <div className="page-intro">
        <div>
          <p className="eyebrow mono">
            PORTAL // {me.academyName} · {me.teamName} SQUAD
          </p>
          <BlurReveal
            as="h1"
            id="main-heading"
            tabIndex={-1}
            className="page-title"
            text="Parent Fee & Mandate Portal"
            highlightWords={['Portal']}
          />
          <p className="page-subtitle">
            Period <span className="mono">{period}</span> · Verify adult contact, manage recurring
            mandates, and settle fees via Cashfree Sandbox.
          </p>
        </div>

        <MagneticButton
          className="btn btn-secondary"
          onClick={() => void loadParentWorkspace()}
          disabled={loading}
        >
          <RefreshIcon />
          {loading ? 'Loading…' : 'Refresh Portal'}
        </MagneticButton>
      </div>

      <LifecyclePipeline stages={stages} />

      <div aria-live="polite" aria-atomic="true">
        <AnimatedAlert message={errorMessage} tone="error" role="alert" />
        {!errorMessage && <AnimatedAlert message={statusMessage} tone="success" role="status" />}
      </div>

      {loading ? (
        <div className="card status-card" style={{ marginTop: '1rem' }}>
          <TextShimmer>Loading linked player ledger…</TextShimmer>
        </div>
      ) : fees.length === 0 ? (
        <SpotlightCard
          className="card"
          spotlightColor="rgba(89, 124, 128, 0.22)"
          delay={0.05}
          style={{ marginTop: '1rem' }}
        >
          <div className="panel-index mono">01 // ONE-TIME PG CHECKOUT</div>
          <h2 className="section-heading">No Fees Due Yet</h2>
          <p className="section-caption" style={{ marginBottom: 0 }}>
            Once the coach confirms a fee proposal from Raz for period{' '}
            <span className="mono">{period}</span>, it appears here for Cashfree Sandbox checkout.
          </p>
        </SpotlightCard>
      ) : (
        <ul className="fee-list" style={{ marginTop: '1rem' }}>
          {fees.map((fee, index) => {
            const knownOrderId = lastOrderIdByFee[fee.id] || returnOrderId || '';
            const statusTone =
              fee.status === 'paid'
                ? 'pill-teal'
                : fee.status === 'processing'
                  ? 'pill-sandbox'
                  : 'pill-terracotta';
            const statusLabel =
              fee.status === 'paid'
                ? 'Paid · Verified'
                : fee.status === 'processing'
                  ? 'Checking Payment Status'
                  : 'Unpaid · Payment Due';

            return (
              <SpotlightCard
                key={fee.id}
                as="li"
                className="fee-card"
                spotlightColor={
                  fee.status === 'paid'
                    ? 'rgba(89, 124, 128, 0.34)'
                    : 'rgba(158, 92, 85, 0.28)'
                }
                delay={0.05 * index}
              >
                <div className="panel-index mono">01 // ONE-TIME PG CHECKOUT</div>
                <div className="fee-card-header">
                  <div>
                    <h2 className="section-heading" style={{ marginBottom: '0.2rem' }}>
                      {fee.playerName} · {me.teamName}
                    </h2>
                    <p className="field-hint" style={{ margin: 0 }}>
                      Period <span className="mono">{fee.period}</span> · Fee ID{' '}
                      <span className="mono">{fee.id}</span>
                    </p>
                  </div>

                  <MorphPill keyValue={`${fee.id}-${fee.status}`} tone={statusTone}>
                    {statusLabel}
                  </MorphPill>
                </div>

                {fee.status === 'paid' && (
                  <div className="paid-celebration" style={{ position: 'relative' }}>
                    <ParticleBurst trigger={paidBurstCount} />
                    <CheckDraw size={38} />
                    <div>
                      <strong>Payment Verified by Server</strong>
                      <p className="field-hint" style={{ margin: 0 }}>
                        {formatPaise(fee.amountPaise)} settled and reflected on the coach dashboard.
                      </p>
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <AnimatedNumber
                      value={fee.amountPaise}
                      format={formatAnimatedRupees}
                      className="fee-amount"
                    />
                    <div className="field-hint mono">
                      {fee.amountPaise} paise · {fee.currency} · Cashfree Sandbox
                    </div>
                  </div>

                  <div className="button-row">
                    {fee.status === 'unpaid' && (
                      <MagneticButton
                        className="btn btn-primary"
                        onClick={() => void handleStartCheckout(fee)}
                        disabled={busyFeeId === fee.id}
                      >
                        {busyFeeId === fee.id ? (
                          <TextShimmer>Preparing Sandbox Checkout…</TextShimmer>
                        ) : (
                          <>
                            Pay {formatPaise(fee.amountPaise)} via Cashfree Sandbox
                            <ArrowIcon />
                          </>
                        )}
                      </MagneticButton>
                    )}

                    {fee.status === 'processing' && (
                      <>
                        {knownOrderId && (
                          <MagneticButton
                            className="btn btn-teal"
                            onClick={() => void handleVerifyOrder(knownOrderId)}
                            disabled={verifyingOrderId === knownOrderId}
                          >
                            <RefreshIcon />
                            {verifyingOrderId === knownOrderId ? (
                              <TextShimmer>Checking with Cashfree…</TextShimmer>
                            ) : (
                              'Recheck Payment Status'
                            )}
                          </MagneticButton>
                        )}
                        <MagneticButton
                          className="btn btn-secondary"
                          onClick={() => void handleStartCheckout(fee)}
                          disabled={busyFeeId === fee.id}
                        >
                          Reopen Checkout
                        </MagneticButton>
                      </>
                    )}

                    {fee.status === 'paid' && knownOrderId && (
                      <MagneticButton
                        className="btn btn-secondary"
                        onClick={() => void handleVerifyOrder(knownOrderId)}
                        disabled={verifyingOrderId === knownOrderId}
                      >
                        <RefreshIcon />
                        {verifyingOrderId === knownOrderId
                          ? 'Verifying…'
                          : 'Verify Receipt (Idempotent Check)'}
                      </MagneticButton>
                    )}
                  </div>
                </div>

                {knownOrderId && (
                  <p className="field-hint mono" style={{ margin: 0 }}>
                    Order Reference: {knownOrderId}
                  </p>
                )}
              </SpotlightCard>
            );
          })}
        </ul>
      )}

      <div className="coach-grid" style={{ marginTop: '1.25rem' }}>
        <SpotlightCard
          as="section"
          className="card"
          spotlightColor="rgba(89, 124, 128, 0.24)"
          delay={0.14}
          aria-labelledby="secure-id-heading"
        >
          <div className="preview-header">
            <h2 id="secure-id-heading" className="section-heading" style={{ margin: 0 }}>
              Adult Contact Verification
            </h2>
            <MorphPill
              keyValue={`contact-${billing?.contactStatus ?? 'unverified'}`}
              tone={
                billing?.contactStatus === 'verified' ? 'pill-teal' : 'pill-terracotta'
              }
            >
              {billing?.contactStatus ?? 'unverified'}
            </MorphPill>
          </div>
          <p className="section-caption">
            Verify the linked adult mobile number via Cashfree Secure ID OTP before Relay voice
            calls can run.
          </p>

          <form onSubmit={handleStartContact} style={{ marginBottom: '1rem' }}>
            <div className="field-group">
              <label htmlFor={phoneInputId} className="field-label">
                Linked adult mobile number
              </label>
              <input
                id={phoneInputId}
                name="phone"
                type="tel"
                autoComplete="tel"
                className="text-input"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                required
              />
            </div>

            <MagneticButton type="submit" className="btn btn-secondary" disabled={contactBusy}>
              {contactBusy ? 'Sending OTP…' : 'Send Secure ID OTP'}
            </MagneticButton>
          </form>

          {challengeId && (
            <form onSubmit={handleVerifyOtp} style={{ marginBottom: '1rem' }}>
              <div className="field-group">
                <label htmlFor={otpInputId} className="field-label">
                  6-digit verification OTP {maskedPhone ? `for ${maskedPhone}` : ''}
                </label>
                {fixtureMode && (
                  <span className="field-hint mono">
                    Sandbox test OTP: {FIXTURE_SANDBOX_OTP}
                  </span>
                )}
                <div className="otp-stack">
                  <div className="otp-slots" aria-hidden="true">
                    {otpChars.map((ch, idx) => (
                      <span
                        key={idx}
                        className={`otp-slot mono ${ch ? 'is-filled' : ''}`}
                      >
                        {ch || '·'}
                      </span>
                    ))}
                  </div>
                  <input
                    id={otpInputId}
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    className="otp-overlay-input mono"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                </div>
              </div>

              <MagneticButton type="submit" className="btn btn-teal" disabled={contactBusy}>
                Verify Secure ID OTP
              </MagneticButton>
            </form>
          )}

          <div className="consent-row">
            <div>
              <strong>Relay Voice Outreach Consent</strong>
              <p className="field-hint" style={{ margin: '0.15rem 0 0' }}>
                Required for pre-charge reminders &amp; recovery calls (revocable anytime).
              </p>
            </div>
            <ToggleSwitch
              pressed={billing?.outreachConsent === 'granted'}
              onToggle={() => void handleToggleConsent()}
            >
              {billingBusy
                ? 'Updating…'
                : billing?.outreachConsent === 'granted'
                  ? 'Granted'
                  : 'Withheld'}
            </ToggleSwitch>
          </div>
        </SpotlightCard>

        <SpotlightCard
          as="section"
          className="card-elevated"
          spotlightColor="rgba(158, 92, 85, 0.24)"
          delay={0.18}
          aria-labelledby="mandate-heading"
        >
          <div className="preview-header">
            <h2 id="mandate-heading" className="section-heading" style={{ margin: 0 }}>
              Monthly Auto-Pay Mandate
            </h2>
            <MorphPill
              keyValue={`sub-${billing?.subscription?.status ?? 'none'}`}
              tone={
                billing?.subscription?.status === 'active' ? 'pill-teal' : 'pill-terracotta'
              }
            >
              {billing?.subscription?.status ?? 'not enrolled'}
            </MorphPill>
          </div>
          <p className="section-caption">
            Revocable on-demand Cashfree mandate. Confirm or cancel before the billing cutoff.
          </p>

          <dl className="kv-list" style={{ marginBottom: '1.15rem' }}>
            <div className="kv-row">
              <dt>Subscription ID</dt>
              <dd className="mono">{billing?.subscription?.id ?? 'None'}</dd>
            </div>
            <div className="kv-row">
              <dt>Current Cycle</dt>
              <dd className="mono">
                {billing?.cycle ? `${billing.cycle.id} (${billing.cycle.status})` : 'No active cycle'}
              </dd>
            </div>
            <div className="kv-row">
              <dt>Cycle Fee</dt>
              <dd>{billing?.cycle ? formatPaise(billing.cycle.amountPaise) : '—'}</dd>
            </div>
          </dl>

          <div className="button-row">
            <MagneticButton
              className="btn btn-secondary"
              onClick={() => void handleEnrolSubscription()}
              disabled={billingBusy}
            >
              {billing?.subscription ? 'Refresh Mandate Session' : 'Enrol Cashfree Mandate'}
            </MagneticButton>

            {billing?.cycle && (
              <>
                <MagneticButton
                  className="btn btn-teal"
                  onClick={() => void handleCycleDecision('keep')}
                  disabled={billingBusy || billing.subscription?.status === 'cancelled'}
                >
                  Keep Mandate
                </MagneticButton>
                <MagneticButton
                  className="btn btn-terracotta"
                  onClick={() => setShowCancellation(true)}
                  disabled={
                    billingBusy ||
                    billing.subscription?.status === 'cancelled' ||
                    billing.subscription?.status === 'cancel_pending'
                  }
                >
                  Cancel Mandate
                </MagneticButton>
              </>
            )}
          </div>

          {showCancellation && (
            <ParentCancellationPrompt
              onKeep={() => setShowCancellation(false)}
              onConfirm={() => {
                setShowCancellation(false);
                void handleCycleDecision('cancel_subscription');
              }}
            />
          )}

          {billing?.cycle?.status === 'recovery_available' && billing.cycle.recoveryUrl && (
            <div className="alert alert-error" style={{ marginTop: '1rem' }}>
              <strong>Auto-debit failed — recovery link ready</strong>
              <p style={{ margin: '0.35rem 0 0.75rem' }}>
                Complete one-time PG recovery checkout via Cashfree Sandbox:
              </p>
              <a
                href={billing.cycle.recoveryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-compact"
              >
                Open Cashfree Recovery Link
              </a>
            </div>
          )}
        </SpotlightCard>
      </div>

      <dialog
        ref={dialogRef}
        className="modal-dialog"
        aria-labelledby={modalTitleId}
        onCancel={() => setActiveCheckout(null)}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.75rem',
          }}
        >
          <h2 id={modalTitleId} className="section-heading" style={{ margin: 0 }}>
            Cashfree PG Sandbox (Fixture)
          </h2>
          <span className="pill pill-sandbox mono">SANDBOX</span>
        </div>

        <p className="section-caption">
          Simulated hosted checkout for local verification before Cashfree keys are connected.
        </p>

        {activeCheckout && (
          <dl className="kv-list" style={{ marginBottom: '1.25rem' }}>
            <div className="kv-row">
              <dt>Player</dt>
              <dd>{activeCheckout.fee.playerName}</dd>
            </div>
            <div className="kv-row">
              <dt>Order ID</dt>
              <dd className="mono">{activeCheckout.session.orderId}</dd>
            </div>
            <div className="kv-row">
              <dt>Payment Session</dt>
              <dd className="mono">{activeCheckout.session.paymentSessionId}</dd>
            </div>
            <div className="kv-row">
              <dt>Stored Amount</dt>
              <dd>{formatPaise(activeCheckout.fee.amountPaise)}</dd>
            </div>
          </dl>
        )}

        <div className="button-row">
          <MagneticButton
            className="btn btn-teal"
            onClick={() => void handleFixtureCheckoutOutcome('paid')}
          >
            Complete Sandbox Payment &amp; Return
          </MagneticButton>
          <MagneticButton
            className="btn btn-secondary"
            onClick={() => void handleFixtureCheckoutOutcome('processing')}
          >
            Return as Processing
          </MagneticButton>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              dialogRef.current?.close();
              setActiveCheckout(null);
            }}
          >
            Cancel
          </button>
        </div>
      </dialog>
    </div>
  );
}
