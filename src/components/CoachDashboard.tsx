'use client';

import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  confirmCoachFee,
  fetchCoachSummary,
  previewRazFee,
} from '@/lib/client/api';
import {
  type BrowserAudioRecorder,
  createAudioRecorder,
  detectSupportedAudioMimeType,
} from '@/lib/client/recorder';
import {
  type CoachSummaryData,
  type CreateFeeData,
  DEFAULT_DEMO_PERIOD,
  formatPaise,
  LOCALE_OPTIONS,
  type Locale,
  type MeData,
  type RazPreviewData,
} from '@/lib/client/types';
import { MicIcon, RefreshIcon, SparkIcon, StopIcon } from './icons';
import {
  AnimatedAlert,
  AnimatedNumber,
  BlurReveal,
  CheckDraw,
  fadeSwap,
  MagneticButton,
  MorphPill,
  ParticleBurst,
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
  const [loadingSummary, setLoadingSummary] = useState<boolean>(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  const [supportedMimeType, setSupportedMimeType] = useState<string>('checking...');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [lastAudioMeta, setLastAudioMeta] = useState<string>('');

  const [previewBusy, setPreviewBusy] = useState<boolean>(false);
  const [previewResult, setPreviewResult] = useState<RazPreviewData | null>(null);
  const [confirmBusy, setConfirmBusy] = useState<boolean>(false);
  const [confirmedFee, setConfirmedFee] = useState<CreateFeeData | null>(null);
  const [confirmBurstCount, setConfirmBurstCount] = useState<number>(0);

  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const recorderRef = useRef<BrowserAudioRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  const selectedLocaleMeta =
    LOCALE_OPTIONS.find((item) => item.value === locale) ?? LOCALE_OPTIONS[0];

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    const res = await fetchCoachSummary(period);
    setLoadingSummary(false);

    if (res.ok) {
      setSummary(res.data);
      setLastRefreshedAt(new Date().toLocaleTimeString('en-IN', { hour12: true }));
      setErrorMessage('');
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }, [period]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, refreshSignal]);

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
      await recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setIsRecording(false);
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
      return;
    }

    setIsRecording(false);
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
      await loadSummary();
    } else {
      setErrorMessage(`${res.error.code}: ${res.error.message}`);
    }
  }

  const collectionPct =
    summary.expectedPaise > 0
      ? Math.min(100, Math.round((summary.collectedPaise / summary.expectedPaise) * 100))
      : 0;

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
            text="Coach Collections Dashboard"
            highlightWords={['Collections']}
          />
          <p className="page-subtitle">
            Billing period <span className="mono">{period}</span> · Speak to Raz, confirm the
            preview, and track verified settlements.
          </p>
        </div>

        <div className="button-row">
          <MagneticButton
            className="btn btn-teal"
            onClick={() => void loadSummary()}
            disabled={loadingSummary}
          >
            <RefreshIcon />
            {loadingSummary ? 'Refreshing…' : 'Refresh Collections'}
          </MagneticButton>
        </div>
      </div>

      <section aria-label="Squad fee summary" className="summary-grid">
        <SpotlightCard
          className="metric-card"
          spotlightColor="rgba(242, 233, 231, 0.14)"
          delay={0.04}
        >
          <span className="metric-label">Expected</span>
          <AnimatedNumber
            value={summary.expectedPaise}
            format={formatAnimatedRupees}
            className="metric-value"
          />
          <span className="metric-hint mono">{summary.expectedPaise} paise</span>
        </SpotlightCard>

        <SpotlightCard
          className="metric-card metric-card-collected"
          spotlightColor="rgba(89, 124, 128, 0.32)"
          delay={0.09}
        >
          <span className="metric-label">Collected</span>
          <AnimatedNumber
            value={summary.collectedPaise}
            format={formatAnimatedRupees}
            className="metric-value"
          />
          <span className="metric-hint">Server-verified Cashfree payments</span>
        </SpotlightCard>

        <SpotlightCard
          className="metric-card metric-card-outstanding"
          spotlightColor="rgba(158, 92, 85, 0.32)"
          delay={0.14}
        >
          <span className="metric-label">Outstanding</span>
          <AnimatedNumber
            value={summary.outstandingPaise}
            format={formatAnimatedRupees}
            className="metric-value"
          />
          <span className="metric-hint">Awaiting parent checkout</span>
        </SpotlightCard>

        <SpotlightCard
          className="metric-card"
          spotlightColor="rgba(89, 124, 128, 0.22)"
          delay={0.19}
        >
          <span className="metric-label">Paid Fees</span>
          <AnimatedNumber value={summary.paidFeeCount} className="metric-value" />
          <span className="metric-hint">
            {lastRefreshedAt ? `Updated ${lastRefreshedAt}` : 'Live period count'}
          </span>
        </SpotlightCard>
      </section>

      <div className="collection-progress-card" aria-label="Period collection progress">
        <div className="collection-progress-header">
          <span>Collection progress ({period})</span>
          <span className="mono">{collectionPct}% verified</span>
        </div>
        <div className="collection-progress-track">
          <motion.div
            className="collection-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${collectionPct}%` }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      <div className="coach-grid">
        <SpotlightCard
          as="section"
          className="card"
          spotlightColor="rgba(89, 124, 128, 0.24)"
          delay={0.22}
          aria-labelledby="raz-command-heading"
        >
          <h2 id="raz-command-heading" className="section-heading">
            Ask Raz to Prepare a Fee
          </h2>
          <p className="section-caption">
            Record in Hindi or Kannada, or type the command through the same Sarvam AI preview path.
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
              <strong>Voice Command (Sarvam STT + Tool Call)</strong>
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

            <VoiceWave active={isRecording || previewBusy} />

            {previewBusy && (
              <p className="field-hint" style={{ margin: '0.35rem 0 0' }}>
                <TextShimmer>Raz is listening &amp; drafting preview…</TextShimmer>
              </p>
            )}

            {lastAudioMeta && (
              <p className="field-hint" style={{ margin: '0.4rem 0 0' }}>
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
          delay={0.28}
          aria-labelledby="preview-confirm-heading"
        >
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
                No proposal loaded yet. Record or submit a fee command to see Raz&apos;s transcript
                and extracted paise amount before any fee is written.
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
                  stagger={0.04}
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
    </div>
  );
}
