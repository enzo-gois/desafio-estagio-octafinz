import { z } from 'zod';
import { isValidCnpj, normalizeCnpj } from '../documents/cnpj';
import { isValidCpf, normalizeCpf } from '../documents/cpf';

// Accepts masked or unmasked input; the parsed value is always the normalized document.
export const cpfSchema = z
  .string()
  .refine(isValidCpf, { error: 'CPF inválido' })
  .transform(normalizeCpf);

export const cnpjSchema = z
  .string()
  .refine(isValidCnpj, { error: 'CNPJ inválido' })
  .transform(normalizeCnpj);
