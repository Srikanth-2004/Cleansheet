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

async function toSpeechWav(recording: Blob): Promise<Blob> {
  const sampleRate = 16_000;
  // decodeAudioData resamples to the context rate before the PCM WAV is encoded.
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());

  const samples = decoded.getChannelData(0);
  const secondChannel = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : undefined;
  const headerBytes = 44;
  const pcmBytes = samples.length * 2;
  const wav = new DataView(new ArrayBuffer(headerBytes + pcmBytes));
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < tag.length; index++) wav.setUint8(offset + index, tag.charCodeAt(index));
  };
  writeTag(0, 'RIFF');
  wav.setUint32(4, 36 + pcmBytes, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  writeTag(36, 'data');
  wav.setUint32(40, pcmBytes, true);
  for (let index = 0; index < samples.length; index++) {
    const rawSample = secondChannel ? (samples[index] + secondChannel[index]) / 2 : samples[index];
    const sample = Math.max(-1, Math.min(1, rawSample));
    wav.setInt16(headerBytes + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([wav.buffer], { type: 'audio/wav' });
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

        recorder.onstop = async () => {
          const durationMs = Math.max(0, Date.now() - startedAt);
          const recording = new Blob(chunks, { type: resolvedMimeType });
          cleanupAudioGraph();
          mediaRecorder = null;
          chunks = [];
          if (!recording.size) {
            reject(new Error('No audio was captured. Record again and speak into the microphone.'));
            return;
          }
          if (durationMs > 30_000) {
            reject(new Error('Recording is longer than 30 seconds. Try a shorter command.'));
            return;
          }
          try {
            const blob = await toSpeechWav(recording);
            resolve({ blob, mimeType: blob.type, durationMs });
          } catch {
            reject(new Error('The recording could not be decoded. Record again or type your command.'));
          }
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
