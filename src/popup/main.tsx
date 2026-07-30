import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { getPopupSnapshot, getSettings, openDashboard, updateSettings } from "../shared/api";
import { applyTheme } from "../shared/theme";
import type { PopupDayCard, PopupSnapshot, ThemeMode } from "../shared/types";
import { formatCompactDuration, formatHourMinute } from "../shared/time";
import { getLocal, setLocal, STORAGE_KEYS } from "../shared/storage/local";
import {
  buildChallenges,
  findGoldenHours,
  findLongestFocusBlock,
  focusIndex,
  formatHourRange,
  personaScores,
  personaTitle,
  productivityScore,
  resolveDayStatus,
  rhythmProfile,
  statusLabel
} from "./analytics";
import "./nightwatch.css";

type TabId = "today" | "week" | "year" | "persona" | "month";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "today", label: "今日趋势" },
  { id: "week", label: "本周回溯" },
  { id: "year", label: "年度热力图" },
  { id: "persona", label: "人格" },
  { id: "month", label: "月报" }
];

function heatDateLabel(dateKey: string) {
  const parts = dateKey.split("-");
  const month = Number(parts[1] ?? 0);
  const day = Number(parts[2] ?? 0);
  return `${month}.${day}`;
}

function weekdayLabel(dateKey: string) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${dateKey}T12:00:00`));
}

function heatColor(ratio: number) {
  if (ratio <= 0) return "#1a222d";
  if (ratio < 0.25) return "#16324a";
  if (ratio < 0.5) return "#0f6f8c";
  if (ratio < 0.75) return "#00d4ff";
  return "#7c4dff";
}

function normalizeBuckets(values?: number[] | null) {
  return Array.from({ length: 24 }, (_, hour) => Math.max(0, Number(values?.[hour] ?? 0)));
}

function emptyDay(dateKey: string): PopupDayCard {
  return {
    dateKey,
    totalActiveMs: 0,
    uniqueDomainCount: 0,
    openedTabCount: 0,
    activeHourBuckets: Array.from({ length: 24 }, () => 0),
    nightActiveMs: 0
  };
}

function AreaChart({
  values,
  golden,
  focus,
  chartId = "main",
  tall = false
}: {
  values?: number[] | null;
  golden: { start: number; end: number } | null;
  focus: { start: number; end: number } | null;
  chartId?: string;
  tall?: boolean;
}) {
  const buckets = normalizeBuckets(values);
  const width = 720;
  const height = tall ? 168 : 132;
  const max = Math.max(1, ...buckets);
  const hasData = buckets.some((value) => value > 0);
  const step = width / 23;
  const coords = buckets.map((value, index) => {
    const x = index * step;
    const y = hasData ? height - 10 - (value / max) * (height - 22) : height - 10;
    return { x, y };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const fillId = `nw-fill-${chartId}`;

  return (
    <div className={`nw-chart-shell ${tall ? "tall" : ""}`}>
      <div className="nw-chart-bars" aria-hidden>
        {buckets.map((value, hour) => {
          const ratio = hasData ? value / max : 0;
          const inGolden = golden != null && hour >= golden.start && hour <= golden.end;
          const inFocus = focus != null && hour >= focus.start && hour <= focus.end;
          return (
            <span
              key={hour}
              className={`${value > 0 ? "on" : ""} ${inGolden ? "golden" : ""} ${inFocus ? "focus" : ""}`}
              title={`${String(hour).padStart(2, "0")}:00 · ${formatCompactDuration(value)}`}
              style={{ height: `${Math.max(value > 0 ? 8 : 2, ratio * 100)}%` }}
            />
          );
        })}
      </div>
      <svg
        className="nw-area-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="活跃趋势"
      >
        <defs>
          <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {golden ? (
          <rect
            className="nw-band golden"
            x={golden.start * step}
            y={0}
            width={Math.max(step, (golden.end - golden.start + 1) * step)}
            height={height}
          />
        ) : null}
        {focus ? (
          <rect
            className="nw-band focus"
            x={focus.start * step}
            y={0}
            width={Math.max(step, (focus.end - focus.start + 1) * step)}
            height={height}
          />
        ) : null}
        <polygon points={area} fill={`url(#${fillId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="#00d4ff"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="nw-chart-labels">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      {!hasData ? <div className="nw-chart-empty">暂无活跃采样，浏览一会儿后再看</div> : null}
    </div>
  );
}

