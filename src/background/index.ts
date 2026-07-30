import { ALARM_TICK, DEFAULT_CATEGORY_RULES, DEFAULT_SETTINGS } from "../shared/constants";
import { classifyDomain, isTrackableUrl, normalizeDomain } from "../shared/domain";
import { addSegmentToBuckets, splitRangeByDay } from "../shared/aggregation";
import {
  clearAllIndexedDb,
  getDailyDomainStat,
  getDailyDomainStatsInRange,
  getDailySummariesInRange,
  getDailySummary,
  putDailyDomainStat,
  putDailySummary
} from "../shared/storage/idb";
import { getLocal, readSettings, removeLocal, setLocal, STORAGE_KEYS } from "../shared/storage/local";
import { addDays, parseDateKey, rangeDateKeys, toDateKey } from "../shared/time";
import type {
  ActiveContext,
  AppMessage,
  AchievementRarity,
  CategoryId,
  CategoryRules,
  DashboardPayload,
  DashboardRange,
  DailyDomainStatRecord,
  DailySummaryRecord,
  ExperienceProfile,
  PeriodReport,
  PopupSnapshot,
  Settings,
  TimelineEntry,
  TrendInsight,
  UsageWindow
} from "../shared/types";

type SnapshotRecord = {
  activeContext: ActiveContext | null;
  focusedWindowId: number | null;
  updatedAt: number;
};

/** Allow ~2 alarm periods of slack after MV3 service-worker sleep before dropping a snapshot. */
const SNAPSHOT_RECENT_WINDOW_MS = 120_000;

let settings: Settings = DEFAULT_SETTINGS;
let rules: CategoryRules = DEFAULT_CATEGORY_RULES;
let activeContext: ActiveContext | null = null;
let focusedWindowId: number | null = null;
let tabDomains = new Map<number, string>();
let bootstrapped = false;
/** Serialize tracking mutations so concurrent tab/alarm handlers cannot double-count. */
let trackingLock: Promise<void> = Promise.resolve();

function withTrackingLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = trackingLock.then(fn, fn);
  trackingLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function now() {
  return Date.now();
}

function emptyBuckets(length: number) {
  return Array.from({ length }, () => 0);
}

function formatBadgeDuration(ms: number) {
  const totalMinutes = Math.max(1, Math.floor(ms / 60_000));
  if (totalMinutes >= 60) return `${Math.floor(totalMinutes / 60)}h`;
  return `${totalMinutes}m`;
}

function createEmptySummary(dateKey: string): DailySummaryRecord {
  return {
    dateKey,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    totalActiveMs: 0,
    uniqueDomainCount: 0,
    openedTabCount: 0,
    activeHourBuckets: emptyBuckets(24),
    heatmap15mBuckets: emptyBuckets(96),
    updatedAt: now()
  };
}

function createEmptyDomainStat(dateKey: string, domain: string, category: CategoryId): DailyDomainStatRecord {
  return {
    id: `${dateKey}::${domain}`,
    dateKey,
    domain,
    category,
    totalActiveMs: 0,
    activeVisitCount: 0,
    openVisitCount: 0,
    avgVisitMs: 0,
    firstSeenAt: now(),
    lastSeenAt: now(),
    hourBuckets: emptyBuckets(24),
    updatedAt: now()
  };
}

function xpForLevel(level: number) {
  if (level <= 1) return 0;
  return Math.round(180 * Math.pow(level - 1, 1.45));
}

function resolveLevel(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) {
    level += 1;
  }
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const progress = nextLevelXp > currentLevelXp ? (xp - currentLevelXp) / (nextLevelXp - currentLevelXp) : 1;
  return {
    level,
    currentLevelXp,
    nextLevelXp,
    progress: Math.max(0, Math.min(1, progress))
  };
}

function levelTitle(level: number) {
  if (level >= 30) return "传说档案馆长";
  if (level >= 20) return "历史档案馆长";
  if (level >= 14) return "节奏掌控者";
  if (level >= 9) return "深度浏览者";
  if (level >= 5) return "网站探索者";
  return "新手记录员";
}

function isActiveDay(row: DailySummaryRecord) {
  return row.totalActiveMs > 0 || row.uniqueDomainCount > 0 || row.openedTabCount > 0;
}

function activeDayCount(summaryRows: DailySummaryRecord[]) {
  return summaryRows.filter(isActiveDay).length;
}

function longestStreak(summaryRows: DailySummaryRecord[]) {
  const activeDates = summaryRows
    .filter(isActiveDay)
    .map((row) => row.dateKey)
    .sort((left, right) => left.localeCompare(right));
  let best = 0;
  let current = 0;
  let previous: string | null = null;
  for (const dateKey of activeDates) {
    current = !previous || addDays(previous, 1) === dateKey ? current + 1 : 1;
    best = Math.max(best, current);
    previous = dateKey;
  }
  return best;
}

function deriveUsageWindow(domainRows: DailyDomainStatRecord[], dateKey?: string): UsageWindow {
  const rows = dateKey ? domainRows.filter((row) => row.dateKey === dateKey) : domainRows;
  if (!rows.length) return dateKey ? { dateKey } : {};

  const first = rows.reduce((earliest, row) => (row.firstSeenAt < earliest.firstSeenAt ? row : earliest), rows[0]);
  const last = rows.reduce((latest, row) => (row.lastSeenAt > latest.lastSeenAt ? row : latest), rows[0]);
  return {
    dateKey,
    firstUsedAt: first.firstSeenAt,
    lastUsedAt: last.lastSeenAt,
    firstDomain: first.domain,
    lastDomain: last.domain
  };
}

