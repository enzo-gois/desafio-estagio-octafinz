export type JsonParseResult = { ok: true; value: unknown } | { ok: false };

/** JSON.parse that reports failure instead of throwing (a bank may send a truncated body). */
export function parseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
