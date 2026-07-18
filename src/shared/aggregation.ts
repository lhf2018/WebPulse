import { clamp, endOfDay, parseDateKey, startOfDay, toDateKey } from "./time";

export function splitRangeByDay(startMs: number, endMs: number) {
  const parts: Array<{ dateKey: string; start: number; end: number }> = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const dateKey = toDateKey(new Date(cursor));
    const dayEnd = endOfDay(dateKey);
    const partEnd = Math.min(endMs, dayEnd);
    parts.push({ dateKey, start: cursor, end: partEnd });
    cursor = partEnd;
  }
  return parts;
}

export function addSegmentToBuckets(
  buckets: number[],
  dateKey: string,
  startMs: number,
  endMs: number,
  bucketMinutes: number
) {
  const dayStart = startOfDay(dateKey);
  const bucketMs = bucketMinutes * 60_000;
  let cursor = clamp(startMs - dayStart, 0, 24 * 60 * 60_000);
  const limit = clamp(endMs - dayStart, 0, 24 * 60 * 60_000);
  while (cursor < limit) {
    const index = Math.floor(cursor / bucketMs);
    const bucketStart = index * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const add = Math.min(limit, bucketEnd) - cursor;
    buckets[index] = (buckets[index] ?? 0) + add;
    cursor += add;
  }
}

export function ensureBucketArray(length: number, source?: number[]) {
  const buckets = Array.from({ length }, (_, index) => source?.[index] ?? 0);
  return buckets;
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function dateSeries(startDateKey: string, endDateKey: string) {
  const values: string[] = [];
  let cursor = startDateKey;
  while (cursor <= endDateKey) {
    values.push(cursor);
    const date = parseDateKey(cursor);
    date.setDate(date.getDate() + 1);
    cursor = toDateKey(date);
  }
  return values;
}
