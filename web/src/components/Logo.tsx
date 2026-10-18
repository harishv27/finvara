export function Logo({ size = 28, text = true, light = false }: { size?: number; text?: boolean; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#0f766e" />
        <path d="M18 46V18h28v7H26v5h16v7H26v9z" fill="#fff" />
        <path d="M34 46l12-14" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round" />
      </svg>
      {text && <span className={`font-display text-xl font-semibold tracking-tight ${light ? "text-white" : ""}`}>Finvara</span>}
    </span>
  );
}
