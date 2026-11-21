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
  start: () => Promise<void>;
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
  let chunks: BlobPart[] = [];
  let startedAt = 0;

  const detected = detectSupportedAudioMimeType();
  const activeMimeType = detected ?? '';

  function cleanupStream(): void {
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }
  }

  return {
    mimeType: activeMimeType || 'browser-default',

    async start(): Promise<void> {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone recording is unavailable in this browser. Use the typed command fallback.');
      }
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder is unavailable in this browser. Use the typed command fallback.');
      }

      chunks = [];
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
          cleanupStream();
          reject(new Error('No active recording session.'));
          return;
        }

        const recorder = mediaRecorder;
        const resolvedMimeType = recorder.mimeType || activeMimeType || 'audio/webm';

        recorder.onstop = () => {
          const durationMs = Math.max(0, Date.now() - startedAt);
          const blob = new Blob(chunks, { type: resolvedMimeType });
          cleanupStream();
          mediaRecorder = null;
          chunks = [];
          resolve({
            blob,
            mimeType: resolvedMimeType,
            durationMs,
          });
        };

        recorder.onerror = () => {
          cleanupStream();
          mediaRecorder = null;
          chunks = [];
          reject(new Error('Audio recording failed. Please try again or use typed input.'));
        };

        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          cleanupStream();
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
      cleanupStream();
    },
  };
}
