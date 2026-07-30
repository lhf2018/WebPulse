import type { ReactNode } from "react";
import type { DashboardRange } from "../shared/types";
import { formatDuration } from "../shared/time";

export function PageShell({
  title,
  subtitle,
  action,
  children,
  dense = false
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <div className={`page-shell cyber-hud ${dense ? "dense" : ""}`}>
      <div className="grid-bg" aria-hidden />
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="hud-bar page-hud">
        <div className="hud-brand">
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          <div>
            <div className="eyebrow">WEBPULSE // OPS</div>
            <h1 className="hud-title neon-title">{title}</h1>
          </div>
        </div>
        {action ? <div className="hud-actions">{action}</div> : null}
      </header>
      {subtitle ? <p className="hud-subtitle">{subtitle}</p> : null}
      {children}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = ""
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`hud-panel section-card ${className}`}>
      {(title || subtitle || action) && (
        <div className="hud-panel-head section-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "blue"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "blue" | "mint" | "amber" | "rose";
}) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function RangeTabs({
  value,
  onChange,
  ranges = ["week", "month", "all"]
}: {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
  ranges?: DashboardRange[];
}) {
  return (
    <div className="range-tabs" role="tablist" aria-label="时间范围">
      {ranges.map((range) => (
        <button
          key={range}
          type="button"
          className={range === value ? "active" : ""}
          onClick={() => onChange(range)}
        >
          {range === "week" ? "7D" : range === "month" ? "MONTH" : "ALL"}
        </button>
      ))}
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  variant = "primary",
  type = "button"
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`button ${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}

export function ThemeBadge({ theme }: { theme: string }) {
  return <span className={`pill theme-${theme}`}>{theme}</span>;
}

export function SmallValue({
  label,
  value,
  color
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="small-value">
      <span>{label}</span>
      <strong style={color ? { color } : undefined}>{value}</strong>
    </div>
  );
}

export function formatShort(ms: number) {
  return formatDuration(ms);
}
