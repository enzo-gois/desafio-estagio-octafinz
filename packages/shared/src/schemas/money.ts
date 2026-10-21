import { z } from 'zod';

// Money is always integer cents. `.int()` also rejects values outside the safe integer range.
export const centsSchema = z
  .number({ error: 'Valor inválido' })
  .int({ error: 'Valor deve ser inteiro em centavos' })
  .positive({ error: 'Valor deve ser maior que zero' });