const ACHIEVEMENT_RARITIES: Record<string, AchievementRarity> = {
  deep_focus: "rare",
  five_hours: "rare",
  site_explorer: "rare",
  tabs_fifty: "rare",
  week_archive: "rare",
  streak_three: "rare",
  heavy_day: "rare",
  rhythm_shape: "rare",
  early_bird: "rare",
  night_owl: "rare",
  weekend_regular: "rare",
  domain_loyalist: "rare",
  repeat_visitor: "rare",
  xp_rookie: "rare",
  level_five: "rare",
  twenty_hours: "epic",
  site_mapper: "epic",
  tabs_two_hundred: "epic",
  month_archive: "epic",
  streak_seven: "epic",
  epic_day: "epic",
  rhythm_builder: "epic",
  full_day_scout: "epic",
  domain_master: "epic",
  active_visitor: "epic",
  xp_veteran: "epic",
  level_ten: "epic",
  total_day: "epic",
  hundred_hours: "legendary",
  site_cartographer: "legendary",
  tabs_thousand: "legendary",
  quarter_archive: "legendary",
  streak_fourteen: "legendary",
  legendary_day: "legendary",
  level_twenty: "legendary"
};

function achievement(id: string, title: string, description: string, current: number, target: number) {
  const safeTarget = Math.max(1, target);
  return {
    id,
    title,
    description,
    rarity: ACHIEVEMENT_RARITIES[id] ?? "common",
    unlocked: current >= safeTarget,
    current,
    target: safeTarget,
    progress: Math.max(0, Math.min(1, current / safeTarget))
  };
}

function sumByDomain(domainRows: DailyDomainStatRecord[]) {
  const result = new Map<string, number>();
  for (const row of domainRows) {
    result.set(row.domain, (result.get(row.domain) ?? 0) + row.totalActiveMs);
  }
  return result;
}

function activeDaysInHour(summaryRows: DailySummaryRecord[], startHour: number, endHourExclusive: number) {
  return summaryRows.filter((row) =>
    row.activeHourBuckets.slice(startHour, endHourExclusive).some((bucket) => bucket > 0)
  ).length;
}

function activeSummaryRows(rows: DailySummaryRecord[]) {
  return rows.filter(isActiveDay);
}

function sumActiveMs(rows: DailySummaryRecord[]) {
  return rows.reduce((sum, row) => sum + row.totalActiveMs, 0);
}

function sumOpenTabs(rows: DailySummaryRecord[]) {
  return rows.reduce((sum, row) => sum + row.openedTabCount, 0);
}

function domainTotalsForRows(domainRows: DailyDomainStatRecord[]) {
  const totals = new Map<string, number>();
  for (const row of domainRows) {
    totals.set(row.domain, (totals.get(row.domain) ?? 0) + row.totalActiveMs);
  }
  return Array.from(totals.entries())
    .map(([domain, totalActiveMs]) => ({ domain, totalActiveMs }))
    .sort((left, right) => right.totalActiveMs - left.totalActiveMs);
}

function domainRollupsForRows(domainRows: DailyDomainStatRecord[]) {
  const totals = new Map<
    string,
    {
      domain: string;
      totalActiveMs: number;
      activeVisitCount: number;
      openVisitCount: number;
      category: CategoryId;
    }
  >();
  for (const row of domainRows) {
    const current = totals.get(row.domain);
    if (current) {
      current.totalActiveMs += row.totalActiveMs;
      current.activeVisitCount += row.activeVisitCount;
      current.openVisitCount += row.openVisitCount;
      current.category = row.category;
    } else {
      totals.set(row.domain, {
        domain: row.domain,
        totalActiveMs: row.totalActiveMs,
        activeVisitCount: row.activeVisitCount,
        openVisitCount: row.openVisitCount,
        category: row.category
      });
    }
  }
  return Array.from(totals.values()).sort((left, right) => right.totalActiveMs - left.totalActiveMs);
}

function categoryTotalsForRows(domainRows: DailyDomainStatRecord[]) {
  const totals = new Map<CategoryId, number>();
  for (const row of domainRows) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.totalActiveMs);
  }
  return Array.from(totals.entries())
    .map(([category, totalActiveMs]) => ({ category, totalActiveMs }))
    .sort((left, right) => right.totalActiveMs - left.totalActiveMs);
}

function peakDayForRows(summaryRows: DailySummaryRecord[]) {
  return summaryRows.reduce<{ dateKey?: string; totalActiveMs: number }>(
    (best, row) => (row.totalActiveMs > best.totalActiveMs ? { dateKey: row.dateKey, totalActiveMs: row.totalActiveMs } : best),
    { totalActiveMs: 0 }
  );
}

function peakHourForRows(summaryRows: DailySummaryRecord[]) {
  const buckets = emptyBuckets(24);
  for (const row of summaryRows) {
    row.activeHourBuckets.forEach((value, hour) => {
      buckets[hour] += value;
    });
  }
  const max = Math.max(0, ...buckets);
  return max > 0 ? buckets.indexOf(max) : undefined;
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function rowsInRange<T extends { dateKey: string }>(rows: T[], startDateKey: string, endDateKey: string) {
  return rows.filter((row) => row.dateKey >= startDateKey && row.dateKey <= endDateKey);
}

function monthRange(nowDate = new Date()) {
  const start = toDateKey(new Date(nowDate.getFullYear(), nowDate.getMonth(), 1));
  const end = toDateKey(nowDate);
  const previousMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1);
  const previousMonthEnd = new Date(nowDate.getFullYear(), nowDate.getMonth(), 0);
  return {
    start,
    end,
    compareStart: toDateKey(previousMonthStart),
    compareEnd: toDateKey(previousMonthEnd)
  };
}

