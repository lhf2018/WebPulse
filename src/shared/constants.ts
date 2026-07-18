import type { CategoryRules, Settings } from "./types";

export const APP_NAME = "浏览行为分析器";
export const DB_NAME = "webpulse-db";
export const DB_VERSION = 1;
export const ALARM_TICK = "webpulse-tick";
export const DEFAULT_IDLE_THRESHOLD_SEC = 60;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  locale: "auto",
  idleThresholdSec: DEFAULT_IDLE_THRESHOLD_SEC,
  dashboardDefaultRange: "all"
};

export const DEFAULT_CATEGORY_RULES: CategoryRules = {
  exact: {},
  suffix: {},
  excluded: ["chrome.google.com", "addons.mozilla.org"]
};