function Radar({ scores }: { scores: ReturnType<typeof personaScores> }) {
  const labels = ["早起", "夜战", "专注", "稳定", "周末"];
  const values = [scores.early, scores.night, scores.focus, scores.stability, scores.weekend];
  const size = 150;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 48;
  const toPoint = (index: number, ratio: number) => {
    const angle = -Math.PI / 2 + (index / 5) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio] as const;
  };
  const polygon = values.map((value, index) => toPoint(index, Math.max(0.1, value / 100)).join(",")).join(" ");

  return (
    <div className="nw-radar-shell">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="nw-radar" role="img" aria-label="工作人格雷达">
        {[0.35, 0.65, 1].map((ring) => (
          <polygon
            key={ring}
            points={values.map((_, index) => toPoint(index, ring).join(",")).join(" ")}
            className="nw-radar-ring"
          />
        ))}
        {labels.map((label, index) => {
          const [x, y] = toPoint(index, 1.28);
          return (
            <text key={label} x={x} y={y} className="nw-radar-label" textAnchor="middle" dominantBaseline="middle">
              {label}
            </text>
          );
        })}
        <polygon points={polygon} className="nw-radar-fill" />
      </svg>
      <div className="nw-radar-scores">
        {labels.map((label, index) => (
          <span key={label}>
            {label} {values[index]}
          </span>
        ))}
      </div>
    </div>
  );
}