function buildTimelineEntries(domainRows: DailyDomainStatRecord[]): TimelineEntry[] {
  return domainRows
    .filter((row) => row.firstSeenAt > 0 || row.lastSeenAt > 0)
    .map((row) => ({
      dateKey: row.dateKey,
      domain: row.domain,
      startAt: row.firstSeenAt,
      endAt: row.lastSeenAt,
      totalActiveMs: row.totalActiveMs,
      activeVisitCount: row.activeVisitCount,
      openVisitCount: row.openVisitCount
    }))
    .sort((left, right) => left.startAt - right.startAt || right.totalActiveMs - left.totalActiveMs);
}

function buildPeriodReport(
  id: PeriodReport["id"],
  title: string,
  startDateKey: string,
  endDateKey: string,
  compareStartDateKey: string,
  compareEndDateKey: string,
  summaryRows: DailySummaryRecord[],
  domainRows: DailyDomainStatRecord[]
): PeriodReport {
  const currentSummaries = rowsInRange(summaryRows, startDateKey, endDateKey);
  const previousSummaries = rowsInRange(summaryRows, compareStartDateKey, compareEndDateKey);
  const currentDomains = rowsInRange(domainRows, startDateKey, endDateKey);
  const activeRows = activeSummaryRows(currentSummaries);
  const totalActiveMs = sumActiveMs(currentSummaries);
  const previousActiveMs = sumActiveMs(previousSummaries);
  const domainRollups = domainRollupsForRows(currentDomains);
  const topDomain = domainRollups[0];
  const categoryBreakdown = categoryTotalsForRows(currentDomains);
  const topCategory = categoryBreakdown[0];
  const peakHour = peakHourForRows(currentSummaries);
  const peakDay = peakDayForRows(currentSummaries);
  const uniqueDomainCount = new Set(currentDomains.map((row) => row.domain)).size;
  const activeDayCountValue = activeRows.length;
  const highlights = [
    activeDayCountValue ? `${activeDayCountValue} 天有浏览记录` : "本周期还没有浏览记录",
    topDomain ? `停留最多：${topDomain.domain}` : "暂无站点排行",
    peakDay?.dateKey ? `高峰日：${peakDay.dateKey}` : "暂无明显高峰日",
    peakHour != null ? `高峰时段：${String(peakHour).padStart(2, "0")}:00` : "暂无明显高峰"
  ];
  return {
    id,
    title,
    startDateKey,
    endDateKey,
    totalActiveMs,
    activeDayCount: activeDayCountValue,
    uniqueDomainCount,
    openedTabCount: sumOpenTabs(currentSummaries),
    avgDailyActiveMs: activeDayCountValue ? Math.round(totalActiveMs / activeDayCountValue) : 0,
    topDomain: topDomain?.domain,
    topDomainActiveMs: topDomain?.totalActiveMs,
    topDomainActiveVisitCount: topDomain?.activeVisitCount,
    topDomainOpenVisitCount: topDomain?.openVisitCount,
    topCategory: topCategory?.category,
    topCategoryActiveMs: topCategory?.totalActiveMs,
    peakDateKey: peakDay.dateKey,
    peakDateActiveMs: peakDay.totalActiveMs,
    peakHour,
    changePercent: percentChange(totalActiveMs, previousActiveMs),
    activeCoveragePercent: currentSummaries.length
      ? Math.round((activeDayCountValue / currentSummaries.length) * 100)
      : 0,
    categoryBreakdown,
    highlights
  };
}

function buildReports(summaryRows: DailySummaryRecord[], domainRows: DailyDomainStatRecord[]) {
  const today = toDateKey();
  const weekStart = addDays(today, -6);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekStart, -1);
  const month = monthRange();
  return {
    weekly: buildPeriodReport("weekly", "本周报", weekStart, today, previousWeekStart, previousWeekEnd, summaryRows, domainRows),
    monthly: buildPeriodReport(
      "monthly",
      "本月报",
      month.start,
      month.end,
      month.compareStart,
      month.compareEnd,
      summaryRows,
      domainRows
    )
  };
}

