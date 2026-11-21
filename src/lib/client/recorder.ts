const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/wav',
] as const;

export interface RecordedAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface BrowserAudioRecorder {
  mimeType: string;
  start: (onLevels?: (levels: number[]) => void) => Promise<void>;
  stop: () => Promise<RecordedAudio>;
  cancel: () => void;
}

export function detectSupportedAudioMimeType(): string | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return null;
  }

  for (const candidate of CANDIDATE_MIME_TYPES) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

export function createAudioRecorder(): BrowserAudioRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let rafId: number | null = null;
  let chunks: BlobPart[] = [];
  let startedAt = 0;

  const detected = detectSupportedAudioMimeType();
  const activeMimeType = detected ?? '';

  function cleanupAudioGraph(): void {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }
  }

  return {
    mimeType: activeMimeType || 'browser-default',

    async start(onLevels?: (levels: number[]) => void): Promise<void> {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone recording is unavailable in this browser. Use the typed command fallback.');
      }
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder is unavailable in this browser. Use the typed command fallback.');
      }

      chunks = [];
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (onLevels && typeof AudioContext !== 'undefined') {
        try {
          audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(mediaStream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          const bins = new Uint8Array(analyser.frequencyBinCount);

          const tick = () => {
            analyser.getByteFrequencyData(bins);
            const bars: number[] = [];
            const count = 24;
            for (let i = 0; i < count; i += 1) {
              const raw = bins[i % bins.length] ?? 0;
              bars.push(Math.max(0.14, Math.min(1, raw / 210)));
            }
            onLevels(bars);
            rafId = window.requestAnimationFrame(tick);
          };
          rafId = window.requestAnimationFrame(tick);
        } catch {
          // AudioContext optional; recording still proceeds cleanly.
        }
      }

      mediaRecorder = activeMimeType
        ? new MediaRecorder(mediaStream, { mimeType: activeMimeType })
        : new MediaRecorder(mediaStream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      startedAt = Date.now();
      mediaRecorder.start(250);
    },

    stop(): Promise<RecordedAudio> {
      return new Promise((resolve, reject) => {
        if (!mediaRecorder) {
          cleanupAudioGraph();
          reject(new Error('No active recording session.'));
          return;
        }

        const recorder = mediaRecorder;
        const resolvedMimeType = recorder.mimeType || activeMimeType || 'audio/webm';

        recorder.onstop = () => {
          const durationMs = Math.max(0, Date.now() - startedAt);
          const blob = new Blob(chunks, { type: resolvedMimeType });
          cleanupAudioGraph();
          mediaRecorder = null;
          chunks = [];
          resolve({
            blob,
            mimeType: resolvedMimeType,
            durationMs,
          });
        };

        recorder.onerror = () => {
          cleanupAudioGraph();
          mediaRecorder = null;
          chunks = [];
          reject(new Error('Audio recording failed. Please try again or use typed input.'));
        };

        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          cleanupAudioGraph();
          reject(new Error('Recorder is already inactive.'));
        }
      });
    },

    cancel(): void {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      mediaRecorder = null;
      chunks = [];
      cleanupAudioGraph();
    },
  };
}
