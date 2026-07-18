import type { CategoryId, CategoryRules } from "./types";

export function normalizeDomain(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function isTrackableUrl(url?: string | null) {
  return normalizeDomain(url) !== null;
}

export function classifyDomain(domain: string, rules: CategoryRules): CategoryId {
  if (rules.excluded.includes(domain)) return "other";
  if (rules.exact[domain]) return rules.exact[domain];
  for (const [suffix, category] of Object.entries(rules.suffix)) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return category;
  }
  return "other";
}

export function shortDomain(domain: string) {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  return parts.slice(-2).join(".");
}