function buildTrendInsights(summaryRows: DailySummaryRecord[], domainRows: DailyDomainStatRecord[]): TrendInsight[] {
  const today = toDateKey();
  const last7Start = addDays(today, -6);
  const prev7Start = addDays(last7Start, -7);
  const prev7End = addDays(last7Start, -1);
  const last7 = rowsInRange(summaryRows, last7Start, today);
  const prev7 = rowsInRange(summaryRows, prev7Start, prev7End);
  const month = monthRange();
  const thisMonth = rowsInRange(summaryRows, month.start, month.end);
  const previousMonth = rowsInRange(summaryRows, month.compareStart, month.compareEnd);
  const last7Ms = sumActiveMs(last7);
  const prev7Ms = sumActiveMs(prev7);
  const monthMs = sumActiveMs(thisMonth);
  const previousMonthMs = sumActiveMs(previousMonth);
  const weekChange = percentChange(last7Ms, prev7Ms);
  const monthChange = percentChange(monthMs, previousMonthMs);
  const peakHour = peakHourForRows(summaryRows);
  const topDomain = domainTotalsForRows(domainRows)[0];
  const streak = longestStreak(summaryRows);

  return [
    {
      id: "week_change",
      title: "近 7 天趋势",
      value: `${weekChange >= 0 ? "+" : ""}${weekChange}%`,
      tone: weekChange > 5 ? "up" : weekChange < -5 ? "down" : "steady",
      description:
        prev7Ms > 0
          ? `相比前 7 天，活跃时长${weekChange >= 0 ? "增加" : "减少"} ${Math.abs(weekChange)}%。`
          : last7Ms > 0
            ? "近 7 天开始形成浏览记录。"
            : "近 7 天暂无明显活跃。"
    },
    {
      id: "month_change",
      title: "本月趋势",
      value: `${monthChange >= 0 ? "+" : ""}${monthChange}%`,
      tone: monthChange > 5 ? "up" : monthChange < -5 ? "down" : "steady",
      description:
        previousMonthMs > 0
          ? `相比上月，本月活跃时长${monthChange >= 0 ? "增加" : "减少"} ${Math.abs(monthChange)}%。`
          : monthMs > 0
            ? "本月已有稳定记录，上月暂无可比数据。"
            : "本月还没有足够记录。"
    },
    {
      id: "peak_hour",
      title: "高峰时段",
      value: peakHour != null ? `${String(peakHour).padStart(2, "0")}:00` : "--:--",
      tone: "peak",
      description: peakHour != null ? "这是历史上最常出现活跃浏览的小时段。" : "暂无足够数据识别高峰。"
    },
    {
      id: "top_domain",
      title: "核心站点",
      value: topDomain?.domain ?? "暂无",
      tone: "steady",
      description: topDomain ? "该站点是全历史累计停留最多的网站。" : "暂无站点停留数据。"
    },
    {
      id: "streak",
      title: "连续记录",
      value: `${streak} 天`,
      tone: streak >= 7 ? "up" : streak > 0 ? "steady" : "down",
      description: streak >= 7 ? "已经形成连续记录习惯。" : "继续浏览会提升连续记录天数。"
    }
  ];
}

