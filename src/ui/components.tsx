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
    <div className={`page-shell ${dense ? "dense" : ""}`}>
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="hero">
        <div>
          <div className="eyebrow">Browsing Analytics</div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="hero-action">{action}</div> : null}
      </header>
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
    <section className={`glass-card section-card ${className}`}>
      {(title || subtitle || action) && (
        <div className="section-head">
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
          {range === "week" ? "近 7 天" : range === "month" ? "本月" : "全部历史"}
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
