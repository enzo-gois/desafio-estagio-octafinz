// Programmer-error guards. Input is validated by Zod at the edge; reaching these with bad
// values means a bug in the caller, so they throw instead of returning a user message.

export function assertCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer amount of cents (got ${value})`);
  }
}

export function assertInstallments(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`installments must be a positive integer (got ${value})`);
  }
}

export function assertRate(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative decimal fraction (got ${value})`);
  }
}