function buildExperienceProfile(summaryRows: DailySummaryRecord[], domainRows: DailyDomainStatRecord[]): ExperienceProfile {
  const totalActiveMs = summaryRows.reduce((sum, row) => sum + row.totalActiveMs, 0);
  const totalMinutes = Math.floor(totalActiveMs / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const uniqueDomainCount = new Set(domainRows.map((row) => row.domain)).size;
  const openedTabCount = summaryRows.reduce((sum, row) => sum + row.openedTabCount, 0);
  const days = activeDayCount(summaryRows);
  const streak = longestStreak(summaryRows);
  const maxSingleDayMinutes = Math.floor(Math.max(0, ...summaryRows.map((row) => row.totalActiveMs)) / 60_000);
  const maxActiveHoursInDay = Math.max(
    0,
    ...summaryRows.map((row) => row.activeHourBuckets.filter((bucket) => bucket > 0).length)
  );
  const activeHoursEver = new Set<number>();
  for (const row of summaryRows) {
    row.activeHourBuckets.forEach((bucket, hour) => {
      if (bucket > 0) activeHoursEver.add(hour);
    });
  }
  const domainTotals = sumByDomain(domainRows);
  const topDomainMinutes = Math.floor(Math.max(0, ...domainTotals.values()) / 60_000);
  const maxOpenVisitCount = Math.max(0, ...domainRows.map((row) => row.openVisitCount));
  const maxActiveVisitCount = Math.max(0, ...domainRows.map((row) => row.activeVisitCount));
  const weekendDays = summaryRows.filter((row) => {
    if (!isActiveDay(row)) return false;
    const day = parseDateKey(row.dateKey).getDay();
    return day === 0 || day === 6;
  }).length;
  const morningDays = activeDaysInHour(summaryRows, 6, 11);
  const afternoonDays = activeDaysInHour(summaryRows, 12, 18);
  const eveningDays = activeDaysInHour(summaryRows, 19, 24);
  const usageWindow = deriveUsageWindow(domainRows);
  const firstHour = usageWindow.firstUsedAt ? new Date(usageWindow.firstUsedAt).getHours() : 24;
  const lastHour = usageWindow.lastUsedAt ? new Date(usageWindow.lastUsedAt).getHours() : 0;
  const xp = totalMinutes * 5 + uniqueDomainCount * 20 + openedTabCount * 2 + days * 60 + streak * 40;
  const level = resolveLevel(xp);

  return {
    xp,
    level: level.level,
    levelTitle: levelTitle(level.level),
    currentLevelXp: level.currentLevelXp,
    nextLevelXp: level.nextLevelXp,
    progress: level.progress,
    usageWindow,
    achievements: [
      achievement("first_trace", "初次点亮", "产生第一天本地浏览记录", days, 1),
      achievement("ten_minutes", "十分钟开档", "累计活跃浏览 10 分钟", totalMinutes, 10),
      achievement("warm_start", "半小时热身", "累计活跃浏览 30 分钟", totalMinutes, 30),
      achievement("one_hour", "第一小时", "累计活跃浏览 1 小时", totalMinutes, 60),
      achievement("deep_focus", "两小时专注", "累计活跃浏览 2 小时", totalMinutes, 120),
      achievement("five_hours", "沉浸巡航", "累计活跃浏览 5 小时", totalMinutes, 300),
      achievement("twenty_hours", "长线玩家", "累计活跃浏览 20 小时", totalMinutes, 1_200),
      achievement("hundred_hours", "百小时档案", "累计活跃浏览 100 小时", totalMinutes, 6_000),
      achievement("site_three", "三站起步", "记录 3 个不同站点", uniqueDomainCount, 3),
      achievement("site_explorer", "站点探索家", "记录 10 个不同站点", uniqueDomainCount, 10),
      achievement("site_mapper", "网络制图师", "记录 30 个不同站点", uniqueDomainCount, 30),
      achievement("site_cartographer", "百站收藏家", "记录 100 个不同站点", uniqueDomainCount, 100),
      achievement("tabs_ten", "十扇窗口", "累计打开 10 个新标签页", openedTabCount, 10),
      achievement("tabs_fifty", "标签页飞轮", "累计打开 50 个新标签页", openedTabCount, 50),
      achievement("tabs_two_hundred", "高速切换", "累计打开 200 个新标签页", openedTabCount, 200),
      achievement("tabs_thousand", "千页旅人", "累计打开 1000 个新标签页", openedTabCount, 1_000),
      achievement("day_three", "三日记录", "累计 3 天有浏览记录", days, 3),
      achievement("week_archive", "一周档案", "累计 7 天有浏览记录", days, 7),
      achievement("month_archive", "月度档案", "累计 30 天有浏览记录", days, 30),
      achievement("quarter_archive", "季度档案", "累计 90 天有浏览记录", days, 90),
      achievement("streak_three", "三日连续", "连续 3 天产生记录", streak, 3),
      achievement("streak_seven", "七日连续", "连续 7 天产生记录", streak, 7),
      achievement("streak_fourteen", "双周不断", "连续 14 天产生记录", streak, 14),
      achievement("heavy_day", "重度一天", "单日活跃达到 2 小时", maxSingleDayMinutes, 120),
      achievement("epic_day", "史诗单日", "单日活跃达到 6 小时", maxSingleDayMinutes, 360),
      achievement("legendary_day", "传奇单日", "单日活跃达到 10 小时", maxSingleDayMinutes, 600),
      achievement("rhythm_shape", "节奏成型", "同一天跨 4 个小时段活跃", maxActiveHoursInDay, 4),
      achievement("rhythm_builder", "节奏建筑师", "同一天跨 8 个小时段活跃", maxActiveHoursInDay, 8),
      achievement("full_day_scout", "全天侦察", "历史上覆盖 12 个不同时段", activeHoursEver.size, 12),
      achievement("early_bird", "清晨启动", "最早使用时间早于 08:00", firstHour < 8 ? 1 : 0, 1),
      achievement("night_owl", "夜间收官", "最晚使用时间晚于 22:00", lastHour >= 22 ? 1 : 0, 1),
      achievement("weekend_browser", "周末上线", "至少 1 个周末日期有记录", weekendDays, 1),
      achievement("weekend_regular", "周末常客", "累计 4 个周末日期有记录", weekendDays, 4),
      achievement("morning_pattern", "上午节奏", "3 天在上午时段活跃", morningDays, 3),
      achievement("afternoon_pattern", "午后节奏", "3 天在午后时段活跃", afternoonDays, 3),
      achievement("evening_pattern", "夜间节奏", "3 天在夜间时段活跃", eveningDays, 3),
      achievement("domain_loyalist", "单站常客", "某个站点累计停留 1 小时", topDomainMinutes, 60),
      achievement("domain_master", "单站大师", "某个站点累计停留 5 小时", topDomainMinutes, 300),
      achievement("repeat_visitor", "反复造访", "某个站点累计打开 20 次", maxOpenVisitCount, 20),
      achievement("active_visitor", "活跃回访", "某个站点累计活跃访问 20 次", maxActiveVisitCount, 20),
      achievement("xp_rookie", "经验入门", "累计获得 1000 XP", xp, 1_000),
      achievement("xp_veteran", "经验老兵", "累计获得 5000 XP", xp, 5_000),
      achievement("level_five", "等级 5", "达到 Lv.5", level.level, 5),
      achievement("level_ten", "等级 10", "达到 Lv.10", level.level, 10),
      achievement("level_twenty", "等级 20", "达到 Lv.20", level.level, 20),
      achievement("total_day", "一天总量", "累计活跃达到 24 小时", totalHours, 24)
    ]
  };
}

async function setBadge() {
  if (!activeContext) {
    await chrome.action.setBadgeText({ text: "ON" });
    await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    return;
  }
  await chrome.action.setBadgeText({ text: formatBadgeDuration(now() - activeContext.startedAt) });
  await chrome.action.setBadgeBackgroundColor({ color: "#0f9f7a" });
}

async function persistSnapshot() {
  const snapshot: SnapshotRecord = {
    activeContext,
    focusedWindowId,
    updatedAt: now()
  };
  await setLocal({ [STORAGE_KEYS.snapshot]: snapshot });
}

async function loadSnapshot() {
  return (await getLocal(STORAGE_KEYS.snapshot)) as SnapshotRecord | undefined;
}

function shouldTrackContext(context: ActiveContext | null) {
  return Boolean(context && focusedWindowId !== null);
}

async function resolveFocusedWindowId() {
  const windows = await chrome.windows.getAll();
  const focused = windows.find((window) => window.focused && window.id != null);
  return focused?.id ?? null;
}

function bucketRecordAverage(record: DailyDomainStatRecord) {
  record.avgVisitMs = record.activeVisitCount > 0 ? Math.round(record.totalActiveMs / record.activeVisitCount) : 0;
  record.updatedAt = now();
  record.lastSeenAt = now();
}

async function incrementSummaryField(dateKey: string, updater: (summary: DailySummaryRecord) => void) {
  const summary = (await getDailySummary(dateKey)) ?? createEmptySummary(dateKey);
  updater(summary);
  summary.updatedAt = now();
  await putDailySummary(summary);
  return summary;
}

async function incrementDomainField(
  dateKey: string,
  domain: string,
  category: CategoryId,
  updater: (record: DailyDomainStatRecord) => void
) {
  const id = `${dateKey}::${domain}`;
  const existing = await getDailyDomainStat(id);
  const created = !existing;
  const record = existing ?? createEmptyDomainStat(dateKey, domain, category);
  record.category = category;
  updater(record);
  bucketRecordAverage(record);
  await putDailyDomainStat(record);
  return { record, created };
}

async function registerNavigation(domain: string, category: CategoryId, timestamp = now()) {
  const dateKey = toDateKey(new Date(timestamp));
  const { created } = await incrementDomainField(dateKey, domain, category, (record) => {
    record.openVisitCount += 1;
  });
  if (created) {
    await incrementSummaryField(dateKey, (record) => {
      record.uniqueDomainCount += 1;
    });
  }
}

async function registerOpenTab(timestamp = now()) {
  const dateKey = toDateKey(new Date(timestamp));
  await incrementSummaryField(dateKey, (record) => {
    record.openedTabCount += 1;
  });
}

async function registerSegment(startMs: number, endMs: number, domain: string, category: CategoryId) {
  const segments = splitRangeByDay(startMs, endMs);
  for (const segment of segments) {
    const duration = segment.end - segment.start;
    if (duration <= 0) continue;

    const summary = (await getDailySummary(segment.dateKey)) ?? createEmptySummary(segment.dateKey);
    const existingDomain = await getDailyDomainStat(`${segment.dateKey}::${domain}`);
    const domainStat = existingDomain ?? createEmptyDomainStat(segment.dateKey, domain, category);

    summary.totalActiveMs += duration;
    addSegmentToBuckets(summary.activeHourBuckets, segment.dateKey, segment.start, segment.end, 60);
    addSegmentToBuckets(summary.heatmap15mBuckets, segment.dateKey, segment.start, segment.end, 15);
    summary.updatedAt = now();
    if (!existingDomain) {
      summary.uniqueDomainCount += 1;
    }
    await putDailySummary(summary);

    domainStat.category = category;
    domainStat.totalActiveMs += duration;
    addSegmentToBuckets(domainStat.hourBuckets, segment.dateKey, segment.start, segment.end, 60);
    bucketRecordAverage(domainStat);
    await putDailyDomainStat(domainStat);
  }
}

async function flushActiveContext(endMs = now()) {
  if (!activeContext) return;
  const segmentStart = activeContext.lastCheckpointAt || activeContext.startedAt;
  if (endMs <= segmentStart) {
    activeContext.lastCheckpointAt = endMs;
    await persistSnapshot();
    return;
  }
  await registerSegment(segmentStart, endMs, activeContext.domain, activeContext.category);
  activeContext.lastCheckpointAt = endMs;
  await persistSnapshot();
}

async function endActiveContext() {
  if (!activeContext) return;
  await flushActiveContext();
  activeContext = null;
  await persistSnapshot();
  await setBadge();
}

async function startContextFromTab(tab: chrome.tabs.Tab) {
  const domain = normalizeDomain(tab.url);
  if (!domain || tab.id == null || tab.windowId == null || tab.incognito) {
    await endActiveContext();
    return;
  }
  if (rules.excluded.includes(domain)) {
    await endActiveContext();
    return;
  }

  const category = classifyDomain(domain, rules);
  const current = now();
  if (activeContext && activeContext.tabId === tab.id && activeContext.domain === domain) {
    activeContext.url = tab.url ?? activeContext.url;
    await persistSnapshot();
    await setBadge();
    return;
  }
  if (activeContext) {
    await flushActiveContext(current);
  }

  activeContext = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url ?? "",
    domain,
    category,
    startedAt: current,
    lastCheckpointAt: current
  };
  const dateKey = toDateKey(new Date(current));
  const { created } = await incrementDomainField(dateKey, domain, category, (record) => {
    record.activeVisitCount += 1;
  });
  if (created) {
    await incrementSummaryField(dateKey, (record) => {
      record.uniqueDomainCount += 1;
    });
  }
  await persistSnapshot();
  await setBadge();
}

