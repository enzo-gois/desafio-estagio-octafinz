import { z } from 'zod';

// Banks send the monthly rate as a fraction (Alfa) or as a percent (Beta, Gama); the domain
// always receives a fraction. A rate at or above 100% a.m. is treated as a unit mix-up
// (a percent sent where a fraction was expected), not as a real rate.

export const fractionRateSchema = z.number().positive().lt(1);

export const percentRateSchema = z
  .number()
  .positive()
  .lt(100)
  .transform((percent) => percent / 100);
