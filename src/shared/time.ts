export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(dateKey: string, offset: number) {
  const base = parseDateKey(dateKey);
  base.setDate(base.getDate() + offset);
  return toDateKey(base);
}

export function rangeDateKeys(range: "week" | "month" | "all", now = new Date()) {
  const end = toDateKey(now);
  if (range === "week") {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    return { start: toDateKey(startDate), end };
  }
  if (range === "all") {
    return { start: "1970-01-01", end };
  }
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: toDateKey(startDate), end };
}

export function startOfDay(dateKey: string) {
  const date = parseDateKey(dateKey);
  return date.getTime();
}

export function endOfDay(dateKey: string) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function formatDuration(ms: number) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours >= 1) return `${hours}小时 ${pad2(minutes)}分`;
  if (minutes >= 10) return `${minutes}分`;
  if (minutes >= 1) return `${minutes}分${pad2(seconds)}秒`;
  return `${seconds}秒`;
}

export function formatClockDuration(ms: number) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

export function formatCompactDuration(ms: number) {
  const safe = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${pad2(minutes)}m`;
}

export function formatHourMinute(value?: number) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
