import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { getDashboardPayload, getSettings } from "../shared/api";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { applyTheme } from "../shared/theme";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../shared/types";
import type { CategoryId, DashboardPayload, DashboardRange, DailyDomainStatRecord } from "../shared/types";
import { formatDuration, parseDateKey } from "../shared/time";
import { ActionButton, MetricCard, PageShell, RangeTabs, SectionCard } from "../ui/components";
import { RankBars, RhythmBars, Sparkline } from "../ui/charts";
import "../ui/styles.css";

function readInitialRange(): DashboardRange {
  const value = new URLSearchParams(window.location.search).get("range");
  if (value === "week" || value === "month" || value === "all") return value;
  return DEFAULT_SETTINGS.dashboardDefaultRange;
}

function readInitialDomain() {
  return new URLSearchParams(window.location.search).get("domain") ?? "";
}

function formatDay(dateKey: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(parseDateKey(dateKey));
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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function dashboardUrl() {
  return chrome.runtime.getURL("dashboard.html");
}

function settingsUrl() {
  return chrome.runtime.getURL("options.html");
}

function rollupDomains(rows: DailyDomainStatRecord[]) {
  const totals = new Map<
    string,
    {
      domain: string;
      category: CategoryId;
      totalActiveMs: number;
      activeVisitCount: number;
      openVisitCount: number;
      firstSeenAt: number;
      lastSeenAt: number;
      hourBuckets: number[];
    }
  >();

  for (const row of rows) {
    const current = totals.get(row.domain);
    if (current) {
      current.totalActiveMs += row.totalActiveMs;
      current.activeVisitCount += row.activeVisitCount;
      current.openVisitCount += row.openVisitCount;
      current.firstSeenAt = Math.min(current.firstSeenAt, row.firstSeenAt);
      current.lastSeenAt = Math.max(current.lastSeenAt, row.lastSeenAt);
      row.hourBuckets.forEach((value, hour) => {
        current.hourBuckets[hour] += value;
      });
      current.category = row.category;
    } else {
      totals.set(row.domain, {
        domain: row.domain,
        category: row.category,
        totalActiveMs: row.totalActiveMs,
        activeVisitCount: row.activeVisitCount,
        openVisitCount: row.openVisitCount,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        hourBuckets: [...row.hourBuckets]
      });
    }
  }

  return Array.from(totals.values()).sort((left, right) => right.totalActiveMs - left.totalActiveMs);
}

function dayRowsForDomain(payload: DashboardPayload, domain: string) {
  const rows = payload.domainRows.filter((row) => row.domain === domain);
  const rowsByDate = new Map(rows.map((row) => [row.dateKey, row]));

  return payload.summaryRows
    .map((summary) => {
      const row = rowsByDate.get(summary.dateKey);
      return {
        dateKey: summary.dateKey,
        totalActiveMs: row?.totalActiveMs ?? 0,
        activeVisitCount: row?.activeVisitCount ?? 0,
        openVisitCount: row?.openVisitCount ?? 0,
        shareOfDay: summary.totalActiveMs > 0 && row ? row.totalActiveMs / summary.totalActiveMs : 0
      };
    })
    .filter((row) => row.totalActiveMs > 0);
}

function bucketByHour(rows: DailyDomainStatRecord[]) {
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    row.hourBuckets.forEach((value, hour) => {
      buckets[hour] += value;
    });
  }
  return buckets;
}

function peakIndex(values: number[]) {
  let bestIndex = 0;
  let bestValue = 0;
  values.forEach((value, index) => {
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  });
  return bestValue > 0 ? bestIndex : undefined;
}