async function maybeStartOrStopTracking() {
  if (focusedWindowId === null) {
    await endActiveContext();
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, windowId: focusedWindowId });
  const tab = tabs.find((item) => item.active);
  if (!tab || !isTrackableUrl(tab.url) || tab.incognito) {
    await endActiveContext();
    return;
  }
  await startContextFromTab(tab);
}

async function rebuildTabDomains() {
  tabDomains = new Map();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const domain = normalizeDomain(tab.url);
    if (tab.id != null && domain) {
      tabDomains.set(tab.id, domain);
    }
  }
}

async function restoreRecentSnapshot() {
  const snapshot = await loadSnapshot();
  if (!snapshot?.activeContext) return false;
  if (now() - snapshot.updatedAt > SNAPSHOT_RECENT_WINDOW_MS) return false;
  activeContext = snapshot.activeContext;
  focusedWindowId = snapshot.focusedWindowId;
  return true;
}

async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  settings = await readSettings();
  rules = DEFAULT_CATEGORY_RULES;
  await setLocal({
    [STORAGE_KEYS.settings]: settings,
    [STORAGE_KEYS.rules]: rules
  });
  await rebuildTabDomains();
  await restoreRecentSnapshot();
  // Live focus wins over whatever was persisted before the service worker slept.
  focusedWindowId = await resolveFocusedWindowId();
  await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });

  if (focusedWindowId === null) {
    // Chrome is in the background: drop the restored session without crediting
    // wall-clock time since lastCheckpoint (that gap may include unfocused time).
    if (activeContext) {
      activeContext = null;
      await persistSnapshot();
    }
    await setBadge();
    return;
  }

  await maybeStartOrStopTracking();
  // Commit any restored gap (lastCheckpointAt → now) once tracking is confirmed.
  if (activeContext) {
    await flushActiveContext();
  }
  await setBadge();
}

