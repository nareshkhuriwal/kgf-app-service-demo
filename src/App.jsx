import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_MS = 5000;
const TIMEOUT_MS = 4000;
const HISTORY_SIZE = 30;

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.json();
}

function formatUptime(totalSeconds) {
  if (totalSeconds == null) return '—';
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function formatTime(value) {
  if (!value || value === 'unknown') return value || '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Card({ title, rows }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <dl>
        {rows
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([label, value]) => (
            <div className="row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

function LatencyChart({ checks }) {
  const max = Math.max(50, ...checks.map((c) => c.latencyMs || 0));
  return (
    <div className="chart" role="img" aria-label="Response time of recent health checks">
      {Array.from({ length: HISTORY_SIZE }, (_, i) => {
        const check = checks[checks.length - HISTORY_SIZE + i];
        if (!check) return <span key={i} className="bar empty" />;
        const height = check.ok ? Math.max(6, (check.latencyMs / max) * 100) : 100;
        return (
          <span
            key={i}
            className={`bar ${check.ok ? 'ok' : 'fail'}`}
            style={{ height: `${height}%` }}
            title={`${check.time.toLocaleTimeString()} — ${check.ok ? `${check.latencyMs} ms` : check.error}`}
          />
        );
      })}
    </div>
  );
}

export default function App() {
  const [info, setInfo] = useState(null);
  const [checks, setChecks] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  const runCheck = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    const started = performance.now();
    let check;
    try {
      const health = await fetchJson('/api/health');
      const latencyMs = Math.round(performance.now() - started);
      check = { time: new Date(), ok: health.status === 'ok', latencyMs, error: null };
      setInfo(await fetchJson('/api/info'));
    } catch (err) {
      check = { time: new Date(), ok: false, latencyMs: null, error: err.name === 'TimeoutError' ? 'Timed out' : err.message };
    }
    setChecks((prev) => [...prev, check].slice(-HISTORY_SIZE));
    setChecking(false);
    inFlight.current = false;
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(runCheck, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, runCheck]);

  const latest = checks.at(-1);
  const state = !latest ? 'pending' : latest.ok ? 'up' : 'down';
  const passed = checks.filter((c) => c.ok).length;
  const okLatencies = checks.filter((c) => c.ok).map((c) => c.latencyMs);
  const avgLatency = okLatencies.length
    ? Math.round(okLatencies.reduce((a, b) => a + b, 0) / okLatencies.length)
    : null;

  const headline = {
    pending: 'Checking KGF App Service…',
    up: 'KGF App Service is up and running',
    down: 'KGF App Service is not responding',
  }[state];

  const platformDetails = Object.entries(info?.platform?.details ?? {});

  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Deployment verification</p>
          <h1>KGF App Service</h1>
        </div>
        <div className="controls">
          <label className="toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh every {REFRESH_MS / 1000}s
          </label>
          <button type="button" onClick={runCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Run check now'}
          </button>
        </div>
      </header>

      <section className={`banner ${state}`} aria-live="polite">
        <span className="dot" aria-hidden="true" />
        <div className="banner-text">
          <strong>{headline}</strong>
          <span>
            {latest
              ? latest.ok
                ? `Health check passed in ${latest.latencyMs} ms · last checked ${latest.time.toLocaleTimeString()}`
                : `${latest.error} · last checked ${latest.time.toLocaleTimeString()}`
              : 'Contacting /api/health…'}
          </span>
        </div>
        {info && (
          <div className={`pill ${info.container.inContainer ? 'yes' : 'no'}`}>
            {info.container.inContainer ? 'Running in a container' : 'Not in a container'}
          </div>
        )}
      </section>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Uptime</span>
          <span className="stat-value">{formatUptime(info?.uptimeSeconds)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Checks passed</span>
          <span className="stat-value">{checks.length ? `${passed} / ${checks.length}` : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Avg response</span>
          <span className="stat-value">{avgLatency != null ? `${avgLatency} ms` : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Container ID</span>
          <span className="stat-value mono">{info?.container.hostname ?? '—'}</span>
        </div>
      </section>

      <section className="card history">
        <h2>Recent health checks</h2>
        <LatencyChart checks={checks} />
        <p className="hint">Each bar is one call to /api/health. Height is response time; red means the check failed.</p>
      </section>

      {info ? (
        <div className="grid">
          <Card
            title="Container"
            rows={[
              ['In container', info.container.inContainer ? 'Yes' : 'No'],
              ['Detected by', info.container.detectedBy],
              ['Hostname', <span className="mono">{info.container.hostname}</span>],
              ['Platform', info.platform.name],
              ...platformDetails.map(([key, value]) => [key, value]),
            ]}
          />
          <Card
            title="Deployment"
            rows={[
              ['App', info.app.name],
              ['Version', info.app.version],
              ['Commit', <span className="mono">{info.app.commit}</span>],
              ['Built', formatTime(info.app.buildTime)],
              ['Environment', info.app.environment],
            ]}
          />
          <Card
            title="Runtime"
            rows={[
              ['Node.js', info.runtime.node],
              ['OS', info.runtime.os],
              ['Architecture', info.runtime.arch],
              ['CPUs', info.runtime.cpus],
              ['Load average', info.runtime.loadAverage.join(' / ')],
              ['Process memory', `${info.runtime.memory.rssMb} MB RSS · ${info.runtime.memory.heapUsedMb} MB heap`],
              ['System memory', `${info.runtime.memory.systemFreeMb} MB free of ${info.runtime.memory.systemTotalMb} MB`],
            ]}
          />
          <Card
            title="Server"
            rows={[
              ['Port', info.server.port],
              ['PID', info.runtime.pid],
              ['Started', formatTime(info.server.startedAt)],
              ['Requests served', info.server.requestsServed],
              ['Request host', info.request.host],
              ['Client IP', <span className="mono">{info.request.clientIp}</span>],
            ]}
          />
        </div>
      ) : (
        state === 'down' && (
          <p className="empty-state">
            No data yet. Make sure the server is running and reachable at <code>/api/info</code>.
          </p>
        )
      )}

      <footer className="footer">
        Endpoints: <code>/api/health</code> · <code>/api/info</code> · <code>/healthz</code>
      </footer>
    </main>
  );
}
