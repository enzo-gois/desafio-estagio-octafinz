const DELTA_SECONDS = /^\d+$/;
// IMF-fixdate, e.g. "Thu, 22 Oct 2026 12:00:02 GMT". Date.parse alone is too lenient: it
// reads "1.5" as a date in 2001, which would silently turn into "retry now".
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Retry-After (delta-seconds or HTTP-date) in milliseconds; undefined when absent or invalid. */
export function parseRetryAfterMs(value: string | null, nowMs: number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();

  if (DELTA_SECONDS.test(trimmed)) return Number(trimmed) * 1000;
  if (!HTTP_DATE.test(trimmed)) return undefined;

  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}
