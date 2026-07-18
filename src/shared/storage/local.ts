import type { CategoryRules, Settings } from "../types";
import { DEFAULT_CATEGORY_RULES, DEFAULT_SETTINGS } from "../constants";

export const STORAGE_KEYS = {
  settings: "webpulse.settings",
  rules: "webpulse.rules",
  snapshot: "webpulse.snapshot",
  popup: "webpulse.popup",
  tabMap: "webpulse.tab-map"
} as const;

type LocalMap = {
  [STORAGE_KEYS.settings]: Settings;
  [STORAGE_KEYS.rules]: CategoryRules;
  [STORAGE_KEYS.snapshot]: unknown;
  [STORAGE_KEYS.popup]: unknown;
  [STORAGE_KEYS.tabMap]: Record<string, string>;
};

function storage() {
  return chrome.storage.local;
}

export async function getLocal<T extends keyof LocalMap>(key: T) {
  const result = await storage().get(key);
  return result[key] as LocalMap[T] | undefined;
}

export async function setLocal(partial: Partial<LocalMap>) {
  await storage().set(partial);
}

export async function removeLocal(keys: string[]) {
  await storage().remove(keys);
}

export async function readSettings() {
  const stored = (await getLocal(STORAGE_KEYS.settings)) as Partial<Settings> | undefined;
  if (!stored) return DEFAULT_SETTINGS;
  const dashboardDefaultRange =
    stored.dashboardDefaultRange === "week" || stored.dashboardDefaultRange === "month" || stored.dashboardDefaultRange === "all"
      ? stored.dashboardDefaultRange
      : DEFAULT_SETTINGS.dashboardDefaultRange;
  return {
    ...DEFAULT_SETTINGS,
    theme: stored.theme ?? DEFAULT_SETTINGS.theme,
    locale: stored.locale ?? DEFAULT_SETTINGS.locale,
    idleThresholdSec: stored.idleThresholdSec ?? DEFAULT_SETTINGS.idleThresholdSec,
    dashboardDefaultRange
  };
}

export async function readRules() {
  return (await getLocal(STORAGE_KEYS.rules)) ?? DEFAULT_CATEGORY_RULES;
}
