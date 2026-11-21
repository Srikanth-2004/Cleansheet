'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  createFeeCheckout,
  fetchParentFees,
  verifyOrder,
} from '@/lib/client/api';
import { openCashfreeSandboxCheckout } from '@/lib/client/cashfree';
import { setFixtureFeeStatusForTesting, setFixtureSimulatedOutcome } from '@/lib/client/fixtures';
import {
  type CheckoutSessionData,
  DEFAULT_DEMO_PERIOD,
  formatPaise,
  type MeData,
  type ParentFee,
} from '@/lib/client/types';
import { ArrowIcon, RefreshIcon } from './icons';
import {
  AnimatedAlert,
  AnimatedNumber,
  BlurReveal,
  CheckDraw,
  MagneticButton,
  MorphPill,
  ParticleBurst,
  SpotlightCard,
  TextShimmer,
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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const autoVerifiedRef = useRef<string | null>(null);
  const celebratedFeeIdsRef = useRef<Set<string>>(new Set());

  const [period] = useState<string>(DEFAULT_DEMO_PERIOD);
  const [fees, setFees] = useState<ParentFee[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyFeeId, setBusyFeeId] = useState<string | null>(null);
  const [verifyingOrderId, setVerifyingOrderId] = useState<string | null>(null);
  const [paidBurstCount, setPaidBurstCount] = useState<number>(0);

  const [activeCheckout, setActiveCheckout] = useState<{
    fee: ParentFee;
    session: CheckoutSessionData;
  } | null>(null);
  const [lastOrderIdByFee, setLastOrderIdByFee] = useState<Record<string, string>>({});

  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const loadFees = useCallback(async () => {
    setLoading(true);
    const res = await fetchParentFees(period);
    setLoading(false);

    if (res.ok) {
      setFees(res.data.fees);
      setErrorMessage('');
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }, [period]);

  useEffect(() => {
    void loadFees();
  }, [loadFees, refreshSignal]);

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
        await loadFees();
      } else {
        setErrorMessage(`${res.error.code}: ${res.error.message}`);
      }
    },
    [loadFees],
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

  return (
    <div>
      <div className="page-intro">
        <div>
          <p className="eyebrow">
            {me.academyName} · {me.teamName} Squad
          </p>
          <BlurReveal
            as="h1"
            id="main-heading"
            tabIndex={-1}
            className="page-title"
            text="Parent Fee & Checkout"
            highlightWords={['Checkout']}
          />
          <p className="page-subtitle">
            Billing period <span className="mono">{period}</span> · Review linked player fees and
            complete Cashfree Sandbox checkout.
          </p>
        </div>

        <MagneticButton
          className="btn btn-secondary"
          onClick={() => void loadFees()}
          disabled={loading}
        >
          <RefreshIcon />
          {loading ? 'Loading…' : 'Refresh Fee Status'}
        </MagneticButton>
      </div>

      <div aria-live="polite" aria-atomic="true">
        <AnimatedAlert message={errorMessage} tone="error" role="alert" />
        {!errorMessage && <AnimatedAlert message={statusMessage} tone="success" role="status" />}
      </div>

      {loading ? (
        <div className="card status-card">
          <TextShimmer>Loading linked player fees…</TextShimmer>
        </div>
      ) : fees.length === 0 ? (
        <SpotlightCard
          className="card"
          spotlightColor="rgba(89, 124, 128, 0.22)"
          delay={0.05}
        >
          <h2 className="section-heading">No Fees Due Yet</h2>
          <p className="section-caption" style={{ marginBottom: 0 }}>
            Once the coach confirms a fee proposal from Raz for period{' '}
            <span className="mono">{period}</span>, it will appear here for Cashfree Sandbox
            checkout.
          </p>
        </SpotlightCard>
      ) : (
        <ul className="fee-list">
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
                delay={0.06 * index}
              >
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
          <span className="pill pill-sandbox">SANDBOX</span>
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
