'use client';

import { useEffect, useRef, useState } from 'react';
import { recognizeParentCancellationAnswer } from '@/lib/client/api';
import { createAudioRecorder, type BrowserAudioRecorder } from '@/lib/client/recorder';

const prompts = {
  'en-IN': {
    language: 'English',
    question: 'Hi, I’m CleanSheet. Do you want to cancel this subscription and stop future automatic payments? Please say yes or no.',
    yes: 'Yes, cancel subscription', no: 'No, keep subscription',
  },
  'hi-IN': {
    language: 'हिन्दी',
    question: 'नमस्ते, मैं क्लीनशीट हूँ। क्या आप यह सदस्यता रद्द करके आगे के स्वचालित भुगतान रोकना चाहते हैं? कृपया हाँ या नहीं कहें।',
    yes: 'हाँ, सदस्यता रद्द करें', no: 'नहीं, सदस्यता जारी रखें',
  },
  'kn-IN': {
    language: 'ಕನ್ನಡ',
    question: 'ನಮಸ್ಕಾರ, ನಾನು ಕ್ಲೀನ್‌ಶೀಟ್. ಈ ಚಂದಾದಾರಿಕೆಯನ್ನು ರದ್ದುಮಾಡಿ ಮುಂದಿನ ಸ್ವಯಂಚಾಲಿತ ಪಾವತಿಗಳನ್ನು ನಿಲ್ಲಿಸಲು ಬಯಸುವಿರಾ? ದಯವಿಟ್ಟು ಹೌದು ಅಥವಾ ಇಲ್ಲ ಎಂದು ಹೇಳಿ.',
    yes: 'ಹೌದು, ಚಂದಾದಾರಿಕೆ ರದ್ದುಮಾಡಿ', no: 'ಇಲ್ಲ, ಚಂದಾದಾರಿಕೆ ಮುಂದುವರಿಸಿ',
  },
} as const;
type PromptLocale = keyof typeof prompts;
const languageKey = 'cleansheet-parent-voice-language';

function preferredLanguage(): PromptLocale {
  if (typeof window === 'undefined') return 'en-IN';
  const saved = window.localStorage.getItem(languageKey);
  if (saved === 'hi-IN' || saved === 'kn-IN' || saved === 'en-IN') return saved;
  const language = window.navigator.language.split('-')[0];
  if (language === 'hi') return 'hi-IN';
  if (language === 'kn') return 'kn-IN';
  return 'en-IN';
}

export function ParentCancellationPrompt({ onConfirm, onKeep }: { onConfirm(): void; onKeep(): void }) {
  const [locale, setLocale] = useState<PromptLocale>(preferredLanguage);
  const [recording, setRecording] = useState<'idle' | 'starting' | 'recording' | 'checking'>('idle');
  const [message, setMessage] = useState('');
  const [playbackError, setPlaybackError] = useState(false);
  const audio = useRef<BrowserAudioRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const promptPlayer = player.current;
    void promptPlayer?.play().catch(() => {});
    return () => {
      audio.current?.cancel();
      audio.current = null;
      promptPlayer?.pause();
    };
  }, []);

  function playPrompt(language: PromptLocale) {
    const promptPlayer = player.current;
    if (!promptPlayer) return;
    setPlaybackError(false);
    const source = `/voice/cancel-${language}.wav`;
    if (promptPlayer.getAttribute('src') !== source) promptPlayer.setAttribute('src', source);
    else promptPlayer.currentTime = 0;
    void promptPlayer.play().catch(error => {
      if (error.name !== 'AbortError') setPlaybackError(true);
    });
  }

  async function recordAnswer() {
    if (recording === 'recording') {
      const recorder = audio.current;
      if (!recorder) return;
      setRecording('checking');
      try {
        const clip = await recorder.stop();
        const result = await recognizeParentCancellationAnswer(clip.blob, locale);
        if (!result.ok) setMessage('Voice recognition is unavailable. Select Yes or No below.');
        else if (result.data.answer === 'yes') setMessage('Heard “Yes”. Select the Yes button to confirm cancellation.');
        else if (result.data.answer === 'no') setMessage('Heard “No”. Select the No button to keep your subscription.');
        else setMessage('Could not determine Yes or No. Repeat your answer or use the buttons below.');
      } catch {
        setMessage('Could not check the recording. Select Yes or No below.');
      } finally {
        audio.current = null;
        setRecording('idle');
      }
      return;
    }
    setMessage('');
    setRecording('starting');
    player.current?.pause();
    const recorder = createAudioRecorder();
    audio.current = recorder;
    try {
      await recorder.start();
      if (audio.current !== recorder) {
        recorder.cancel();
        return;
      }
      setRecording('recording');
    } catch {
      setMessage('Microphone unavailable. Select Yes or No below.');
      audio.current = null;
      setRecording('idle');
    }
  }

  const prompt = prompts[locale];
  return (
    <section className="alert" aria-label="Confirm subscription cancellation" style={{ marginTop: '1rem' }}>
      <label className="field-label" htmlFor="parent-voice-language">Voice language</label>
      <select
        id="parent-voice-language" className="text-input" value={locale} disabled={recording !== 'idle'}
        onChange={event => {
          const selected = event.target.value as PromptLocale;
          setLocale(selected);
          window.localStorage.setItem(languageKey, selected);
          playPrompt(selected);
        }}
      >
        {(Object.keys(prompts) as PromptLocale[]).map(option => <option key={option} value={option}>{prompts[option].language}</option>)}
      </select>
      <audio ref={player} src={`/voice/cancel-${locale}.wav`} preload="auto" />
      <p lang={locale}>{prompt.question}</p>
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={() => playPrompt(locale)} disabled={recording !== 'idle'}>Play prompt</button>
        <button type="button" className="btn btn-secondary" onClick={() => void recordAnswer()} disabled={recording === 'starting' || recording === 'checking'}>
          {recording === 'recording' ? 'Stop and check answer' : recording === 'checking' ? 'Checking answer…' : 'Record Yes or No'}
        </button>
      </div>
      {playbackError && <p role="status">Prompt audio is unavailable. Read the question above and select Yes or No.</p>}
      {message && <p role="status">{message}</p>}
      <div className="button-row">
        <button type="button" className="btn btn-terracotta" lang={locale} onClick={onConfirm}>{prompt.yes}</button>
        <button type="button" className="btn btn-secondary" lang={locale} onClick={onKeep}>{prompt.no}</button>
      </div>
    </section>
  );
}
