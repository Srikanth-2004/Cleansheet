'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResponse } from '@/lib/client/types';

export function RazSpeechPlayback({ load, label, buttonLabel, autoStart = false, paused = false }: {
  load(signal: AbortSignal): Promise<ApiResponse<{ audioUrl: string }>>;
  label: string;
  buttonLabel: string;
  autoStart?: boolean;
  paused?: boolean;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const [url, setUrl] = useState<string>();
  const current = useRef<{ controller?: AbortController; url?: string }>({});
  const player = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (paused) player.current?.pause();
  }, [paused]);

  const listen = useCallback(async () => {
    current.current.controller?.abort();
    const controller = new AbortController();
    current.current.controller = controller;
    setStatus('loading');
    try {
      const result = await load(controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) throw Error(result.error.message);
      const prefix = 'data:audio/mpeg;base64,';
      if (!result.data.audioUrl.startsWith(prefix)) throw Error('Invalid audio format.');
      const bytes = Uint8Array.from(atob(result.data.audioUrl.slice(prefix.length)), char => char.charCodeAt(0));
      const source = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      if (current.current.url) URL.revokeObjectURL(current.current.url);
      current.current.url = source;
      setUrl(source);
      setStatus('idle');
    } catch {
      if (!controller.signal.aborted) setStatus('unavailable');
    }
  }, [load]);

  useEffect(() => {
    if (autoStart) void listen();
    return () => {
      current.current.controller?.abort();
      if (current.current.url) URL.revokeObjectURL(current.current.url);
    };
  }, [autoStart, listen]);

  return (
    <div className="button-row">
      {url
        ? <audio
          ref={player} src={url} controls={!paused} autoPlay={!paused} aria-label={label}
          onError={() => {
            URL.revokeObjectURL(url);
            current.current.url = undefined;
            setUrl(undefined);
            setStatus('unavailable');
          }}
        />
        : <button type="button" className="btn btn-secondary" onClick={() => void listen()} disabled={status === 'loading'}>
          {status === 'loading' ? 'Preparing voice…' : buttonLabel}
        </button>}
      {status === 'unavailable' && <p role="status">Sarvam audio is unavailable. The text is shown on screen.</p>}
    </div>
  );
}
