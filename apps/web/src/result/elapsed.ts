/**
 * Whole seconds since `createdAt` on the server's clock: the client's clock plus the offset
 * measured on the last answer (see useSimulationPolling). The client's clock alone may be
 * minutes off, which would show a negative or inflated time.
 */
export function elapsedSeconds(
  createdAt: string,
  clockOffsetMs: number,
  clientNowMs: number,
): number {
  const elapsedMs = clientNowMs + clockOffsetMs - Date.parse(createdAt);
  return Math.max(0, Math.floor(elapsedMs / 1000));
}
