import { Link } from 'react-router-dom';

// T-tech のマーク。朱の角印に T。public/favicon.svg と同じ形（www・store・学習とも共通）。
export function BrandSeal({ className = 'brand-seal' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="5" fill="var(--accent)" />
      <rect x="4" y="4" width="24" height="24" rx="2.5" fill="none" stroke="var(--accent-ink)" strokeWidth="1.2" opacity="0.55" />
      <path d="M9 10h14v3.2h-5.4V24h-3.2V13.2H9z" fill="var(--accent-ink)" />
    </svg>
  );
}

// 「[角印] UoA Online | ストレージ」。to を渡すとリンクになる。
export function BrandLockup({ section = 'ストレージ', to }: { section?: string; to?: string }) {
  const inner = (
    <>
      <BrandSeal />
      <span className="brand-name">UoA Online</span>
      <span className="brand-section">{section}</span>
    </>
  );
  return to ? (
    <Link to={to} className="brand" aria-label={`UoA Online ${section}`}>
      {inner}
    </Link>
  ) : (
    <span className="brand">{inner}</span>
  );
}
