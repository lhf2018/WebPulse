import type { PopupDayCard, PopupSnapshot } from "../shared/types";
import { clamp } from "../shared/time";

export type DayStatus = "night" | "work" | "idle";

export function hourOf(ts?: number) {
  if (!ts) return null;
  return new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
}

export function resolveDayStatus(liveMs: number, lastUsedAt?: number): DayStatus {
  if (liveMs <= 0 && !lastUsedAt) return "idle";
  const hour = hourOf(lastUsedAt) ?? new Date().getHours();
  if (hour >= 22 || hour < 5) return "night";
  return "work";
}

export function statusLabel(status: DayStatus) {
  if (status === "night") return "深夜奋战";
  if (status === "work") return "正常工作";
  return "尚未开始";
}

export function findLongestFocusBlock(buckets: number[]) {
  const threshold = Math.max(8 * 60_000, ...buckets.map((v) => v * 0.35));
  let best = { start: 0, end: 0, ms: 0 };
  let cursor = 0;
  while (cursor < 24) {
    if ((buckets[cursor] ?? 0) < threshold) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    let ms = 0;
    while (cursor < 24 && (buckets[cursor] ?? 0) >= threshold) {
      ms += buckets[cursor] ?? 0;
      cursor += 1;
    }
    if (ms > best.ms) best = { start, end: cursor - 1, ms };
  }
  return best.ms > 0 ? best : null;
}

export function findGoldenHours(buckets: number[]) {
  let best = { start: 0, end: 1, avg: 0 };
  for (let start = 0; start <= 22; start += 1) {
    const a = buckets[start] ?? 0;
    const b = buckets[start + 1] ?? 0;
    const avg = (a + b) / 2;
    if (avg > best.avg) best = { start, end: start + 1, avg };
  }
  return best.avg > 0 ? best : null;
}

export function productivityScore(liveMs: number, focusMs: number, nightMs: number) {
  const focusRatio = liveMs > 0 ? focusMs / liveMs : 0;
  const nightPenalty = liveMs > 0 ? Math.min(0.25, nightMs / Math.max(liveMs, 1) * 0.35) : 0;
  const volume = clamp(liveMs / (8 * 3_600_000), 0, 1);
  return Math.round(clamp((focusRatio * 55 + volume * 45) * (1 - nightPenalty), 0, 1) * 100);
}

export function focusIndex(liveMs: number, focusMs: number, uniqueDomains: number) {
  const continuity = liveMs > 0 ? focusMs / liveMs : 0;
  const scatterPenalty = clamp((uniqueDomains - 4) * 0.04, 0, 0.35);
  return Math.round(clamp(continuity * 100 * (1 - scatterPenalty), 0, 100));
}

function stdDev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function rhythmProfile(days: PopupDayCard[]) {
  const starts = days.map((day) => hourOf(day.firstUsedAt)).filter((value): value is number => value != null);
  const ends = days.map((day) => hourOf(day.lastUsedAt)).filter((value): value is number => value != null);
  const startStd = stdDev(starts);
  const endStd = stdDev(ends);
  const label = startStd <= 1 && endStd <= 1.4 ? "规律型" : startStd <= 1.8 ? "弹性型" : "漂流型";
  return { label, startStd, endStd };
}

export function overtimeWarning(days: PopupDayCard[]) {
  const recent = days.slice(-5).filter((day) => hourOf(day.lastUsedAt) != null);
  const baseline = days.slice(0, -5).filter((day) => hourOf(day.lastUsedAt) != null);
  if (recent.length < 3 || baseline.length < 3) return null;
  const recentAvg =
    recent.reduce((sum, day) => sum + (hourOf(day.lastUsedAt) as number), 0) / recent.length;
  const baseAvg =
    baseline.reduce((sum, day) => sum + (hourOf(day.lastUsedAt) as number), 0) / baseline.length;
  const delta = recentAvg - baseAvg;
  if (delta < 1.2) return null;
  return `最近 ${recent.length} 天平均下班比往常晚 ${delta.toFixed(1)}h，你最近可能压力很大 💤`;
}

export function personaScores(snapshot: PopupSnapshot, liveMs: number, nightMs: number, focusMs: number) {
  const week = snapshot.weekDays;
  const early =
    week.filter((day) => {
      const hour = hourOf(day.firstUsedAt);
      return hour != null && hour < 9.5;
    }).length / Math.max(1, week.filter((day) => day.firstUsedAt).length);
  const night = clamp(nightMs / Math.max(liveMs, 1), 0, 1);
  const focus = liveMs > 0 ? clamp(focusMs / liveMs, 0, 1) : 0;
  const rhythm = rhythmProfile(week);
  const stability = clamp(1 - (rhythm.startStd + rhythm.endStd) / 6, 0, 1);
  const weekend = week.filter((day) => {
    const weekday = new Date(`${day.dateKey}T12:00:00`).getDay();
    return (weekday === 0 || weekday === 6) && day.totalActiveMs > 30 * 60_000;
  }).length;
  return {
    early: Math.round(early * 100),
    night: Math.round(night * 100),
    focus: Math.round(focus * 100),
    stability: Math.round(stability * 100),
    weekend: Math.round(clamp(weekend / 2, 0, 1) * 100)
  };
}

export function personaTitle(scores: ReturnType<typeof personaScores>) {
  if (scores.night >= 55 && scores.focus >= 45) {
    return {
      name: "深夜冲刺型",
      blurb: "白天蓄力，晚间高效产出。记得留一点睡眠给明天的自己。"
    };
  }
  if (scores.early >= 55 && scores.stability >= 55) {
    return {
      name: "清晨巡航型",
      blurb: "开工稳定，节律干净。适合把重活放在上午清场。"
    };
  }
  if (scores.focus >= 60) {
    return {
      name: "深潜专注型",
      blurb: "一旦进入状态就不太想上岸。块状专注是你的主武器。"
    };
  }
  return {
    name: "弹性观测型",
    blurb: "工作窗口漂一点，但总能把事情推进。观察比逼自己更重要。"
  };
}

export function buildChallenges(liveMs: number, focusIndexValue: number, focusMs: number, lastUsedAt?: number) {
  const hour = hourOf(lastUsedAt) ?? new Date().getHours();
  return [
    {
      id: "before22",
      label: "在 22:00 前完成所有工作",
      done: liveMs > 0 && hour < 22
    },
    {
      id: "focus60",
      label: "今日专注指数超过 60",
      done: focusIndexValue >= 60
    },
    {
      id: "focus2h",
      label: "连续专注超过 2 小时",
      done: focusMs >= 2 * 3_600_000
    }
  ];
}

export function formatHourRange(start: number, end: number) {
  return `${String(start).padStart(2, "0")}:00–${String(end + 1).padStart(2, "0")}:00`;
}
