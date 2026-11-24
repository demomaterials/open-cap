import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtScore, scoreClass, STATUS_LABEL } from './format.js';

export function Page({ title, subtitle, actions, crumbs, children }) {
  return (
    <div className="page">
      {crumbs && (
        <nav className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}{i < crumbs.length - 1 && <span className="sep">/</span>}</span>
          ))}
        </nav>
      )}
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ what = 'Loading' }) {
  return <div className="loading">{what}…</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="error-box">
      <strong>{error.message || String(error)}</strong>
      {Array.isArray(error.details) && <ul>{error.details.map((d, i) => <li key={i}><code>{d}</code></li>)}</ul>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function ScoreRing({ score, size = 120, label = 'compliant' }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div className={`ring ${scoreClass(score)}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${fmtScore(score)} ${label}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth="10" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-value" strokeWidth="10" fill="none"
          strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-label">
        <span className="ring-score">{fmtScore(score)}</span>
        <span className="ring-sub">{label}</span>
      </div>
    </div>
  );
}

/** Stacked bar of pass/fail/skip/error/pending. */
export function StackBar({ c, height = 8 }) {
  const total = (c.pass || 0) + (c.fail || 0) + (c.skip || 0) + (c.error || 0) + (c.pending || 0);
  if (!total) return <div className="stack empty-stack" style={{ height }} />;
  return (
    <div className="stack" style={{ height }} title={`pass ${c.pass} · fail ${c.fail} · skip ${c.skip} · error ${c.error} · pending ${c.pending}`}>
      {['pass', 'fail', 'error', 'pending', 'skip'].map((k) => c[k] > 0 && (
        <span key={k} className={`seg ${k}`} style={{ width: `${(100 * c[k]) / total}%` }} />
      ))}
    </div>
  );
}

export function Score({ score }) {
  return <span className={`score ${scoreClass(score)}`}>{fmtScore(score)}</span>;
}

export function Status({ s }) {
  return <span className={`pill ${s}`}>{STATUS_LABEL[s] || s}</span>;
}

export function Sev({ s }) {
  return <span className={`sev ${s}`}>{s}</span>;
}

export function Counts({ c, onPick, active }) {
  const items = [
    ['pass', c.pass], ['fail', c.fail], ['skip', c.skip], ['error', c.error], ['pending', c.pending],
  ];
  return (
    <div className="counts">
      {items.map(([k, v]) => (
        <button key={k} type="button" className={`count ${k} ${active === k ? 'active' : ''}`} onClick={onPick ? () => onPick(k) : undefined} disabled={!onPick}>
          <span className="count-n">{v ?? 0}</span>
          <span className="count-l">{STATUS_LABEL[k]}</span>
        </button>
      ))}
    </div>
  );
}

export function Sparkline({ points, height = 48 }) {
  const values = (points || []).map((p) => (p.score === null ? null : Number(p.score)));
  const valid = values.filter((v) => v !== null);
  if (valid.length < 2) return <div className="muted small">Trend appears after a few snapshots (every 15 min).</div>;
  const w = 300;
  const step = w / (values.length - 1);
  let d = '';
  values.forEach((v, i) => {
    if (v === null) return;
    const y = height - (v / 100) * (height - 4) - 2;
    d += `${d ? 'L' : 'M'}${(i * step).toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <path d={d} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function JsonView({ value, maxHeight = 520 }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="json">
      <button type="button" className="btn small ghost copy" onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre style={{ maxHeight }}>{text}</pre>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={`tab ${active === t.key ? 'active' : ''} ${t.className || ''}`} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ total, limit, offset, onChange }) {
  if (!total || total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="pager">
      <button type="button" className="btn small ghost" disabled={page <= 1} onClick={() => onChange(offset - limit)}>‹ Prev</button>
      <span className="muted small">Page {page} of {pages} · {total} items</span>
      <button type="button" className="btn small ghost" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Next ›</button>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TypeChips({ types }) {
  return <span className="chips">{(types || []).map((t) => <span key={t} className="chip">{t}</span>)}</span>;
}

/** Monospace editor with Tab support and line numbers. */
export function CodeEditor({ value, onChange, readOnly, rows = 22 }) {
  const lines = (value || '').split('\n').length;
  const onKeyDown = (e) => {
    if (e.key !== 'Tab' || readOnly) return;
    e.preventDefault();
    const el = e.target;
    const { selectionStart: s, selectionEnd: en } = el;
    const next = `${value.slice(0, s)}\t${value.slice(en)}`;
    onChange(next);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 1; });
  };
  return (
    <div className="code-editor">
      <pre className="gutter" aria-hidden="true">{Array.from({ length: Math.max(lines, rows) }, (_, i) => i + 1).join('\n')}</pre>
      <textarea spellCheck="false" value={value} rows={Math.max(rows, lines + 1)} readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown} />
    </div>
  );
}
