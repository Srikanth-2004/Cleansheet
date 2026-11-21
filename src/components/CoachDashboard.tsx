'use client';

import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  approveCoachRefund,
  confirmCoachFee,
  fetchCoachNotifications,
  fetchCoachPayments,
  fetchCoachRefunds,
  fetchCoachSummary,
  previewRazFee,
} from '@/lib/client/api';
import {
  type BrowserAudioRecorder,
  createAudioRecorder,
  detectSupportedAudioMimeType,
} from '@/lib/client/recorder';
import { RELAY_CALL_SCRIPTS } from '@/lib/client/relay-scripts';
import {
  type CoachNotification,
  type CoachPaidFee,
  type CoachSummaryData,
  type CreateFeeData,
  DEFAULT_DEMO_PERIOD,
  formatPaise,
  LOCALE_OPTIONS,
  type Locale,
  type MeData,
  type RazPreviewData,
  type RefundCaseView,
} from '@/lib/client/types';
import { MicIcon, RefreshIcon, SparkIcon, StopIcon } from './icons';
import {
  AnimatedAlert,
  AnimatedNumber,
  BlurReveal,
  CheckDraw,
  fadeSwap,
  LifecyclePipeline,
  MagneticButton,
  MorphPill,
  ParticleBurst,
  type PipelineStage,
  PulseRings,
  SpotlightCard,
  TextShimmer,
  VoiceWave,
} from './motion/primitives';

interface CoachDashboardProps {
  me: MeData;
  fixtureMode: boolean;
  refreshSignal?: number;
}

const formatAnimatedRupees = (paise: number) =>
  formatPaise(paise % 100 === 0 ? paise : Math.round(paise / 100) * 100);

