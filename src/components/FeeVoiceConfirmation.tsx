'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFeePreviewAudio, sendCoachFeeByVoice } from '@/lib/client/api';
import { createAudioRecorder, type BrowserAudioRecorder } from '@/lib/client/recorder';
import type { CreateFeeData, Locale, RazFeeProposal } from '@/lib/client/types';
import { RazSpeechPlayback } from './RazSpeechPlayback';

const sendPrompts = { 'hi-IN': 'फीस भेज दो', 'kn-IN': 'ಶುಲ್ಕ ಕಳುಹಿಸಿ' };

export function FeeVoiceConfirmation({ preview, locale, autoStart, disabled, onBusyChange, onSent }: {
  preview: RazFeeProposal['preview'];
  locale: Locale;
  autoStart: boolean;
  disabled: boolean;
  onBusyChange(busy: boolean): void;
  onSent(fee: CreateFeeData): void;
}) {
  const [stage, setStage] = useState<'idle' | 'starting' | 'recording' | 'sending'>('idle');
  const [message, setMessage] = useState('');
  const recorder = useRef<BrowserAudioRecorder | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useCallback((signal: AbortSignal) => fetchFeePreviewAudio(preview, locale, signal), [preview, locale]);

  useEffect(() => () => {
    const capture = recorder.current;
    recorder.current = null;
    capture?.cancel();
    request.current?.abort();
    onBusyChange(false);
  }, [onBusyChange]);

  async function recordSend() {
    setMessage('');
    if (stage === 'recording' && recorder.current) {
      setStage('sending');
      const controller = new AbortController();
      request.current = controller;
      try {
        const captured = await recorder.current.stop();
        if (controller.signal.aborted) return;
        const result = await sendCoachFeeByVoice(preview, locale, captured.blob, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) onSent(result.data);
        else setMessage(result.error.message);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Try recording the send command again.');
      } finally {
        recorder.current = null;
        if (!controller.signal.aborted) {
          setStage('idle');
          onBusyChange(false);
        }
      }
      return;
    }
    setStage('starting');
    onBusyChange(true);
    const capture = createAudioRecorder();
    recorder.current = capture;
    try {
      await capture.start();
      if (recorder.current === capture) setStage('recording');
      else capture.cancel();
    } catch {
      if (recorder.current !== capture) return;
      recorder.current = null;
      setMessage('Microphone unavailable. Use Confirm & Create Fee to publish this request.');
      setStage('idle');
      onBusyChange(false);
    }
  }

  return (
    <div>
      <RazSpeechPlayback load={load} label="Raz fee preview" buttonLabel="Hear fee preview" autoStart={autoStart} paused={stage !== 'idle'} />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled || stage === 'starting' || stage === 'sending'}
        onClick={() => void recordSend()}
      >
        {stage === 'recording' ? 'Stop & Send' : stage === 'sending' ? 'Checking send command…' : 'Send by voice'}
      </button>
      <p className="field-hint">Say “Send fee” or <span lang={locale}>“{sendPrompts[locale]}”</span>.</p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
