import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { getDashboardPayload, getSettings } from "../shared/api";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { applyTheme } from "../shared/theme";
import type { Achievement, DashboardPayload, DashboardRange, PeriodReport, TrendInsight } from "../shared/types";
import { formatDuration, parseDateKey } from "../shared/time";
import { HeatmapMatrix, RankBars, RhythmBars, Sparkline } from "../ui/charts";
import "./dashboard.css";

type DashTab = "overview" | "days" | "sites" | "reports" | "achievements";

const TABS: Array<{ id: DashTab; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "days", label: "按日" },
  { id: "sites", label: "站点" },
  { id: "reports", label: "报告" },
  { id: "achievements", label: "成就" }
];

function formatDay(dateKey: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(parseDateKey(dateKey));
}

function formatTime(value?: number) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function insightToneLabel(tone: TrendInsight["tone"]) {
  if (tone === "up") return "上升";
  if (tone === "down") return "下降";
  if (tone === "peak") return "高峰";
  return "稳定";
}

function toCsv(payload: DashboardPayload) {
  const headA = "dateKey,totalActiveMs,uniqueDomainCount,openedTabCount";
  const rowsA = payload.summaryRows.map(
    (row) => `${row.dateKey},${row.totalActiveMs},${row.uniqueDomainCount},${row.openedTabCount}`
  );
  const headB = "dateKey,domain,totalActiveMs,activeVisitCount,openVisitCount,avgVisitMs";
  const rowsB = payload.domainRows.map(
    (row) =>
      `${row.dateKey},${row.domain},${row.totalActiveMs},${row.activeVisitCount},${row.openVisitCount},${row.avgVisitMs}`
  );
  return `${headA}\n${rowsA.join("\n")}\n\n${headB}\n${rowsB.join("\n")}`;
}

