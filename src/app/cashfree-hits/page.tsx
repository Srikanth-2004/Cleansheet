'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface CashfreeHit {
  requestId: string;
  recordedAt: string;
  route?: string;
  operation?: string;
  outcome?: string;
  status?: number;
  reason?: string;
  responseSummary?: Record<string, unknown>;
  usedFor?: string;
}

export default function CashfreeHitsPage() {
  const [hits, setHits] = useState<CashfreeHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/local/cashfree-hits', { cache: 'no-store' });
      const result = await response.json() as { ok?: boolean; data?: { hits?: CashfreeHit[] } };
      if (!response.ok || !result.ok || !Array.isArray(result.data?.hits)) throw new Error('Unavailable');
      setHits(result.data.hits);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <main className="workspace">
      <section className="card">
        <h1 className="section-heading">Cashfree API hits</h1>
        <p>Responses recorded by the local Firebase backend. Browser fixture actions run locally and create no Cashfree requests.</p>
        <div className="button-row">
          <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>Refresh</button>
          <Link href="/coach" className="btn btn-secondary">Coach</Link>
          <a className="btn btn-secondary" href="http://localhost:4000/logs">Firebase Logs</a>
        </div>
        {error ? <p role="alert">The local Firebase activity feed is unavailable.</p>
          : loading ? <p role="status">Loading Cashfree hits…</p>
            : hits.length === 0 ? <p>Cashfree activity will appear here when the backend attempts a Sandbox request.</p>
              : (
                <ul className="notif-list">
                  {hits.map((hit, index) => (
                    <li key={hit.requestId + '-' + index} className="notif-item">
                      <div className="notif-header">
                        <strong>{hit.operation ?? 'Cashfree request skipped'}</strong>
                        <span className="mono">{hit.status ? `HTTP ${hit.status}` : hit.outcome === 'error' ? 'No HTTP response' : 'Skipped'}</span>
                      </div>
                      <p>{hit.usedFor ?? hit.reason}</p>
                      {hit.route && <p className="mono">{hit.route}</p>}
                      {hit.responseSummary && Object.keys(hit.responseSummary).length > 0 && (
                        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(hit.responseSummary, null, 2)}</pre>
                      )}
                      <small className="mono">{new Date(hit.recordedAt).toLocaleString()} · {hit.requestId}</small>
                    </li>
                  ))}
                </ul>
              )}
      </section>
    </main>
  );
}
