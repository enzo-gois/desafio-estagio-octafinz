import { z } from 'zod';

const DECIMAL_MONEY = /^\d{1,10}\.\d{2}$/;
// After JSON.parse there is no "two decimal places" string left to inspect, only a double:
// 329.34 × 100 is 32934.000000000004. Anything closer than this to a whole cent is that cent.
const CENT_TOLERANCE = 1e-6;

/** "8182.55" -> 818255, splitting the string at the dot: no float math on money. */
export function decimalStringToCents(value: string): number | undefined {
  if (!DECIMAL_MONEY.test(value)) return undefined;
  const [reais = '', cents = ''] = value.split('.');
  return Number(reais) * 100 + Number(cents);
}

/** 500000 -> "5000.00" */
export function centsToDecimalString(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** 500000 -> 5000. Exact for any safe integer number of cents once parsed back with reaisToCents. */
export function centsToReais(cents: number): number {
  return cents / 100;
}

/** 329.34 -> 32934; undefined when the value has more than two decimal places. */
export function reaisToCents(value: number): number | undefined {
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > CENT_TOLERANCE) return undefined;
  return cents;
}

/** Zod: "8182.55" (string) -> 818255 cents, strictly positive. */
export const decimalStringCentsSchema = z.string().transform((value, ctx) => {
  const cents = decimalStringToCents(value);
  if (cents === undefined || cents <= 0) {
    ctx.addIssue({ code: 'custom', message: 'expected a positive amount formatted as "0.00"' });
    return z.NEVER;
  }
  return cents;
});

/** Zod: 329.34 (number in reais) -> 32934 cents, strictly positive, at most 2 decimals. */
export const reaisCentsSchema = z.number().transform((value, ctx) => {
  const cents = reaisToCents(value);
  if (cents === undefined || cents <= 0) {
    ctx.addIssue({ code: 'custom', message: 'expected a positive amount with at most 2 decimals' });
    return z.NEVER;
  }
  return cents;
});

/** Zod: integer cents, strictly positive. */
export const centsSchema = z.number().int().positive();
