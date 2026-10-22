// One granularity for absorbing floating-point noise across the domain: values are
// compared/rounded in millionths (1e-6) of their unit (cent for money, fraction for rates).
export const MICRO_UNITS = 1_000_000;

export function toMicroUnits(value: number): number {
  return Math.round(value * MICRO_UNITS);
}
