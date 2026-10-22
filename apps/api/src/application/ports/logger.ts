// Structural subset of pino's logger, so callers depend on this port and not on pino itself.
// Never pass customer data (CPF, name, salary, request/response bodies) in `bindings`.
export interface Logger {
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
  child(bindings: object): Logger;
}
