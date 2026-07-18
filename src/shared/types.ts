export type ThemeMode = "dark" | "light" | "system";
export type LocaleMode = "zh-CN" | "en-US" | "auto";
export type DashboardRange = "week" | "month" | "all";
export type AchievementRarity = "common" | "rare" | "epic" | "legendary";
export type CategoryId =
  | "work"
  | "social"
  | "entertainment"
  | "shopping"
  | "learning"
  | "news"
  | "other";

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  work: "工作",
  social: "社交",
  entertainment: "娱乐",
  shopping: "购物",
  learning: "学习",
  news: "资讯",
  other: "其他"
};

export const CATEGORY_COLORS: Record<CategoryId, string> = {
  work: "#4f8cff",
  social: "#f76f8e",
  entertainment: "#ffb347",
  shopping: "#9a7cff",
  learning: "#35c2a6",
  news: "#f55d5d",
  other: "#9ca3af"
};

export interface Settings {
  theme: ThemeMode;
  locale: LocaleMode;
  idleThresholdSec: number;
  dashboardDefaultRange: DashboardRange;
}

export interface CategoryRules {
  exact: Record<string, CategoryId>;
  suffix: Record<string, CategoryId>;
  excluded: string[];
}

export interface ActiveContext {
  tabId: number;
  windowId: number;
  url: string;
  domain: string;
  category: CategoryId;
  startedAt: number;
  lastCheckpointAt: number;
  focused: boolean;
  idleState: "active" | "idle" | "locked";
}

export interface UsageWindow {
  dateKey?: string;
  firstUsedAt?: number;
  lastUsedAt?: number;
  firstDomain?: string;
  lastDomain?: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  rarity: AchievementRarity;
  unlocked: boolean;
  current: number;
  target: number;
  progress: number;
}

export interface ExperienceProfile {
  xp: number;
  level: number;
  levelTitle: string;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  usageWindow: UsageWindow;
  achievements: Achievement[];
}

export interface PopupSnapshot {
  dateKey: string;
  totalActiveMs: number;
  uniqueDomainCount: number;
  openedTabCount: number;
  topDomains: Array<{
    domain: string;
    totalActiveMs: number;
    category: CategoryId;
  }>;
  recentDays: Array<{
    dateKey: string;
    totalActiveMs: number;
    uniqueDomainCount: number;
    openedTabCount: number;
  }>;
  todayWindow: UsageWindow;
  profile: ExperienceProfile;
  hourlyActivity: number[];
  trackingActive: boolean;
  updatedAt: number;
}

export interface DailySummaryRecord {
  dateKey: string;
  timezone: string;
  totalActiveMs: number;
  uniqueDomainCount: number;
  openedTabCount: number;
  activeHourBuckets: number[];
  heatmap15mBuckets: number[];
  updatedAt: number;
}

export interface DailyDomainStatRecord {
  id: string;
  dateKey: string;
  domain: string;
  category: CategoryId;
  totalActiveMs: number;
  activeVisitCount: number;
  openVisitCount: number;
  avgVisitMs: number;
  firstSeenAt: number;
  lastSeenAt: number;
  hourBuckets: number[];
  updatedAt: number;
}

export interface TimelineEntry {
  dateKey: string;
  domain: string;
  startAt: number;
  endAt: number;
  totalActiveMs: number;
  activeVisitCount: number;
  openVisitCount: number;
}

export interface TrendInsight {
  id: string;
  title: string;
  description: string;
  value: string;
  tone: "up" | "down" | "steady" | "peak";
}

export interface PeriodReport {
  id: "weekly" | "monthly";
  title: string;
  startDateKey: string;
  endDateKey: string;
  totalActiveMs: number;
  activeDayCount: number;
  uniqueDomainCount: number;
  openedTabCount: number;
  avgDailyActiveMs: number;
  topDomain?: string;
  topDomainActiveMs?: number;
  peakHour?: number;
  changePercent?: number;
  highlights: string[];
}

export interface DashboardPayload {
  range: DashboardRange;
  startDateKey: string;
  endDateKey: string;
  summaryRows: DailySummaryRecord[];
  domainRows: DailyDomainStatRecord[];
  dayWindows: UsageWindow[];
  timelineEntries: TimelineEntry[];
  insights: TrendInsight[];
  reports: {
    weekly: PeriodReport;
    monthly: PeriodReport;
  };
  profile: ExperienceProfile;
  totals: {
    totalActiveMs: number;
    uniqueDomainCount: number;
    openedTabCount: number;
  };
  charts: {
    dailySeries: Array<{ label: string; value: number }>;
    topDomains: Array<{
      domain: string;
      totalActiveMs: number;
      category: CategoryId;
    }>;
    heatmapDays: Array<{
      label: string;
      buckets: number[];
    }>;
  };
}

export type AppMessage =
  | { type: "GET_POPUP_SNAPSHOT" }
  | { type: "GET_DASHBOARD_PAYLOAD"; range: DashboardRange }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; patch: Partial<Settings> }
  | { type: "CLEAR_ALL_DATA" }
  | { type: "OPEN_DASHBOARD" };
