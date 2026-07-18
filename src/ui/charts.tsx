import type { CSSProperties } from "react";
import { formatDuration } from "../shared/time";

export function Sparkline({
  values,
  height = 130
}: {
  values: number[];
  height?: number;
}) {
  const width = 520;
  const safe = values.length ? values : [0];
  const max = Math.max(...safe, 1);
  const step = width / Math.max(1, safe.length - 1);
  const points = safe
    .map((value, index) => `${index * step},${height - 18 - (value / max) * (height - 28)}`)
    .join(" ");
  const area = `0,${height - 6} ${points} ${width},${height - 6}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      {safe.map((value, index) => {
        const x = index * step;
        const y = height - 18 - (value / max) * (height - 28);
        return <circle key={index} cx={x} cy={y} r="3" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />;
      })}
    </svg>
  );
}

export function RhythmBars({
  values,
  compact = false
}: {
  values: number[];
  compact?: boolean;
}) {
  const normalized = Array.from({ length: 24 }, (_, hour) => values[hour] ?? 0);
  const max = Math.max(1, ...normalized);
  return (
    <div className={`rhythm-bars ${compact ? "compact" : ""}`}>
      <div className="rhythm-track">
        {normalized.map((value, hour) => {
          const ratio = value / max;
          const height = value <= 0 ? 4 : Math.max(8, ratio * 100);
          return (
            <span
              key={hour}
              className={value > 0 ? "has-value" : ""}
              title={`${hour}:00 ${formatDuration(value)}`}
              style={
                {
                  "--bar-height": `${height}%`,
                  "--bar-alpha": `${0.18 + ratio * 0.72}`,
                  "--bar-alpha-soft": `${0.15 + ratio * 0.62}`
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <div className="rhythm-labels">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

export function HeatmapMatrix({
  rows
}: {
  rows: Array<{ label: string; buckets: number[] }>;
}) {
  const max = Math.max(1, ...rows.flatMap((row) => row.buckets));
  return (
    <div className="heatmap-shell">
      <div className="heatmap-head">
        <span>日期</span>
        <div className="heatmap-hours">
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
      </div>
      <div className="heatmap-body">
        {rows.map((row) => (
          <div className="heatmap-row" key={row.label}>
            <strong>{row.label}</strong>
            <div className="heatmap-hours">
              {row.buckets.map((value, index) => {
                const opacity = value <= 0 ? 0.07 : 0.14 + (value / max) * 0.78;
                return <span key={index} style={{ backgroundColor: `rgba(37, 99, 235, ${opacity.toFixed(2)})` }} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RankBars({
  data,
  limit = 8
}: {
  data: Array<{ domain: string; totalActiveMs: number }>;
  limit?: number;
}) {
  const rows = data.slice(0, limit);
  const max = Math.max(1, ...rows.map((item) => item.totalActiveMs));
  return (
    <div className="rank-list">
      {rows.map((item, index) => (
        <div className="rank-row" key={`${item.domain}-${index}`}>
          <div className="rank-meta">
            <span className="rank-index">#{index + 1}</span>
            <div>
              <strong>{item.domain}</strong>
              <small>{formatDuration(item.totalActiveMs)}</small>
            </div>
          </div>
          <div className="rank-bar">
            <span style={{ width: `${(item.totalActiveMs / max) * 100}%` }} />
          </div>
          <strong className="rank-value">{Math.round(item.totalActiveMs / 36_000) / 100}h</strong>
        </div>
      ))}
    </div>
  );
}