function downloadText(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function ReportCard({ report }: { report: PeriodReport }) {
  const change = report.changePercent ?? 0;
  return (
    <div className="db-report">
      <div className="db-report-head">
        <div>
          <strong>{report.title}</strong>
          <small>
            {report.startDateKey} 至 {report.endDateKey}
          </small>
        </div>
        <span className={change >= 0 ? "" : "neg"}>
          {change >= 0 ? "+" : ""}
          {change}%
        </span>
      </div>
      <div className="db-report-metrics">
        <div>
          <span>活跃时长</span>
          <strong>{formatDuration(report.totalActiveMs)}</strong>
        </div>
        <div>
          <span>活跃天数</span>
          <strong>{report.activeDayCount}</strong>
        </div>
        <div>
          <span>站点数</span>
          <strong>{report.uniqueDomainCount}</strong>
        </div>
        <div>
          <span>日均</span>
          <strong>{formatDuration(report.avgDailyActiveMs)}</strong>
        </div>
      </div>
      {report.highlights?.length ? (
        <small style={{ color: "var(--db-muted)", fontSize: "0.68rem", lineHeight: 1.4 }}>
          {report.highlights.slice(0, 3).join(" · ")}
        </small>
      ) : null}
    </div>
  );
}

function readInitialTab(): DashTab {
  const hash = location.hash.replace("#", "");
  if (TABS.some((tab) => tab.id === hash)) return hash as DashTab;
  return "overview";
}

function DashboardApp() {
  const [range, setRange] = useState<DashboardRange>(DEFAULT_SETTINGS.dashboardDefaultRange);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [tab, setTab] = useState<DashTab>(readInitialTab);
  const [loading, setLoading] = useState(true);
  const [achFilter, setAchFilter] = useState<"all" | "unlocked" | "progress" | "locked">("all");

  useEffect(() => {
    void (async () => {
      const config = await getSettings();
      setRange(config.settings.dashboardDefaultRange);
      applyTheme("dark");
    })();
  }, []);

  useEffect(() => {
    setLoading(true);
    void getDashboardPayload(range)
      .then((result) => setPayload(result))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    if (!payload) return;
    const dates = payload.summaryRows.map((row) => row.dateKey);
    setSelectedDate((current) => (current && dates.includes(current) ? current : dates[dates.length - 1] ?? null));
    const top = payload.charts.topDomains[0]?.domain ?? null;
    setSelectedDomain((current) => current ?? top);
  }, [payload]);

  useEffect(() => {
    location.hash = tab;
  }, [tab]);

  const derived = useMemo(() => {
    if (!payload) return null;
    const latestFirst = payload.summaryRows.slice().reverse();
    const selectedSummary = payload.summaryRows.find((row) => row.dateKey === selectedDate) ?? null;
    const selectedWindow = payload.dayWindows.find((item) => item.dateKey === selectedDate) ?? {};
    const selectedDaySites = payload.domainRows
      .filter((row) => row.dateKey === selectedDate)
      .sort((left, right) => right.totalActiveMs - left.totalActiveMs)
      .slice(0, 12);
    const selectedTimeline = payload.timelineEntries.filter((entry) => entry.dateKey === selectedDate).slice(0, 24);
    const averageDaily = payload.summaryRows.length
      ? Math.round(payload.totals.totalActiveMs / payload.summaryRows.length)
      : 0;
    const domainHistory = selectedDomain
      ? payload.domainRows
          .filter((row) => row.domain === selectedDomain)
          .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
      : [];
    const domainTotal = domainHistory.reduce((sum, row) => sum + row.totalActiveMs, 0);
    const domainDayRows = [...domainHistory].reverse();
    const achievements = payload.profile.achievements;
    const filteredAchievements = achievements.filter((item) => {
      if (achFilter === "unlocked") return item.unlocked;
      if (achFilter === "progress") return !item.unlocked && item.progress > 0;
      if (achFilter === "locked") return !item.unlocked && item.progress === 0;
      return true;
    });
    return {
      latestFirst,
      selectedSummary,
      selectedWindow,
      selectedDaySites,
      selectedTimeline,
      averageDaily,
      domainHistory,
      domainDayRows,
      domainTotal,
      achievements,
      filteredAchievements,
      unlockedCount: achievements.filter((item) => item.unlocked).length
    };
  }, [payload, selectedDate, selectedDomain, achFilter]);

  if (loading && !payload) {
    return <div className="db-loading">正在整理本地历史数据...</div>;
  }

  if (!payload || !derived) {
    return <div className="db-loading">暂无可展示数据。</div>;
  }

  const rangeText = payload.range === "week" ? "近 7 天" : payload.range === "month" ? "本月" : "全部历史";

  return (
    <div className="db-app">
      <header className="db-top">
        <div className="db-brand">
          <h1>NightWatch · 历史仪表盘</h1>
          <p>
            {rangeText} · {payload.startDateKey} → {payload.endDateKey}
          </p>
        </div>
        <div className="db-top-actions">
          {(["week", "month", "all"] as DashboardRange[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`db-btn ${range === item ? "active" : ""}`}
              onClick={() => setRange(item)}
            >
              {item === "week" ? "7 天" : item === "month" ? "本月" : "全部"}
            </button>
          ))}
          <button
            type="button"
            className="db-btn"
            onClick={() =>
              downloadText(
                `webpulse-${payload.startDateKey}-${payload.endDateKey}.json`,
                JSON.stringify(payload, null, 2),
                "application/json"
              )
            }
          >
            导出 JSON
          </button>
          <button
            type="button"
            className="db-btn"
            onClick={() =>
              downloadText(
                `webpulse-${payload.startDateKey}-${payload.endDateKey}.csv`,
                toCsv(payload),
                "text/csv;charset=utf-8"
              )
            }
          >
            导出 CSV
          </button>
          <button type="button" className="db-btn" onClick={() => void chrome.runtime.openOptionsPage()}>
            设置
          </button>
        </div>
      </header>

      <nav className="db-tabs" aria-label="仪表盘分区">
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

      {tab === "overview" ? (
        <>
          <section className="db-kpi">
            <div className="db-stat">
              <span>累计活跃</span>
              <strong>{formatDuration(payload.totals.totalActiveMs)}</strong>
            </div>
            <div className="db-stat">
              <span>访问站点</span>
              <strong>{payload.totals.uniqueDomainCount}</strong>
            </div>
            <div className="db-stat">
              <span>新标签页</span>
              <strong>{payload.totals.openedTabCount}</strong>
            </div>
            <div className="db-stat">
              <span>日均活跃</span>
              <strong>{formatDuration(derived.averageDaily)}</strong>
            </div>
          </section>

          <section className="db-grid-2">
            <article className="db-card">
              <div className="db-card-head">
                <h2>历史趋势</h2>
                <span>按天聚合</span>
              </div>
              <div className="db-card-body">
                {payload.charts.dailySeries.length ? (
                  <Sparkline values={payload.charts.dailySeries.map((item) => item.value)} />
                ) : (
                  <div className="db-empty">暂无趋势数据</div>
                )}
              </div>
            </article>
            <article className="db-card">
              <div className="db-card-head">
                <h2>成长</h2>
                <span>
                  {derived.unlockedCount}/{derived.achievements.length} 成就
                </span>
              </div>
              <div className="db-card-body">
                <div className="db-level">
                  <div className="db-level-orb">
                    <span>LV</span>
                    <strong>{payload.profile.level}</strong>
                  </div>
                  <div>
                    <strong>{payload.profile.levelTitle}</strong>
                    <div className="db-bar" style={{ marginTop: 8 }}>
                      <span style={{ width: `${payload.profile.progress * 100}%` }} />
                    </div>
                    <small style={{ color: "var(--db-muted)", fontSize: "0.68rem" }}>
                      {payload.profile.xp} / {payload.profile.nextLevelXp} XP
                    </small>
                  </div>
                </div>
              </div>
            </article>
          </section>

          <article className="db-card">
            <div className="db-card-head">
              <h2>活跃热力</h2>
              <span>近 14 日小时分布</span>
            </div>
            <div className="db-card-body">
              {payload.charts.heatmapDays.length ? (
                <HeatmapMatrix rows={payload.charts.heatmapDays} />
              ) : (
                <div className="db-empty">暂无热力数据</div>
              )}
            </div>
          </article>

          <article className="db-card">
            <div className="db-card-head">
              <h2>趋势洞察</h2>
            </div>
            <div className="db-card-body">
              <div className="db-insight-grid">
                {payload.insights.map((insight) => (
                  <div className="db-insight" key={insight.id}>
                    <span>{insightToneLabel(insight.tone)}</span>
                    <strong>{insight.value}</strong>
                    <b>{insight.title}</b>
                    <small>{insight.description}</small>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </>
      ) : null}

      {tab === "days" ? (
        <section className="db-grid-day">
          <article className="db-card">
            <div className="db-card-head">
              <h2>历史日期</h2>
              <span>{derived.latestFirst.length} 天</span>
            </div>
            <div className="db-card-body">
              {derived.latestFirst.length ? (
                <div className="db-day-list">
                  {derived.latestFirst.map((row) => (
                    <button
                      type="button"
                      className={`db-day-item ${row.dateKey === selectedDate ? "active" : ""}`}
                      key={row.dateKey}
                      onClick={() => setSelectedDate(row.dateKey)}
                    >
                      <span>
                        <strong>{formatDay(row.dateKey)}</strong>
                        <small>{row.dateKey}</small>
                      </span>
                      <b>{formatDuration(row.totalActiveMs)}</b>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="db-empty">还没有历史记录</div>
              )}
            </div>
          </article>

          <article className="db-card">
            <div className="db-card-head">
              <h2>{selectedDate ?? "单日详情"}</h2>
              <span>当天指标与节奏</span>
            </div>
            <div className="db-card-body">
              {derived.selectedSummary ? (
                <>
                  <div className="db-metrics">
                    <div className="db-stat">
                      <span>当天活跃</span>
                      <strong>{formatDuration(derived.selectedSummary.totalActiveMs)}</strong>
                    </div>
                    <div className="db-stat">
                      <span>站点</span>
                      <strong>{derived.selectedSummary.uniqueDomainCount}</strong>
                    </div>
                    <div className="db-stat">
                      <span>新标签</span>
                      <strong>{derived.selectedSummary.openedTabCount}</strong>
                    </div>
                    <div className="db-stat">
                      <span>单站平均</span>
                      <strong>
                        {formatDuration(
                          derived.selectedSummary.uniqueDomainCount
                            ? Math.round(
                                derived.selectedSummary.totalActiveMs / derived.selectedSummary.uniqueDomainCount
                              )
                            : 0
                        )}
                      </strong>
                    </div>
                  </div>
                  <div className="db-pair">
                    <div>
                      <span>最早</span>
                      <strong>{formatTime(derived.selectedWindow.firstUsedAt)}</strong>
                      <small>{derived.selectedWindow.firstDomain ?? "暂无"}</small>
                    </div>
                    <div>
                      <span>最晚</span>
                      <strong>{formatTime(derived.selectedWindow.lastUsedAt)}</strong>
                      <small>{derived.selectedWindow.lastDomain ?? "暂无"}</small>
                    </div>
                  </div>
                  <RhythmBars values={derived.selectedSummary.activeHourBuckets} />
                  <div style={{ height: 12 }} />
                  {derived.selectedDaySites.length ? (
                    <div className="db-site-list" style={{ marginBottom: 12 }}>
                      {derived.selectedDaySites.map((row, index) => (
                        <button
                          type="button"
                          className="db-site-row"
                          key={row.id}
                          onClick={() => {
                            setSelectedDomain(row.domain);
                            setTab("sites");
                          }}
                        >
                          <span>#{index + 1}</span>
                          <div>
                            <strong>{row.domain}</strong>
                            <small>
                              {row.activeVisitCount} 活跃 / {row.openVisitCount} 打开
                            </small>
                          </div>
                          <b>{formatDuration(row.totalActiveMs)}</b>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="db-timeline">
                    {derived.selectedTimeline.length ? (
                      derived.selectedTimeline.map((entry) => (
                        <div className="db-timeline-row" key={`${entry.domain}-${entry.startAt}`}>
                          <time>{formatTime(entry.startAt)}</time>
                          <div>
                            <strong>{entry.domain}</strong>
                            <small>
                              {formatTime(entry.startAt)} - {formatTime(entry.endAt)}
                            </small>
                          </div>
                          <b>{formatDuration(entry.totalActiveMs)}</b>
                        </div>
                      ))
                    ) : (
                      <div className="db-empty">当天暂无时间轴</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="db-empty">选择左侧日期后查看详情</div>
              )}
            </div>
          </article>
        </section>
      ) : null}

      {tab === "sites" ? (
        <section className="db-grid-2">
          <article className="db-card">
            <div className="db-card-head">
              <h2>站点排行</h2>
              <span>点击查看明细</span>
            </div>
            <div className="db-card-body">
              {payload.charts.topDomains.length ? (
                <div className="db-site-list">
                  {payload.charts.topDomains.map((item, index) => (
                    <button
                      type="button"
                      key={item.domain}
                      className={`db-site-row ${selectedDomain === item.domain ? "active" : ""}`}
                      onClick={() => setSelectedDomain(item.domain)}
                    >
                      <span>#{index + 1}</span>
                      <div>
                        <strong>{item.domain}</strong>
                        <small>{formatDuration(item.totalActiveMs)}</small>
                      </div>
                      <b>{Math.round(item.totalActiveMs / 36_000) / 100}h</b>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="db-empty">暂无站点排行</div>
              )}
            </div>
          </article>

          <article className="db-card">
            <div className="db-card-head">
              <h2>{selectedDomain ?? "站点详情"}</h2>
              <span>范围内累计 {formatDuration(derived.domainTotal)}</span>
            </div>
            <div className="db-card-body">
              {selectedDomain && derived.domainHistory.length ? (
                <>
                  <RankBars
                    data={derived.domainHistory.map((row) => ({
                      domain: row.dateKey,
                      totalActiveMs: row.totalActiveMs
                    }))}
                    limit={14}
                  />
                  <div style={{ height: 10 }} />
                  <div className="db-site-list">
                    {derived.domainDayRows.map((row, index) => (
                      <div className="db-site-row" key={row.id}>
                        <span>#{index + 1}</span>
                        <div>
                          <strong>{row.dateKey}</strong>
                          <small>
                            {row.activeVisitCount} 活跃 / {row.openVisitCount} 打开 · 均次 {formatDuration(row.avgVisitMs)}
                          </small>
                        </div>
                        <b>{formatDuration(row.totalActiveMs)}</b>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="db-empty">选择左侧站点查看明细</div>
              )}
            </div>
          </article>
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="db-report-grid">
          <ReportCard report={payload.reports.weekly} />
          <ReportCard report={payload.reports.monthly} />
        </section>
      ) : null}

      {tab === "achievements" ? (
        <article className="db-card">
          <div className="db-card-head">
            <h2>成就</h2>
            <span>
              {derived.unlockedCount}/{derived.achievements.length} 已解锁
            </span>
          </div>
          <div className="db-card-body">
            <div className="db-filters">
              {(
                [
                  ["all", "全部"],
                  ["unlocked", "已解锁"],
                  ["progress", "进行中"],
                  ["locked", "未解锁"]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={achFilter === id ? "active" : ""}
                  onClick={() => setAchFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="db-achievements">
              {derived.filteredAchievements.map((item: Achievement) => (
                <div className={`db-ach ${item.unlocked ? "unlocked" : ""}`} key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <div className="db-bar">
                    <span style={{ width: `${item.progress * 100}%` }} />
                  </div>
                  <small>
                    {Math.min(item.current, item.target)} / {item.target}
                    {item.unlocked ? " · 已完成" : ""}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<DashboardApp />);