function SiteApp() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DashboardRange>(readInitialRange);
  const [domain, setDomain] = useState(readInitialDomain);

  useEffect(() => {
    void (async () => {
      const config = await getSettings();
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
    const url = new URL(window.location.href);
    url.searchParams.set("range", range);
    if (domain) {
      url.searchParams.set("domain", domain);
    } else {
      url.searchParams.delete("domain");
    }
    window.history.replaceState(null, "", url.toString());
  }, [domain, range]);

  const domainRows = useMemo(() => (payload ? payload.domainRows.filter((row) => row.domain === domain) : []), [payload, domain]);
  const domainProfile = useMemo(() => rollupDomains(domainRows), [domainRows]);
  const categoryRows = useMemo(() => {
    const totals = new Map<CategoryId, number>();
    for (const row of domainRows) {
      totals.set(row.category, (totals.get(row.category) ?? 0) + row.totalActiveMs);
    }
    return Array.from(totals.entries())
      .map(([category, totalActiveMs]) => ({ category, totalActiveMs }))
      .sort((left, right) => right.totalActiveMs - left.totalActiveMs);
  }, [domainRows]);

  if (loading && !payload) {
    return <div className="loading-state">正在读取站点详情...</div>;
  }

  if (!payload) {
    return <div className="loading-state">暂无站点数据。</div>;
  }

  const rankedDomains = rollupDomains(payload.domainRows);
  const domainRank = domain ? rankedDomains.findIndex((item) => item.domain === domain) + 1 : 0;
  const selected = domainProfile[0];
  const rows = domainRows;
  const totalActiveMs = rows.reduce((sum, row) => sum + row.totalActiveMs, 0);
  const activeVisitCount = rows.reduce((sum, row) => sum + row.activeVisitCount, 0);
  const openVisitCount = rows.reduce((sum, row) => sum + row.openVisitCount, 0);
  const activeDays = rows.length;
  const avgVisitMs = activeVisitCount ? Math.round(totalActiveMs / activeVisitCount) : 0;
  const firstSeenAt = rows.length ? Math.min(...rows.map((row) => row.firstSeenAt)) : undefined;
  const lastSeenAt = rows.length ? Math.max(...rows.map((row) => row.lastSeenAt)) : undefined;
  const topCategory = selected?.category;
  const categoryTotal = selected ? rows.filter((row) => row.category === selected.category).reduce((sum, row) => sum + row.totalActiveMs, 0) : 0;
  const categoryShare = totalActiveMs > 0 ? categoryTotal / totalActiveMs : 0;
  const dayRows = dayRowsForDomain(payload, domain);
  const dailySeries = payload.summaryRows.map((summary) => {
    const row = rows.find((item) => item.dateKey === summary.dateKey);
    return row?.totalActiveMs ?? 0;
  });
  const hourBuckets = bucketByHour(rows);
  const peakHour = peakIndex(hourBuckets);
  const peakDay = dayRows.slice().sort((left, right) => right.totalActiveMs - left.totalActiveMs)[0];
  const categoryMax = Math.max(1, ...categoryRows.map((item) => item.totalActiveMs));
  const nearbyDomains = rankedDomains.filter((item) => item.domain !== domain).slice(0, 8);
  const timelineRows = rows.slice().sort((left, right) => right.totalActiveMs - left.totalActiveMs);

  return (
    <PageShell
      title={domain || "站点详情"}
      subtitle={
        domain
          ? `${range === "week" ? "近 7 天" : range === "month" ? "本月" : "全部历史"}内的单站剖面。`
          : "没有收到域名参数。"
      }
      action={
        <>
          <div className="top-nav-actions">
            <button type="button" className="nav-pill" onClick={() => window.open(dashboardUrl(), "_self")}>
              历史仪表盘
            </button>
            <button type="button" className="nav-pill active">
              站点详情
            </button>
            <button type="button" className="nav-pill" onClick={() => window.open(chrome.runtime.getURL("achievements.html"), "_self")}>
              成就系统
            </button>
          </div>
          <RangeTabs value={range} onChange={setRange} />
          <ActionButton variant="ghost" onClick={() => void window.open(settingsUrl(), "_self")}>
            设置
          </ActionButton>
        </>
      }
    >
      {!domain ? (
        <SectionCard title="还没有选中站点" subtitle="缺少用于生成详情的域名。">
          <div className="empty-state">
            <ActionButton onClick={() => window.open(dashboardUrl(), "_self")}>去仪表盘选站点</ActionButton>
          </div>
        </SectionCard>
      ) : (
        <div className="site-stack">
          <div className="site-overview-layout">
            <SectionCard
              title="站点概览"
              subtitle={`当前范围内的全部聚合结果 · ${domainRank > 0 ? `排名 #${domainRank}` : "未进入前列"}`}
            >
              <div className="site-hero-grid">
                <MetricCard label="累计活跃" value={formatDuration(totalActiveMs)} tone="blue" />
                <MetricCard label="活跃访问" value={`${activeVisitCount}`} tone="mint" />
                <MetricCard label="打开次数" value={`${openVisitCount}`} tone="amber" />
                <MetricCard label="平均单次" value={formatDuration(avgVisitMs)} tone="rose" />
              </div>
              <div className="site-meta-grid">
                <div className="site-meta-card">
                  <span>最早出现</span>
                  <strong>{formatDateTime(firstSeenAt)}</strong>
                </div>
                <div className="site-meta-card">
                  <span>最晚出现</span>
                  <strong>{formatDateTime(lastSeenAt)}</strong>
                </div>
                <div className="site-meta-card">
                  <span>主分类</span>
                  <strong>{topCategory ? CATEGORY_LABELS[topCategory] : "暂无"}</strong>
                </div>
                <div className="site-meta-card">
                  <span>分类占比</span>
                  <strong>{formatPercent(categoryShare)}</strong>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="范围与分类" subtitle="当前范围内的占比结构">
              <div className="site-side-stack">
                <div className="site-share-card">
                  <div className="site-share-main">
                    <strong>{formatDuration(totalActiveMs)}</strong>
                    <small>
                      占当前范围 {formatPercent(payload.totals.totalActiveMs ? totalActiveMs / payload.totals.totalActiveMs : 0)}
                    </small>
                  </div>
                  <div className="xp-bar">
                    <span
                      style={{
                        width: `${Math.max(
                          4,
                          payload.totals.totalActiveMs ? (totalActiveMs / payload.totals.totalActiveMs) * 100 : 0
                        )}%`
                      }}
                    />
                  </div>
                  <div className="site-share-note">
                    <span>范围：{range === "week" ? "近 7 天" : range === "month" ? "本月" : "全部历史"}</span>
                    <span>活跃天数：{activeDays}</span>
                  </div>
                </div>

                <div className="site-category-stack">
                  {categoryRows.length ? (
                    categoryRows.map((item) => (
                      <div className="site-category-row" key={item.category}>
                        <span>
                          <i style={{ backgroundColor: CATEGORY_COLORS[item.category] }} />
                          {CATEGORY_LABELS[item.category]}
                        </span>
                        <div className="site-category-bar">
                          <b style={{ width: `${Math.max(10, (item.totalActiveMs / categoryMax) * 100)}%` }} />
                        </div>
                        <strong>{formatDuration(item.totalActiveMs)}</strong>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">暂无分类结构。</div>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="site-focus-layout">
            <SectionCard title="站点节奏" subtitle="按小时看这个站点最常出现的时段" className="site-fixed-card">
              <div className="site-rhythm-stack">
                <div className="site-rhythm-head">
                  <div>
                    <strong>{peakHour != null ? `${String(peakHour).padStart(2, "0")}:00` : "暂无高峰"}</strong>
                    <small>{peakDay ? `最高单日：${peakDay.dateKey}` : "暂无单日高峰"}</small>
                  </div>
                  <div className="site-rhythm-chip">{dayRows.length} 天有记录</div>
                </div>
                <RhythmBars values={hourBuckets} />
              </div>
            </SectionCard>

            <SectionCard title="周边站点" subtitle="同一范围内的其他高频站点" className="site-fixed-card">
              {nearbyDomains.length ? (
                <RankBars
                  data={nearbyDomains}
                  limit={8}
                  selectedDomain={domain}
                  onSelect={(nextDomain) => setDomain(nextDomain)}
                />
              ) : (
                <div className="empty-state">同范围里还没有别的站点记录。</div>
              )}
            </SectionCard>
          </div>

          <div className="site-record-layout">
            <SectionCard title="日期趋势" subtitle="这个站点在每一天的活跃时长" className="site-record-card">
              {dailySeries.some((value) => value > 0) ? (
                <Sparkline values={dailySeries} />
              ) : (
                <div className="empty-state">当前范围里没有这个站点的趋势数据。</div>
              )}
            </SectionCard>

            <SectionCard title="每日明细" subtitle="按日期查看这个站点的活跃记录" className="site-record-card">
              {dayRows.length ? (
                <div className="site-detail-table">
                  {dayRows
                    .slice()
                    .reverse()
                    .map((row) => (
                      <div className="site-detail-row" key={row.dateKey}>
                        <span>{formatDay(row.dateKey)}</span>
                        <strong>{row.dateKey}</strong>
                        <small>
                          {row.activeVisitCount} 次活跃 / {row.openVisitCount} 次打开
                        </small>
                        <b>{formatDuration(row.totalActiveMs)}</b>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="empty-state">这个站点在当前范围内没有单日记录。</div>
              )}
            </SectionCard>
          </div>

          <SectionCard title="站点时间轴" subtitle="按停留时长看这个站点的各个记录段" className="site-timeline-card">
            {timelineRows.length ? (
              <div className="timeline-list">
                {timelineRows.map((row) => (
                  <div className="timeline-row" key={row.id}>
                    <time>{formatDay(row.dateKey)}</time>
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <div>
                        <strong>{row.domain}</strong>
                        <small>
                          {formatDateTime(row.firstSeenAt)} - {formatDateTime(row.lastSeenAt)}
                        </small>
                      </div>
                      <b>{formatDuration(row.totalActiveMs)}</b>
                      <span className="timeline-meter">
                        <i style={{ width: `${Math.max(8, (row.totalActiveMs / Math.max(1, totalActiveMs)) * 100)}%` }} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">暂无时间轴明细。</div>
            )}
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<SiteApp />);