function NightWatchPopup() {
  const [snapshot, setSnapshot] = useState<PopupSnapshot | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [tab, setTab] = useState<TabId>("today");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [draftNote, setDraftNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayHour, setReplayHour] = useState(0);
  const [selectedWeekDay, setSelectedWeekDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [nextSnapshot, config, storedNotes] = await Promise.all([
        getPopupSnapshot(),
        getSettings(),
        getLocal(STORAGE_KEYS.dayNotes)
      ]);
      setSnapshot(nextSnapshot);
      setTheme(config.settings.theme);
      applyTheme(config.settings.theme);
      setNowMs(Date.now());
      const noteMap = storedNotes ?? {};
      setNotes(noteMap);
      setDraftNote(noteMap[nextSnapshot.dateKey] ?? "");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const refresher = window.setInterval(() => void refresh(), 9000);
    const ticker = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearInterval(refresher);
      window.clearInterval(ticker);
    };
  }, []);

  useEffect(() => {
    if (!replaying) return;
    setReplayHour(0);
    const timer = window.setInterval(() => {
      setReplayHour((current) => {
        if (current >= 23) {
          window.clearInterval(timer);
          setReplaying(false);
          return 23;
        }
        return current + 1;
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [replaying]);

  const derived = useMemo(() => {
    if (!snapshot) return null;
    const weekDays =
      snapshot.weekDays?.length
        ? snapshot.weekDays
        : (snapshot.recentDays ?? []).map((day) => ({
            ...emptyDay(day.dateKey),
            totalActiveMs: day.totalActiveMs,
            uniqueDomainCount: day.uniqueDomainCount,
            openedTabCount: day.openedTabCount
          }));
    const heatmapDays = (
      snapshot.heatmapDays?.length
        ? snapshot.heatmapDays.map((day) => ({
            ...day,
            buckets: normalizeBuckets(day.buckets)
          }))
        : weekDays.map((day) => ({
            dateKey: day.dateKey,
            buckets: normalizeBuckets(day.activeHourBuckets),
            totalActiveMs: day.totalActiveMs
          }))
    )
      .slice()
      .sort((left, right) => right.dateKey.localeCompare(left.dateKey));
    const liveTodayMs =
      snapshot.totalActiveMs + (snapshot.trackingActive ? Math.max(0, nowMs - snapshot.updatedAt) : 0);
    const buckets = normalizeBuckets(snapshot.hourlyActivity);
    const focus = findLongestFocusBlock(buckets);
    const golden = findGoldenHours(buckets);
    const nightMs = buckets.reduce((sum, value, hour) => (hour >= 22 || hour < 6 ? sum + value : sum), 0);
    const focusMs = focus?.ms ?? 0;
    const status = resolveDayStatus(liveTodayMs, snapshot.todayWindow?.lastUsedAt);
    const productivity = productivityScore(liveTodayMs, focusMs, nightMs);
    const focusScore = focusIndex(liveTodayMs, focusMs, snapshot.uniqueDomainCount);
    const rhythm = rhythmProfile(weekDays);
    const weekTotal = weekDays.reduce((sum, day) => sum + day.totalActiveMs, 0);
    const activeWeekDays = weekDays.filter((day) => day.totalActiveMs > 0).length;
    const weekAvg = Math.round(weekTotal / Math.max(1, activeWeekDays));
    const enrichedSnapshot = { ...snapshot, weekDays, heatmapDays };
    const scores = personaScores(enrichedSnapshot, liveTodayMs, nightMs, focusMs);
    const persona = personaTitle(scores);
    const challenges = buildChallenges(liveTodayMs, focusScore, focusMs, snapshot.todayWindow?.lastUsedAt);
    const validDays = heatmapDays.filter((day) => day.totalActiveMs > 0).length;
    const missing7 = heatmapDays.slice(0, 7).filter((day) => day.totalActiveMs <= 0).length;
    return {
      liveTodayMs,
      buckets,
      focus,
      golden,
      nightMs,
      status,
      productivity,
      focusScore,
      rhythm,
      weekTotal,
      weekAvg,
      scores,
      persona,
      challenges,
      validDays,
      missing7,
      weekDays,
      heatmapDays
    };
  }, [snapshot, nowMs]);

  useEffect(() => {
    if (!derived?.weekDays.length) return;
    setSelectedWeekDay((current) => {
      if (current && derived.weekDays.some((day) => day.dateKey === current)) return current;
      return derived.weekDays[derived.weekDays.length - 1]?.dateKey ?? null;
    });
  }, [derived?.weekDays]);

  if (error) {
    return <div className="nw-loading">读取失败：{error}</div>;
  }

  if (!snapshot || !derived) {
    return <div className="nw-loading">正在读取本地数据...</div>;
  }

  async function toggleTheme() {
    const resolved: ThemeMode = theme === "dark" || theme === "system" ? "light" : "dark";
    setTheme(resolved);
    applyTheme(resolved);
    await updateSettings({ theme: resolved });
  }

  async function saveNote() {
    const next = { ...notes, [snapshot.dateKey]: draftNote.trim() };
    if (!draftNote.trim()) delete next[snapshot.dateKey];
    setNotes(next);
    await setLocal({ [STORAGE_KEYS.dayNotes]: next });
    setNoteSaved(true);
    window.setTimeout(() => setNoteSaved(false), 1200);
  }

  const maxHeat = Math.max(1, ...derived.heatmapDays.flatMap((day) => day.buckets));
  const monthDays = derived.heatmapDays.filter((day) => day.dateKey.slice(0, 7) === snapshot.dateKey.slice(0, 7));
  const monthTotal = monthDays.reduce((sum, day) => sum + day.totalActiveMs, 0);
  const monthNight = monthDays.reduce(
    (sum, day) =>
      sum + day.buckets.reduce((inner, value, hour) => (hour >= 22 || hour < 6 ? inner + value : inner), 0),
    0
  );
  const maxWeek = Math.max(1, ...derived.weekDays.map((item) => item.totalActiveMs));
  const activeWeekDay =
    derived.weekDays.find((day) => day.dateKey === selectedWeekDay) ??
    derived.weekDays[derived.weekDays.length - 1] ??
    null;
  const weekBuckets = normalizeBuckets(activeWeekDay?.activeHourBuckets);
  const weekGolden = findGoldenHours(weekBuckets);
  const weekFocus = findLongestFocusBlock(weekBuckets);

  return (
    <div className="nw-frame">
      <header className="nw-header">
        <div className="nw-brand">
          <div className="nw-logo" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>NightWatch Heatmap</h1>
          </div>
          <span className={`nw-badge tone-${derived.status}`}>{statusLabel(derived.status)}</span>
          <span className="nw-badge tone-cyan">生产力 {derived.productivity}%</span>
          <span className="nw-badge tone-violet">{derived.rhythm.label}</span>
        </div>
        <div className="nw-header-actions">
          <span className="nw-updated">{new Date(snapshot.updatedAt).toLocaleTimeString()}</span>
          <button type="button" className="nw-icon-btn" onClick={() => void toggleTheme()} title="主题">
            主题
          </button>
          <button type="button" className="nw-icon-btn" onClick={() => void chrome.runtime.openOptionsPage()} title="设置">
            设置
          </button>
        </div>
      </header>

      <section className="nw-kpi-row">
        <article>
          <span>今日活跃</span>
          <strong>{formatCompactDuration(derived.liveTodayMs)}</strong>
        </article>
        <article>
          <span>最早</span>
          <strong>{formatHourMinute(snapshot.todayWindow?.firstUsedAt)}</strong>
        </article>
        <article>
          <span>最晚</span>
          <strong>{formatHourMinute(snapshot.todayWindow?.lastUsedAt)}</strong>
        </article>
        <article>
          <span>本周</span>
          <strong>{formatCompactDuration(derived.weekTotal)}</strong>
        </article>
        <article>
          <span>日均</span>
          <strong>{formatCompactDuration(derived.weekAvg)}</strong>
        </article>
        <article>
          <span>深夜</span>
          <strong>{formatCompactDuration(derived.nightMs)}</strong>
        </article>
      </section>

      <nav className="nw-tabs" aria-label="面板切换">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="nw-main">
        {tab === "today" ? (
          <section className="nw-panel fill nw-today-layout">
            <div className="nw-today-main">
              <div className="nw-panel-head">
                <h2>今日 24h 活跃趋势</h2>
                <button type="button" className="nw-mini-btn" onClick={() => setReplaying(true)}>
                  回放
                </button>
              </div>
              <AreaChart values={derived.buckets} golden={derived.golden} focus={derived.focus} chartId="today" tall />
              <div className="nw-summary-lines horizontal">
                <p>
                  最长专注{" "}
                  {derived.focus
                    ? `${formatHourRange(derived.focus.start, derived.focus.end)} · ${formatCompactDuration(derived.focus.ms)}`
                    : "暂无"}
                </p>
                <p>
                  黄金时段{" "}
                  {derived.golden
                    ? `${formatHourRange(derived.golden.start, derived.golden.end)} · ${formatCompactDuration(derived.golden.avg)}/h`
                    : "数据不足"}
                </p>
              </div>
              {replaying || replayHour > 0 ? (
                <div className="nw-replay">
                  {derived.buckets.map((value, hour) => (
                    <i
                      key={hour}
                      className={`${hour === replayHour ? "cursor" : ""} ${value > 0 ? "active" : "idle"}`}
                      title={`${hour}:00`}
                    />
                  ))}
                </div>
              ) : null}
              <div className="nw-note-row">
                <input
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  placeholder="给今天写一句话备注…"
                />
                <button type="button" className="nw-mini-btn primary" onClick={() => void saveNote()}>
                  {noteSaved ? "已保存" : "保存"}
                </button>
              </div>
            </div>
            <aside className="nw-today-top">
              <div className="nw-panel-head">
                <h2>今日访问 Top5</h2>
                <span>按时长</span>
              </div>
              <div className="nw-top-list">
                {snapshot.topDomains.length ? (
                  snapshot.topDomains.slice(0, 5).map((item, index) => {
                    const maxTop = Math.max(1, ...snapshot.topDomains.map((row) => row.totalActiveMs));
                    return (
                      <div className="nw-top-row" key={item.domain}>
                        <span className="nw-top-rank">#{index + 1}</span>
                        <div className="nw-top-meta">
                          <strong title={item.domain}>{item.domain}</strong>
                          <div className="nw-top-bar">
                            <i style={{ width: `${(item.totalActiveMs / maxTop) * 100}%` }} />
                          </div>
                        </div>
                        <b>{formatCompactDuration(item.totalActiveMs)}</b>
                      </div>
                    );
                  })
                ) : (
                  <div className="nw-chart-empty padded">今日暂无站点记录</div>
                )}
              </div>
            </aside>
          </section>
        ) : null}

        {tab === "week" ? (
          <section className="nw-panel fill nw-week-layout">
            <div className="nw-week-side">
              <div className="nw-panel-head">
                <h2>本周回溯</h2>
                <span>7 天</span>
              </div>
              <div className="nw-week-list">
                {derived.weekDays
                  .slice()
                  .reverse()
                  .map((day) => (
                    <button
                      type="button"
                      className={`nw-day-card ${selectedWeekDay === day.dateKey ? "open" : ""}`}
                      key={day.dateKey}
                      onClick={() => setSelectedWeekDay(day.dateKey)}
                    >
                      <div className="nw-day-top">
                        <strong>
                          {weekdayLabel(day.dateKey)} {day.dateKey.slice(5)}
                        </strong>
                        <b>{formatCompactDuration(day.totalActiveMs)}</b>
                      </div>
                      <div className="nw-day-meta">
                        <span>
                          {formatHourMinute(day.firstUsedAt)}–{formatHourMinute(day.lastUsedAt)}
                        </span>
                        <div className="nw-day-bar">
                          <i style={{ width: `${(day.totalActiveMs / maxWeek) * 100}%` }} />
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
            <div className="nw-week-chart">
              <div className="nw-panel-head">
                <h2>{activeWeekDay ? `${weekdayLabel(activeWeekDay.dateKey)} ${activeWeekDay.dateKey.slice(5)}` : "日趋势"}</h2>
                <span>{activeWeekDay ? formatCompactDuration(activeWeekDay.totalActiveMs) : ""}</span>
              </div>
              {activeWeekDay ? (
                <>
                  <AreaChart
                    values={weekBuckets}
                    golden={weekGolden}
                    focus={weekFocus}
                    chartId={`week-${activeWeekDay.dateKey}`}
                    tall
                  />
                  {notes[activeWeekDay.dateKey] ? <em className="nw-week-note">备注：{notes[activeWeekDay.dateKey]}</em> : null}
                </>
              ) : (
                <div className="nw-chart-empty padded">暂无本周数据</div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "year" ? (
          <section className="nw-panel fill">
            <div className="nw-panel-head">
              <h2>日期 × 小时热力图</h2>
              <span>新 → 旧 · 最近 30 天 · 完整 24 小时</span>
            </div>
            <div className="nw-heat-wrap">
              <div className="nw-heat-hours">
                <span className="nw-heat-spacer" />
                <div className="nw-heat-hour-track">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span key={hour}>{hour % 6 === 0 ? String(hour).padStart(2, "0") : ""}</span>
                  ))}
                </div>
              </div>
              <div className="nw-heat-grid">
                {derived.heatmapDays.map((day) => (
                  <div className="nw-heat-row" key={day.dateKey}>
                    <span>{heatDateLabel(day.dateKey)}</span>
                    <div className="nw-heat-cells">
                      {normalizeBuckets(day.buckets).map((value, hour) => (
                        <i
                          key={`${day.dateKey}-${hour}`}
                          title={`${day.dateKey} ${String(hour).padStart(2, "0")}:00 · ${formatCompactDuration(value)}`}
                          style={{ background: heatColor(value / maxHeat) }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "persona" ? (
          <section className="nw-panel fill nw-persona-panel">
            <div className="nw-panel-head">
              <h2>工作人格</h2>
            </div>
            <div className="nw-insight-grid">
              <article>
                <span>黄金时段</span>
                <strong>
                  {derived.golden ? formatHourRange(derived.golden.start, derived.golden.end) : "暂无"}
                </strong>
              </article>
              <article>
                <span>工作节律</span>
                <strong>{derived.rhythm.label}</strong>
                <small>
                  开工 ±{derived.rhythm.startStd.toFixed(1)}h · 收工 ±{derived.rhythm.endStd.toFixed(1)}h
                </small>
              </article>
              <article className="nw-focus-score">
                <span>专注指数</span>
                <strong>{derived.focusScore}</strong>
                <small>/ 100</small>
              </article>
            </div>
            <div className="nw-persona-layout">
              <Radar scores={derived.scores} />
              <div className="nw-persona-card">
                <span>人格结论</span>
                <strong>你是「{derived.persona.name}」</strong>
                <p>{derived.persona.blurb}</p>
                <div className="nw-xp compact">
                  <div className="nw-xp-bar">
                    <span style={{ width: `${snapshot.profile.progress * 100}%` }} />
                  </div>
                  <small>
                    Lv.{snapshot.profile.level} · {snapshot.profile.xp}/{snapshot.profile.nextLevelXp} EXP
                  </small>
                </div>
                <div className="nw-challenges compact">
                  {derived.challenges.map((item) => (
                    <div className={`nw-challenge ${item.done ? "done" : ""}`} key={item.id}>
                      <i>{item.done ? "✓" : "○"}</i>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {tab === "month" ? (
          <section className="nw-panel fill">
            <div className="nw-panel-head">
              <h2>{snapshot.dateKey.slice(0, 7)} 月报</h2>
            </div>
            <div className="nw-kpi-row nested">
              <article>
                <span>本月累计</span>
                <strong>{formatCompactDuration(monthTotal)}</strong>
              </article>
              <article>
                <span>有效天数</span>
                <strong>
                  {monthDays.filter((day) => day.totalActiveMs > 0).length}/{Math.max(1, monthDays.length)}
                </strong>
              </article>
              <article>
                <span>深夜占比</span>
                <strong>{monthTotal > 0 ? Math.round((monthNight / monthTotal) * 100) : 0}%</strong>
              </article>
              <article>
                <span>数据健康</span>
                <strong>
                  {derived.validDays}/30
                </strong>
              </article>
            </div>
            <div className="nw-health-chips">
              <span>最早记录：{snapshot.firstRecordDateKey ?? "暂无"}</span>
              <span>近 7 天空缺：{derived.missing7} 天</span>
            </div>
            <p className="nw-month-note">若深夜占比持续抬升，可以把重活往白天挪一点。</p>
          </section>
        ) : null}
      </main>

      <footer className="nw-footer">
        <button type="button" className="nw-mini-btn" onClick={() => void openDashboard().then(() => window.close())}>
          打开历史仪表盘
        </button>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<NightWatchPopup />);