async function ensureBootstrapped() {
  await bootstrap();
}

function updateTabDomainMap(tabId: number, url?: string | null) {
  const domain = normalizeDomain(url);
  if (domain) {
    tabDomains.set(tabId, domain);
  } else {
    tabDomains.delete(tabId);
  }
  return domain;
}

async function handleTabCreated(tab: chrome.tabs.Tab) {
  await withTrackingLock(async () => {
    await ensureBootstrapped();
    if (tab.incognito) return;
    await registerOpenTab();
    const domain = updateTabDomainMap(tab.id ?? -1, tab.url);
    if (domain) {
      await registerNavigation(domain, classifyDomain(domain, rules));
    }
    if (tab.active) {
      focusedWindowId = tab.windowId ?? focusedWindowId;
      await maybeStartOrStopTracking();
    }
  });
}

async function handleTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
  await withTrackingLock(async () => {
    await ensureBootstrapped();
    if (tab.incognito) return;
    const previousDomain = tabDomains.get(tabId);
    const nextDomain = updateTabDomainMap(tabId, tab.url ?? changeInfo.url ?? undefined);
    if (nextDomain && nextDomain !== previousDomain) {
      await registerNavigation(nextDomain, classifyDomain(nextDomain, rules));
    }
    if (activeContext?.tabId === tabId && nextDomain && nextDomain !== activeContext.domain) {
      await flushActiveContext();
    }
    if (changeInfo.url || changeInfo.status === "complete") {
      await maybeStartOrStopTracking();
    }
  });
}

async function handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
  await withTrackingLock(async () => {
    await ensureBootstrapped();
    focusedWindowId = activeInfo.windowId;
    await maybeStartOrStopTracking();
  });
}

async function handleTabRemoved(tabId: number) {
  await withTrackingLock(async () => {
    await ensureBootstrapped();
    tabDomains.delete(tabId);
    if (activeContext?.tabId === tabId) {
      await endActiveContext();
    }
  });
}

async function handleWindowFocusChanged(windowId: number) {
  await withTrackingLock(async () => {
    await ensureBootstrapped();
    focusedWindowId = windowId === chrome.windows.WINDOW_ID_NONE ? null : windowId;
    if (focusedWindowId === null) {
      await endActiveContext();
      return;
    }
    await maybeStartOrStopTracking();
  });
}

async function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name !== ALARM_TICK) return;
  await withTrackingLock(async () => {
    // Critical: after MV3 SW sleep, memory is empty. Always bootstrap + resume,
    // not only flush when activeContext already exists in this JS heap.
    await ensureBootstrapped();
    if (activeContext) {
      await flushActiveContext();
    }
    await maybeStartOrStopTracking();
    await refreshPopupCache();
    await setBadge();
  });
}

function nightActiveMs(buckets: number[]) {
  let total = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    if (hour >= 22 || hour < 6) total += buckets[hour] ?? 0;
  }
  return total;
}

function buildDayCard(row: DailySummaryRecord, window: UsageWindow) {
  return {
    dateKey: row.dateKey,
    totalActiveMs: row.totalActiveMs,
    uniqueDomainCount: row.uniqueDomainCount,
    openedTabCount: row.openedTabCount,
    activeHourBuckets: row.activeHourBuckets,
    firstUsedAt: window.firstUsedAt,
    lastUsedAt: window.lastUsedAt,
    nightActiveMs: nightActiveMs(row.activeHourBuckets)
  };
}

async function buildPopupSnapshot(): Promise<PopupSnapshot> {
  await flushActiveContext();
  const today = toDateKey();
  const summary = (await getDailySummary(today)) ?? createEmptySummary(today);
  const domainRows = await getDailyDomainStatsInRange(today, today);
  const allSummaries = await getDailySummariesInRange("1970-01-01", today);
  const allDomains = await getDailyDomainStatsInRange("1970-01-01", today);
  const heatStart = addDays(today, -29);
  const heatRows = await getDailySummariesInRange(heatStart, today);
  const heatDomainRows = await getDailyDomainStatsInRange(heatStart, today);
  const heatMap = new Map(heatRows.map((row) => [row.dateKey, row]));
  if (!heatMap.has(today)) heatMap.set(today, summary);

  const heatmapDays = Array.from({ length: 30 }, (_, index) => {
    const dateKey = addDays(today, -index);
    const row = heatMap.get(dateKey) ?? createEmptySummary(dateKey);
    return {
      dateKey,
      buckets: row.activeHourBuckets,
      totalActiveMs: row.totalActiveMs
    };
  });

  const weekKeys = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  const weekDays = weekKeys.map((dateKey) => {
    const row = heatMap.get(dateKey) ?? createEmptySummary(dateKey);
    return buildDayCard(row, deriveUsageWindow(heatDomainRows, dateKey));
  });

  const recentDays = weekDays
    .slice()
    .reverse()
    .map((row) => ({
      dateKey: row.dateKey,
      totalActiveMs: row.totalActiveMs,
      uniqueDomainCount: row.uniqueDomainCount,
      openedTabCount: row.openedTabCount
    }));

  const topDomains = domainRows
    .slice()
    .sort((left, right) => right.totalActiveMs - left.totalActiveMs)
    .slice(0, 5)
    .map((row) => ({ domain: row.domain, totalActiveMs: row.totalActiveMs, category: row.category }));

  const allSummaryMap = new Map(allSummaries.map((row) => [row.dateKey, row]));
  if (!allSummaryMap.has(today)) {
    allSummaryMap.set(today, summary);
  }
  const orderedAll = Array.from(allSummaryMap.values()).sort((left, right) =>
    left.dateKey.localeCompare(right.dateKey)
  );

  return {
    dateKey: today,
    totalActiveMs: summary.totalActiveMs,
    uniqueDomainCount: summary.uniqueDomainCount,
    openedTabCount: summary.openedTabCount,
    topDomains,
    recentDays,
    weekDays,
    heatmapDays,
    todayWindow: deriveUsageWindow(domainRows, today),
    profile: buildExperienceProfile(orderedAll, allDomains),
    hourlyActivity: summary.activeHourBuckets,
    trackingActive: shouldTrackContext(activeContext),
    firstRecordDateKey: orderedAll.find((row) => row.totalActiveMs > 0)?.dateKey,
    updatedAt: now()
  };
}