export function CoachDashboard({ me, fixtureMode, refreshSignal = 0 }: CoachDashboardProps) {
  const periodInputId = useId();
  const commandInputId = useId();
  const commandHintId = useId();

  const [period, setPeriod] = useState<string>(DEFAULT_DEMO_PERIOD);
  const [locale, setLocale] = useState<Locale>('hi-IN');
  const [commandText, setCommandText] = useState<string>('');

  const [summary, setSummary] = useState<CoachSummaryData>({
    expectedPaise: 0,
    collectedPaise: 0,
    outstandingPaise: 0,
    paidFeeCount: 0,
  });
  const [notifications, setNotifications] = useState<CoachNotification[]>([]);
  const [payments, setPayments] = useState<CoachPaidFee[]>([]);
  const [paymentListError, setPaymentListError] = useState(false);
  const [refunds, setRefunds] = useState<RefundCaseView[]>([]);
  const [loadingSummary, setLoadingSummary] = useState<boolean>(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  const [supportedMimeType, setSupportedMimeType] = useState<string>('checking...');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [lastAudioMeta, setLastAudioMeta] = useState<string>('');

  const [previewBusy, setPreviewBusy] = useState<boolean>(false);
  const [previewResult, setPreviewResult] = useState<RazPreviewData | null>(null);
  const [confirmBusy, setConfirmBusy] = useState<boolean>(false);
  const [confirmedFee, setConfirmedFee] = useState<CreateFeeData | null>(null);
  const [confirmBurstCount, setConfirmBurstCount] = useState<number>(0);
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);

  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const recorderRef = useRef<BrowserAudioRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  const selectedLocaleMeta =
    LOCALE_OPTIONS.find((item) => item.value === locale) ?? LOCALE_OPTIONS[0];

  const loadCoachWorkspace = useCallback(async () => {
    setLoadingSummary(true);
    const [sumRes, notifRes, refundRes, paymentsRes] = await Promise.all([
      fetchCoachSummary(period),
      fetchCoachNotifications(),
      fetchCoachRefunds(),
      fetchCoachPayments(period),
    ]);
    setLoadingSummary(false);

    if (sumRes.ok) {
      setSummary(sumRes.data);
      setLastRefreshedAt(new Date().toLocaleTimeString('en-IN', { hour12: true }));
      setErrorMessage('');
    } else {
      setErrorMessage(`${sumRes.error.code}: ${sumRes.error.message}`);
    }

    if (notifRes.ok) {
      setNotifications(notifRes.data.notifications);
    }
    if (refundRes.ok) {
      setRefunds(refundRes.data.refunds);
    }
    setPayments(paymentsRes.ok ? paymentsRes.data.payments : []);
    setPaymentListError(!paymentsRes.ok);
  }, [period]);

  useEffect(() => {
    void loadCoachWorkspace();
  }, [loadCoachWorkspace, refreshSignal]);

  useEffect(() => {
    const detected = detectSupportedAudioMimeType();
    if (detected === null) {
      setSupportedMimeType('MediaRecorder unsupported');
    } else if (detected === '') {
      setSupportedMimeType('browser default');
    } else {
      setSupportedMimeType(detected);
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      recorderRef.current?.cancel();
    };
  }, []);

  async function handleStartRecording() {
    setErrorMessage('');
    setStatusMessage('');
    setConfirmedFee(null);

    try {
      const recorder = createAudioRecorder();
      recorderRef.current = recorder;
      await recorder.start((levels) => setAudioLevels(levels));
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setIsRecording(false);
      setAudioLevels([]);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not access microphone. Use typed input below.',
      );
    }
  }

  async function handleStopRecording() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder) {
      setIsRecording(false);
      setAudioLevels([]);
      return;
    }

    setIsRecording(false);
    setAudioLevels([]);
    setPreviewBusy(true);

    try {
      const recorded = await recorder.stop();
      setLastAudioMeta(
        `Captured ${(recorded.durationMs / 1000).toFixed(1)}s (${recorded.mimeType})`,
      );
      const res = await previewRazFee({
        audio: recorded.blob,
        mimeType: recorded.mimeType,
        locale,
        period,
      });
      if (res.ok) {
        setPreviewResult(res.data);
        setStatusMessage(
          'Raz prepared a fee preview from your voice command. Zero fee records created yet — review and confirm.',
        );
      } else {
        setPreviewResult(null);
        setErrorMessage(`${res.error.code}: ${res.error.message}`);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Recording failed.');
    } finally {
      recorderRef.current = null;
      setPreviewBusy(false);
    }
  }

  async function handleRunSampleClipFixture() {
    setErrorMessage('');
    setStatusMessage('');
    setConfirmedFee(null);
    setPreviewBusy(true);

    const sampleBlob = new Blob(['cleansheet-sample-voice-fixture'], {
      type: supportedMimeType.startsWith('audio/') ? supportedMimeType : 'audio/webm',
    });
    setLastAudioMeta(`Sample fixture clip (${sampleBlob.type})`);

    const res = await previewRazFee({
      audio: sampleBlob,
      mimeType: sampleBlob.type,
      locale,
      period,
      fixtureOnly: true,
    });
    setPreviewBusy(false);

    if (res.ok) {
      setPreviewResult(res.data);
      setStatusMessage(
        'Raz prepared a fee preview from the sample voice clip. Zero fee records created yet.',
      );
    } else {
      setPreviewResult(null);
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  async function submitTypedCommand() {
    setErrorMessage('');
    setStatusMessage('');
    setConfirmedFee(null);
    setPreviewBusy(true);

    const res = await previewRazFee({
      text: commandText,
      locale,
      period,
    });
    setPreviewBusy(false);

    if (res.ok) {
      setPreviewResult(res.data);
      setStatusMessage(
        'Raz prepared a fee preview from typed input. Zero fee records created yet — confirm below.',
      );
    } else {
      setPreviewResult(null);
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  function handleTypedSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitTypedCommand();
  }

  function handleCommandKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitTypedCommand();
    }
  }

  async function handleConfirmFee() {
    if (!previewResult) {
      return;
    }

    setErrorMessage('');
    setStatusMessage('');
    setConfirmBusy(true);

    const res = await confirmCoachFee({
      period: previewResult.preview.period,
      amountPaise: previewResult.preview.amountPaise,
    });
    setConfirmBusy(false);

    if (res.ok) {
      if (!confirmedFee) {
        setConfirmBurstCount((c) => c + 1);
      }
      setConfirmedFee(res.data);
      setStatusMessage(
        `Fee confirmed (${res.data.feeId}, status: ${res.data.status}). Collections refreshed.`,
      );
      await loadCoachWorkspace();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  async function handleApproveRefund(caseId: string, amountPaise: number) {
    setErrorMessage('');
    setStatusMessage('');
    setRefundBusyId(caseId);

    const res = await approveCoachRefund(caseId, amountPaise);
    setRefundBusyId(null);

    if (res.ok) {
      setStatusMessage(
        `Refund approved for ${caseId} (${formatPaise(res.data.amountPaise ?? amountPaise)}, ref ${res.data.refundId}). Net collected updated.`,
      );
      await loadCoachWorkspace();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  const collectionPct =
    summary.expectedPaise > 0
      ? Math.min(100, Math.round((summary.collectedPaise / summary.expectedPaise) * 100))
      : 0;

  const hasFee = summary.expectedPaise > 0;
  const hasPaid = summary.paidFeeCount > 0;
  const hasRefunded = refunds.some((r) => r.status === 'refunded');

  const stages: PipelineStage[] = [
    {
      id: 'voice',
      code: '01',
      label: 'Raz Voice Preview',
      state: previewResult || hasFee ? 'done' : 'active',
    },
    {
      id: 'confirm',
      code: '02',
      label: 'Coach Confirmed',
      state: hasFee ? 'done' : previewResult ? 'active' : 'pending',
    },
    {
      id: 'checkout',
      code: '03',
      label: 'Parent / Mandate',
      state: hasPaid ? 'done' : hasFee ? 'active' : 'pending',
    },
    {
      id: 'settled',
      code: '04',
      label: hasRefunded ? 'Refund Reconciled' : 'Ledger Verified',
      state: hasPaid ? 'done' : 'pending',
    },
  ];

  return (
    <div>
      <div className="page-intro">
        <div>
          <p className="eyebrow mono">
            CONSOLE // {me.academyName} · {me.teamName} SQUAD
          </p>
          <BlurReveal
            as="h1"
            id="main-heading"
            tabIndex={-1}
            className="page-title"
            text="Coach Command Deck"
            highlightWords={['Deck']}
          />
          <p className="page-subtitle">
            Period <span className="mono">{period}</span> · Sarvam STT + MCP ledger + Cashfree
            reconciliation.
          </p>
        </div>

        <div className="button-row">
          <MagneticButton
            className="btn btn-teal"
            onClick={() => void loadCoachWorkspace()}
            disabled={loadingSummary}
          >
            <RefreshIcon />
            {loadingSummary ? 'Refreshing…' : 'Refresh Collections'}
          </MagneticButton>
        </div>
      </div>

      <LifecyclePipeline stages={stages} />

      <section aria-label="Squad fee summary" className="summary-grid">
        <SpotlightCard
          className="metric-card"
          spotlightColor="rgba(242, 233, 231, 0.14)"
          delay={0.04}
        >
          <span className="metric-label mono">01 // Expected</span>
          <AnimatedNumber
            value={summary.expectedPaise}
            format={formatAnimatedRupees}
            className="metric-value"
          />
          <span className="metric-hint mono">{summary.expectedPaise} paise</span>
        </SpotlightCard>

        <SpotlightCard
          className="metric-card metric-card-collected"
          spotlightColor="rgba(89, 124, 128, 0.34)"
          delay={0.08}
        >
          <span className="metric-label mono">02 // Net Collected</span>
          <AnimatedNumber
            value={summary.collectedPaise}
            format={formatAnimatedRupees}
            className="metric-value"
          />
          <span className="metric-hint">
            {hasRefunded ? 'Net after verified refund' : 'Server-verified Cashfree ledger'}
          </span>
        </SpotlightCard>

        <SpotlightCard
          className="metric-card metric-card-outstanding"
          spotlightColor="rgba(158, 92, 85, 0.34)"
          delay={0.12}
        >
          <span className="metric-label mono">03 // Outstanding</span>
          <AnimatedNumber
            value={summary.outstandingPaise}
            format={formatAnimatedRupees}
            className="metric-value"
          />
          <span className="metric-hint">Awaiting parent checkout</span>
        </SpotlightCard>

        <SpotlightCard
          className="metric-card"
          spotlightColor="rgba(89, 124, 128, 0.24)"
          delay={0.16}
        >
          <span className="metric-label mono">04 // Paid Fees</span>
          <AnimatedNumber value={summary.paidFeeCount} className="metric-value" />
          <span className="metric-hint">
            {lastRefreshedAt ? `Synced ${lastRefreshedAt}` : 'Live period count'}
          </span>
        </SpotlightCard>
      </section>

      <div className="collection-progress-card" aria-label="Period collection progress">
        <div className="collection-progress-header">
          <span className="mono">COLLECTION RATIO // {period}</span>
          <span className="mono">{collectionPct}% net verified</span>
        </div>
        <div className="collection-progress-track">
          <motion.div
            className="collection-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${collectionPct}%` }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>

      <div className="coach-grid">
        <SpotlightCard
          as="section"
          className="card"
          spotlightColor="rgba(89, 124, 128, 0.24)"
          delay={0.2}
          aria-labelledby="raz-command-heading"
        >
          <div className="panel-index mono">01 // RAZ.VOICE.CONSOLE</div>
          <h2 id="raz-command-heading" className="section-heading">
            Ask Raz to Prepare a Fee
          </h2>
          <p className="section-caption">
            Record in Hindi or Kannada, or type the command through the same Sarvam AI + MCP tool
            path.
          </p>

          <fieldset className="fieldset-clean">
            <legend>Command language</legend>
            <div className="radio-row">
              {LOCALE_OPTIONS.map((option) => (
                <label key={option.value} className="radio-option">
                  <input
                    type="radio"
                    name="raz-locale"
                    value={option.value}
                    checked={locale === option.value}
                    onChange={() => setLocale(option.value)}
                  />
                  <span>
                    {option.label} ({option.nativeLabel})
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field-group">
            <label htmlFor={periodInputId} className="field-label">
              Fee period (YYYY-MM)
            </label>
            <input
              id={periodInputId}
              name="period"
              type="text"
              className="text-input"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              pattern="\d{4}-(0[1-9]|1[0-2])"
              required
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="card-elevated voice-panel">
            <div className="voice-panel-header">
              <strong>Voice Command (Sarvam saaras:v4 + 105B)</strong>
              <span className="pill mono">MIME: {supportedMimeType}</span>
            </div>

            <div className="button-row">
              <div className="mic-stage">
                <PulseRings active={isRecording} />
                {!isRecording ? (
                  <MagneticButton
                    className="btn btn-primary"
                    onClick={() => void handleStartRecording()}
                    disabled={previewBusy}
                  >
                    <MicIcon />
                    Record {selectedLocaleMeta.label} Command
                  </MagneticButton>
                ) : (
                  <MagneticButton
                    className="btn btn-terracotta"
                    onClick={() => void handleStopRecording()}
                  >
                    <StopIcon />
                    Stop &amp; Ask Raz ({recordingSeconds}s)
                  </MagneticButton>
                )}
              </div>

              {fixtureMode && (
                <MagneticButton
                  className="btn btn-secondary"
                  onClick={() => void handleRunSampleClipFixture()}
                  disabled={previewBusy || isRecording}
                >
                  <SparkIcon />
                  Run Sample Voice Clip
                </MagneticButton>
              )}
            </div>

            <VoiceWave active={isRecording || previewBusy} levels={audioLevels} />

            {previewBusy && (
              <p className="field-hint" style={{ margin: '0.35rem 0 0' }}>
                <TextShimmer>Raz is transcribing &amp; checking MCP totals…</TextShimmer>
              </p>
            )}

            {lastAudioMeta && (
              <p className="field-hint mono" style={{ margin: '0.4rem 0 0' }}>
                {lastAudioMeta}
              </p>
            )}
          </div>

          <form onSubmit={handleTypedSubmit} aria-labelledby="raz-command-heading">
            <div className="field-group">
              <label htmlFor={commandInputId} className="field-label">
                Typed fallback command ({selectedLocaleMeta.label} or English)
              </label>
              <span id={commandHintId} className="field-hint">
                Sample:{' '}
                <span lang={selectedLocaleMeta.htmlLang}>{selectedLocaleMeta.sampleUtterance}</span>{' '}
                ({selectedLocaleMeta.sampleTranslation})
              </span>
              <textarea
                id={commandInputId}
                name="commandText"
                className="text-area"
                lang={selectedLocaleMeta.htmlLang}
                aria-describedby={commandHintId}
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                onKeyDown={handleCommandKeyDown}
                placeholder={selectedLocaleMeta.sampleUtterance}
                enterKeyHint="send"
              />
            </div>

            <div className="button-row">
              <MagneticButton
                type="submit"
                className="btn btn-teal"
                disabled={previewBusy || isRecording}
              >
                <SparkIcon />
                {previewBusy ? 'Asking Raz…' : 'Preview Fee with Raz'}
              </MagneticButton>
              <MagneticButton
                className="btn btn-secondary"
                onClick={() => setCommandText(selectedLocaleMeta.sampleUtterance)}
              >
                Use Sample {selectedLocaleMeta.label} Phrase
              </MagneticButton>
            </div>
          </form>

          <div aria-live="polite" aria-atomic="true">
            <AnimatedAlert message={errorMessage} tone="error" role="alert" />
            {!errorMessage && <AnimatedAlert message={statusMessage} tone="success" role="status" />}
          </div>
        </SpotlightCard>

        <SpotlightCard
          as="section"
          className="card-elevated"
          spotlightColor={
            confirmedFee ? 'rgba(89, 124, 128, 0.34)' : 'rgba(158, 92, 85, 0.24)'
          }
          delay={0.24}
          aria-labelledby="preview-confirm-heading"
        >
          <div className="panel-index mono">02 // PROPOSAL.CONFIRMATION</div>
          <div className="preview-header">
            <h2 id="preview-confirm-heading" className="section-heading" style={{ margin: 0 }}>
              Fee Proposal Preview
            </h2>
            <MorphPill
              keyValue={confirmedFee ? `confirmed-${confirmedFee.status}` : 'preview'}
              tone={confirmedFee ? 'pill-teal' : 'pill-terracotta'}
            >
              {confirmedFee ? `Confirmed (${confirmedFee.status})` : 'Preview Only'}
            </MorphPill>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {!previewResult ? (
              <motion.p
                key="empty-preview"
                className="section-caption"
                style={{ marginBottom: 0 }}
                {...fadeSwap}
              >
                No proposal loaded yet. Record or submit a command to inspect Raz&apos;s transcript
                and paise amount before writing to the ledger.
              </motion.p>
            ) : (
              <motion.div key={previewResult.transcript} {...fadeSwap}>
                <p className="field-hint" style={{ marginTop: 0 }}>
                  Transcript returned by Raz:
                </p>
                <BlurReveal
                  as="blockquote"
                  className="transcript-box"
                  lang={selectedLocaleMeta.htmlLang}
                  text={previewResult.transcript}
                  stagger={0.03}
                />

                <dl className="kv-list" style={{ marginBottom: '1.25rem' }}>
                  <div className="kv-row">
                    <dt>Academy &amp; Squad</dt>
                    <dd>
                      {me.academyName} · {me.teamName}
                    </dd>
                  </div>
                  <div className="kv-row">
                    <dt>Player</dt>
                    <dd>Demo Player</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Period</dt>
                    <dd className="mono">{previewResult.preview.period}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Proposed Fee</dt>
                    <dd>
                      {formatPaise(previewResult.preview.amountPaise)}{' '}
                      <span className="mono" style={{ color: 'var(--text-muted)' }}>
                        ({previewResult.preview.amountPaise} paise)
                      </span>
                    </dd>
                  </div>
                  {previewResult.mcpSummary && (
                    <div className="kv-row">
                      <dt>MCP get_fee_summary</dt>
                      <dd className="mono">
                        Exp {formatPaise(previewResult.mcpSummary.expectedPaise)} · Col{' '}
                        {formatPaise(previewResult.mcpSummary.collectedPaise)}
                      </dd>
                    </div>
                  )}
                  {confirmedFee && (
                    <div className="kv-row">
                      <dt>Created Fee Record</dt>
                      <dd className="mono">
                        {confirmedFee.feeId} · {confirmedFee.status}
                      </dd>
                    </div>
                  )}
                </dl>

                {confirmedFee && (
                  <div className="confirm-celebration">
                    <CheckDraw size={36} />
                    <span>Fee confirmed &amp; published to linked parent</span>
                  </div>
                )}

                <div className="button-row" style={{ position: 'relative' }}>
                  <ParticleBurst trigger={confirmBurstCount} />
                  <MagneticButton
                    className="btn btn-primary"
                    onClick={() => void handleConfirmFee()}
                    disabled={confirmBusy}
                  >
                    {confirmBusy
                      ? 'Confirming…'
                      : confirmedFee
                        ? `Confirmed (${formatPaise(previewResult.preview.amountPaise)})`
                        : `Confirm & Create Fee (${formatPaise(previewResult.preview.amountPaise)})`}
                  </MagneticButton>
                  <MagneticButton
                    className="btn btn-secondary"
                    onClick={() => {
                      setPreviewResult(null);
                      setConfirmedFee(null);
                      setStatusMessage('');
                      setErrorMessage('');
                    }}
                  >
                    Clear Preview
                  </MagneticButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </SpotlightCard>
      </div>

      <div className="coach-grid" style={{ marginTop: '1.25rem' }}>
        <SpotlightCard
          as="section"
          className="card"
          spotlightColor="rgba(158, 92, 85, 0.24)"
          delay={0.28}
          aria-labelledby="refund-desk-heading"
        >
          <div className="panel-index mono">03 // SCOPED.REFUND.APPROVAL</div>
          <h2 id="refund-desk-heading" className="section-heading">
            Refund Cases
          </h2>
          <p className="section-caption">
            Approve bounded partial or full refunds on the original Cashfree rail without reopening
            settled fee records.
          </p>

          {refunds.length === 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>
              No active refund cases. Switch to <strong>Refund ₹500</strong> in the top bar (or open
              a case) to test net-collected reconciliation.
            </p>
          ) : (
            <ul className="notif-list">
              {refunds.map((item) => (
                <li key={item.caseId} className="notif-item">
                  <div className="notif-header">
                    <strong className="mono">{item.caseId}</strong>
                    <span
                      className={`pill mono ${
                        item.status === 'refunded' ? 'pill-teal' : 'pill-terracotta'
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="field-hint" style={{ margin: '0.25rem 0 0.75rem' }}>
                    Amount: <strong>{formatPaise(item.amountPaise ?? 50000)}</strong>
                    {item.refundId ? ` · Ref: ${item.refundId}` : ''}
                  </p>
                  {item.status !== 'refunded' && (
                    <MagneticButton
                      className="btn btn-terracotta btn-compact"
                      onClick={() =>
                        void handleApproveRefund(item.caseId, item.amountPaise ?? 50000)
                      }
                      disabled={refundBusyId === item.caseId}
                    >
                      {refundBusyId === item.caseId
                        ? 'Approving Refund…'
                        : `Approve ${formatPaise(item.amountPaise ?? 50000)} Refund`}
                    </MagneticButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SpotlightCard>

        <SpotlightCard
          as="section"
          className="card"
          spotlightColor="rgba(89, 124, 128, 0.24)"
          delay={0.32}
          aria-labelledby="notifications-heading"
        >
          <div className="panel-index mono">04 // RELAY.ALERTS &amp; VOICE.SCRIPTS</div>
          <h2 id="notifications-heading" className="section-heading">
            Coach Notifications &amp; Relay Feed
          </h2>
          <p className="section-caption">
            Payment and cancellation notices, plus bilingual Relay voice scripts.
          </p>

          <h3>Who paid</h3>
          {paymentListError ? <p role="alert">Paid fees could not be loaded.</p> : payments.length > 0 ? (
            <ul className="notif-list">
              {payments.map(payment => (
                <li key={payment.feeId} className="notif-item">
                  <strong>{payment.playerName}</strong> · {formatPaise(payment.amountPaise)} paid
                  {payment.netPaise < payment.amountPaise && ` · ${formatPaise(payment.netPaise)} after refunds`}
                </li>
              ))}
            </ul>
          ) : <p className="field-hint">No verified payments for this month.</p>}

          {notifications.length === 0 ? (
            <p className="field-hint">
              No billing notifications yet. Complete a sandbox payment, cancellation, or refund to
              see single-delivery ledger events.
            </p>
          ) : (
            <ul className="notif-list" style={{ marginBottom: '1rem' }}>
              {notifications.map((note) => (
                <li key={note.id} className="notif-item">
                  <div className="notif-header">
                    <span className="pill pill-teal mono">{note.kind.replaceAll('_', ' ')}</span>
                    {typeof note.amountPaise === 'number' && (
                      <strong className="mono">{formatPaise(note.amountPaise)}</strong>
                    )}
                  </div>
                  <p style={{ margin: '0.4rem 0 0.15rem', fontSize: '0.94rem' }}>
                    {note.subjectLabel}
                  </p>
                  <span className="field-hint mono">{note.occurredAt}</span>
                </li>
              ))}
            </ul>
          )}

          <details className="relay-details">
            <summary className="mono">View Bilingual Relay Scripts ({RELAY_CALL_SCRIPTS.length})</summary>
            <ul className="notif-list" style={{ marginTop: '0.75rem' }}>
              {RELAY_CALL_SCRIPTS.map((script) => (
                <li key={script.kind} className="notif-item">
                  <div className="notif-header">
                    <strong>{script.title}</strong>
                    <span className="pill mono">{script.kind}</span>
                  </div>
                  <p className="field-hint" style={{ margin: '0.3rem 0' }}>
                    {script.englishSummary}
                  </p>
                  <p className="field-hint" lang="hi" style={{ margin: '0.25rem 0' }}>
                    <strong>HI:</strong> {script.hindiScript}
                  </p>
                  <p className="field-hint" lang="kn" style={{ margin: '0.25rem 0 0' }}>
                    <strong>KN:</strong> {script.kannadaScript}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        </SpotlightCard>
      </div>
    </div>
  );
}
