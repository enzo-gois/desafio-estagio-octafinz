/**
 * What GET /health checks: the API's own dependencies. The banks are deliberately not one of
 * them: without a bank the API still answers (its card shows UNAVAILABLE), so it stays healthy.
 */
export interface HealthCheck {
  /** Rejects when the database cannot run a trivial query. */
  checkDatabase(): Promise<void>;
}