async function buildDashboardPayload(range: DashboardRange): Promise<DashboardPayload> {
  await flushActiveContext();
  const { start, end } = rangeDateKeys(range);
  const summaryRows = (await getDailySummariesInRange(start, end)).sort((left, right) =>
    left.dateKey.localeCompare(right.dateKey)
  );
  const domainRows = (await getDailyDomainStatsInRange(start, end)).sort((left, right) =>
    right.totalActiveMs - left.totalActiveMs
  );
  const allRange = rangeDateKeys("all");
  const allSummaryRows =
    range === "all" ? summaryRows : await getDailySummariesInRange(allRange.start, allRange.end);
  const allDomainRows =
    range === "all" ? domainRows : await getDailyDomainStatsInRange(allRange.start, allRange.end);
  const totals = summaryRows.reduce(
    (acc, row) => {
      acc.totalActiveMs += row.totalActiveMs;
      acc.openedTabCount += row.openedTabCount;
      return acc;
    },
    { totalActiveMs: 0, uniqueDomainCount: 0, openedTabCount: 0 }
  );
  totals.uniqueDomainCount = new Set(domainRows.map((row) => row.domain)).size;

  const dailySeries = summaryRows.map((row) => ({
    label: row.dateKey.slice(5),
    value: row.totalActiveMs
  }));

  const domainMap = new Map<string, { domain: string; totalActiveMs: number; category: CategoryId }>();
  for (const row of domainRows) {
    const existing = domainMap.get(row.domain);
    if (existing) {
      existing.totalActiveMs += row.totalActiveMs;
    } else {
      domainMap.set(row.domain, {
        domain: row.domain,
        totalActiveMs: row.totalActiveMs,
        category: row.category
      });
    }
  }

  const topDomains = Array.from(domainMap.values())
    .sort((left, right) => right.totalActiveMs - left.totalActiveMs)
    .slice(0, 10);
  const heatmapDays = Array.from({ length: 14 }, (_, index) => {
    const dateKey = addDays(end, -index);
    const row = summaryRows.find((item) => item.dateKey === dateKey);
    return {
      label: `${Number(dateKey.slice(5, 7))}.${Number(dateKey.slice(8, 10))}`,
      buckets: row?.activeHourBuckets ?? Array.from({ length: 24 }, () => 0)
    };
  });
  const dayWindows = summaryRows.map((row) => deriveUsageWindow(domainRows, row.dateKey));
  const timelineEntries = buildTimelineEntries(domainRows);
  const insights = buildTrendInsights(allSummaryRows, allDomainRows);
  const reports = buildReports(allSummaryRows, allDomainRows);

  return {
    range,
    startDateKey: start,
    endDateKey: end,
    summaryRows,
    domainRows,
    dayWindows,
    timelineEntries,
    insights,
    reports,
    profile: buildExperienceProfile(
      allSummaryRows.slice().sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
      allDomainRows
    ),
    totals,
    charts: {
      dailySeries,
      topDomains,
      heatmapDays
    }
  };
}

async function refreshPopupCache() {
  const snapshot = await buildPopupSnapshot();
  await setLocal({ [STORAGE_KEYS.popup]: snapshot });
}

async function handleMessage(message: AppMessage) {
  return withTrackingLock(async () => {
    await ensureBootstrapped();
    switch (message.type) {
      case "GET_POPUP_SNAPSHOT":
        return await buildPopupSnapshot();
      case "GET_DASHBOARD_PAYLOAD":
        return await buildDashboardPayload(message.range);
      case "GET_SETTINGS":
        return { settings };
      case "UPDATE_SETTINGS":
        settings = { ...settings, ...message.patch };
        await setLocal({ [STORAGE_KEYS.settings]: settings });
        await refreshPopupCache();
        return { ok: true as const };
      case "CLEAR_ALL_DATA":
        await clearAllIndexedDb();
        await removeLocal([STORAGE_KEYS.snapshot, STORAGE_KEYS.popup]);
        activeContext = null;
        tabDomains = new Map();
        await refreshPopupCache();
        await setBadge();
        return { ok: true as const };
      case "OPEN_DASHBOARD":
        await flushActiveContext();
        await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
        return { ok: true as const };
      default:
        return { ok: true as const };
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void withTrackingLock(() => bootstrap());
});

chrome.runtime.onStartup.addListener(() => {
  void withTrackingLock(() => bootstrap());
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-dashboard") {
    void withTrackingLock(async () => {
      await ensureBootstrapped();
      await flushActiveContext();
      await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    });
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  void handleTabCreated(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void handleTabUpdated(tabId, changeInfo, tab);
});

chrome.tabs.onActivated.addListener((info) => {
  void handleTabActivated(info);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleTabRemoved(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void handleWindowFocusChanged(windowId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleAlarm(alarm);
});

chrome.runtime.onMessage.addListener((message: AppMessage, _sender, sendResponse) => {
  void handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
