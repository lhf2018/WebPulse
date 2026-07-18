import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getDashboardPayload, getSettings } from "../shared/api";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { applyTheme } from "../shared/theme";
import type { DashboardPayload, DashboardRange, PeriodReport, TimelineEntry, TrendInsight } from "../shared/types";
import { formatDuration, parseDateKey } from "../shared/time";
import { ActionButton, MetricCard, PageShell, RangeTabs, SectionCard } from "../ui/components";
import { HeatmapMatrix, RankBars, RhythmBars, Sparkline } from "../ui/charts";
import "../ui/styles.css";

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
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value?: number) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function insightToneLabel(tone: TrendInsight["tone"]) {
  if (tone === "up") return "上升";
  if (tone === "down") return "下降";
  if (tone === "peak") return "高峰";
  return "稳定";
}

function timelineWidth(entry: TimelineEntry, maxMs: number) {
  if (entry.totalActiveMs <= 0) return 4;
  return Math.max(8, (entry.totalActiveMs / Math.max(1, maxMs)) * 100);
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

function toExportJson(payload: DashboardPayload) {
  return {
    ...payload,
    domainRows: payload.domainRows.map(({ category, ...row }) => row),
    charts: {
      ...payload.charts,
      topDomains: payload.charts.topDomains.map(({ category, ...row }) => row)
    }
  };
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
    <div className="report-card">
      <div className="report-head">
        <div>
          <strong>{report.title}</strong>
          <small>
            {report.startDateKey} 至 {report.endDateKey}
          </small>
        </div>
        <span className={change >= 0 ? "positive" : "negative"}>
          {change >= 0 ? "+" : ""}
          {change}%
        </span>
      </div>
      <div className="report-metrics">
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
      <div className="report-highlights">
        {report.highlights.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function DashboardApp() {
  const [range, setRange] = useState<DashboardRange>(DEFAULT_SETTINGS.dashboardDefaultRange);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const config = await getSettings();
      setRange(config.settings.dashboardDefaultRange);
      applyTheme(config.settings.theme);
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
  }, [payload]);

  if (loading && !payload) {
    return <div className="loading-state">正在整理本地历史数据...</div>;
  }

  if (!payload) {
    return <div className="loading-state">暂无可展示数据。</div>;
  }

  const latestFirst = payload.summaryRows.slice().reverse();
  const maxDayMs = Math.max(1, ...payload.summaryRows.map((row) => row.totalActiveMs));
  const selectedSummary = payload.summaryRows.find((row) => row.dateKey === selectedDate) ?? null;
  const selectedWindow = payload.dayWindows.find((item) => item.dateKey === selectedDate) ?? {};
  const selectedDomainRows = payload.domainRows
    .filter((row) => row.dateKey === selectedDate)
    .sort((left, right) => right.totalActiveMs - left.totalActiveMs);
  const selectedTimeline = payload.timelineEntries.filter((entry) => entry.dateKey === selectedDate).slice(0, 30);
  const maxTimelineMs = Math.max(1, ...selectedTimeline.map((entry) => entry.totalActiveMs));
  const averageDaily = payload.summaryRows.length
    ? Math.round(payload.totals.totalActiveMs / payload.summaryRows.length)
    : 0;
  const rangeText = payload.range === "week" ? "近 7 天" : payload.range === "month" ? "本月" : "全部历史";
  const unlockedCount = payload.profile.achievements.filter((item) => item.unlocked).length;

  return (
    <PageShell
      title="浏览历史仪表盘"
      subtitle="默认持续追踪，数据只写入当前浏览器本地 IndexedDB；按日期查看每天的详细浏览节奏。"
      action={
        <>
          <div className="top-nav-actions">
            <button type="button" className="nav-pill active">
              历史仪表盘
            </button>
            <button
              type="button"
              className="nav-pill"
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("achievements.html") })}
            >
              成就系统
            </button>
          </div>
          <RangeTabs value={range} onChange={setRange} />
          <ActionButton
            variant="ghost"
            onClick={() =>
              downloadText(
                `webpulse-${payload.startDateKey}-${payload.endDateKey}.json`,
                JSON.stringify(toExportJson(payload), null, 2),
                "application/json"
              )
            }
          >
            导出 JSON
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={() =>
              downloadText(
                `webpulse-${payload.startDateKey}-${payload.endDateKey}.csv`,
                toCsv(payload),
                "text/csv;charset=utf-8"
              )
            }
          >
            导出 CSV
          </ActionButton>
          <ActionButton variant="ghost" onClick={() => void chrome.runtime.openOptionsPage()}>
            设置
          </ActionButton>
        </>
      }
    >
      <div className="history-top-grid">
        <SectionCard title="本地永久存储" subtitle="不会主动按天数清理历史记录">
          <div className="status-banner refined">
            <div>
              <strong>追踪已自动开启</strong>
              <small>
                范围：{rangeText}，{payload.startDateKey} 至 {payload.endDateKey}
              </small>
            </div>
            <div className="status-number">
              <span>记录天数</span>
              <strong>{payload.summaryRows.length}</strong>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="历史总览" subtitle="当前范围内的聚合结果">
          <div className="metric-grid">
            <MetricCard label="累计活跃时长" value={formatDuration(payload.totals.totalActiveMs)} tone="blue" />
            <MetricCard label="访问站点数" value={`${payload.totals.uniqueDomainCount}`} tone="mint" />
            <MetricCard label="新标签页" value={`${payload.totals.openedTabCount}`} tone="amber" />
            <MetricCard label="日均活跃" value={formatDuration(averageDaily)} tone="rose" />
          </div>
        </SectionCard>

        <SectionCard title="成长等级" subtitle={`${unlockedCount}/${payload.profile.achievements.length} 个成就已解锁`}>
          <div className="level-panel">
            <div className="level-orb large">
              <span>Lv</span>
              <strong>{payload.profile.level}</strong>
            </div>
            <div className="level-info">
              <strong>{payload.profile.levelTitle}</strong>
              <small>
                {payload.profile.xp} XP / 下一级 {payload.profile.nextLevelXp} XP
              </small>
              <div className="xp-bar">
                <span style={{ width: `${payload.profile.progress * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="time-pair">
            <div>
              <span>最早使用</span>
              <strong>{formatDateTime(payload.profile.usageWindow.firstUsedAt)}</strong>
              <small>{payload.profile.usageWindow.firstDomain ?? "暂无"}</small>
            </div>
            <div>
              <span>最晚使用</span>
              <strong>{formatDateTime(payload.profile.usageWindow.lastUsedAt)}</strong>
              <small>{payload.profile.usageWindow.lastDomain ?? "暂无"}</small>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="dashboard-wide-grid">
        <SectionCard title="趋势洞察" subtitle="自动比较近 7 天、本月和历史高峰" className="span-2">
          <div className="insight-grid">
            {payload.insights.map((insight: TrendInsight) => (
              <div className={`insight-card tone-${insight.tone}`} key={insight.id}>
                <span>{insightToneLabel(insight.tone)}</span>
                <strong>{insight.value}</strong>
                <b>{insight.title}</b>
                <small>{insight.description}</small>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="周报 / 月报" subtitle="滚动 7 天与本月的本地总结">
          <div className="report-stack">
            <ReportCard report={payload.reports.weekly} />
            <ReportCard report={payload.reports.monthly} />
          </div>
        </SectionCard>
      </div>

      <div className="history-layout">
        <SectionCard title="历史日期" subtitle="点击任意一天查看明细" className="history-days">
          {latestFirst.length ? (
            <div className="day-list">
              {latestFirst.map((row) => (
                <button
                  type="button"
                  className={`day-button ${row.dateKey === selectedDate ? "active" : ""}`}
                  key={row.dateKey}
                  onClick={() => setSelectedDate(row.dateKey)}
                >
                  <span>
                    <strong>{formatDay(row.dateKey)}</strong>
                    <small>{row.dateKey}</small>
                  </span>
                  <b>{formatDuration(row.totalActiveMs)}</b>
                  <i style={{ width: `${(row.totalActiveMs / maxDayMs) * 100}%` }} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">还没有历史记录。浏览网页后这里会按天展示。</div>
          )}
        </SectionCard>

        <SectionCard
          title={selectedDate ? `${selectedDate} 详细信息` : "单日详细信息"}
          subtitle="当天指标、最早/最晚使用和 24 小时活跃节奏"
          className="day-detail-panel span-2"
        >
          {selectedSummary ? (
            <div className="day-detail-stack">
              <div className="metric-grid day-metrics">
                <MetricCard label="当天活跃" value={formatDuration(selectedSummary.totalActiveMs)} tone="blue" />
                <MetricCard label="当天站点" value={`${selectedSummary.uniqueDomainCount}`} tone="mint" />
                <MetricCard label="新标签页" value={`${selectedSummary.openedTabCount}`} tone="amber" />
                <MetricCard
                  label="单站平均"
                  value={formatDuration(
                    selectedSummary.uniqueDomainCount
                      ? Math.round(selectedSummary.totalActiveMs / selectedSummary.uniqueDomainCount)
                      : 0
                  )}
                  tone="rose"
                />
              </div>
              <div className="time-pair day-window">
                <div>
                  <span>当天最早使用</span>
                  <strong>{formatTime(selectedWindow.firstUsedAt)}</strong>
                  <small>{selectedWindow.firstDomain ?? "暂无"}</small>
                </div>
                <div>
                  <span>当天最晚使用</span>
                  <strong>{formatTime(selectedWindow.lastUsedAt)}</strong>
                  <small>{selectedWindow.lastDomain ?? "暂无"}</small>
                </div>
              </div>
              <RhythmBars values={selectedSummary.activeHourBuckets} />
            </div>
          ) : (
            <div className="empty-state">选择左侧日期后查看当天细节。</div>
          )}
        </SectionCard>

        <SectionCard title="时间轴回放" subtitle="按当天站点首次出现时间排序" className="span-2">
          {selectedTimeline.length ? (
            <div className="timeline-list">
              {selectedTimeline.map((entry) => (
                <div className="timeline-row" key={`${entry.dateKey}-${entry.domain}-${entry.startAt}`}>
                  <time>{formatTime(entry.startAt)}</time>
                  <div className="timeline-dot" />
                  <div className="timeline-content">
                    <div>
                      <strong>{entry.domain}</strong>
                      <small>
                        {formatTime(entry.startAt)} - {formatTime(entry.endAt)} / {entry.activeVisitCount} 次活跃
                      </small>
                    </div>
                    <b>{formatDuration(entry.totalActiveMs)}</b>
                    <span className="timeline-meter">
                      <i style={{ width: `${timelineWidth(entry, maxTimelineMs)}%` }} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">当天暂无可回放的站点时间轴。</div>
          )}
        </SectionCard>

        <SectionCard title="当天站点明细" subtitle="按停留时长排序" className="span-2">
          {selectedDomainRows.length ? (
            <div className="site-detail-table">
              {selectedDomainRows.map((row, index) => (
                <div className="site-detail-row" key={row.id}>
                  <span>#{index + 1}</span>
                  <strong>{row.domain}</strong>
                  <small>
                    {row.activeVisitCount} 次活跃 / {row.openVisitCount} 次打开
                  </small>
                  <b>{formatDuration(row.totalActiveMs)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">当天暂无站点明细。</div>
          )}
        </SectionCard>

        <SectionCard title="历史趋势" subtitle="按天聚合的活跃时长">
          {payload.charts.dailySeries.length ? (
            <Sparkline values={payload.charts.dailySeries.map((item) => item.value)} />
          ) : (
            <div className="empty-state">暂无趋势数据。</div>
          )}
        </SectionCard>

        <SectionCard title="全历史站点排行" subtitle="当前范围内 Top 10">
          {payload.charts.topDomains.length ? (
            <RankBars data={payload.charts.topDomains} limit={10} />
          ) : (
            <div className="empty-state">暂无站点排行。</div>
          )}
        </SectionCard>

        <SectionCard title="活跃热力" subtitle="最近 14 个有记录日期的小时分布" className="span-2">
          {payload.charts.heatmapDays.length ? (
            <HeatmapMatrix rows={payload.charts.heatmapDays} />
          ) : (
            <div className="empty-state">暂无热力数据。</div>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<DashboardApp />);
