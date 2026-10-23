import { describe, expect, it } from 'vitest';
import { remask, remaskMoney } from './caret';
import { maskCnpjInput, maskCpfInput } from './masks';

// "|" marks the caret: splits "529|982" into the text and the caret index.
function at(text: string): [string, number] {
  const caret = text.indexOf('|');
  return [text.replace('|', ''), caret];
}
const show = ({ value, caret }: { value: string; caret: number }) =>
  `${value.slice(0, caret)}|${value.slice(caret)}`;

describe('remask (CPF, CNPJ)', () => {
  it.each([
    ['typing at the end, across a separator', '5299|', '529.9|'],
    ['typing in the middle', '521|9.982', '521|.998.2'],
    ['deleting the separator before the caret', '529|982', '529|.982'],
    ['deleting a digit in the middle', '52|.982', '52|9.82'],
    ['pasting a whole CPF', '529.982.247-25|', '529.982.247-25|'],
  ])('CPF: %s', (_, typed, expected) => {
    expect(show(remask(maskCpfInput, ...at(typed)))).toBe(expected);
  });

  it.each([
    ['a lowercase letter at the end', '12.ab|', '12.AB|'],
    ['a dropped symbol keeps the caret put', '12.ABC@|', '12.ABC|'],
    ['a letter where only digits fit', '12.ABC.345/01DE-X|', '12.ABC.345/01DE|'],
  ])('CNPJ: %s', (_, typed, expected) => {
    expect(show(remask(maskCnpjInput, ...at(typed)))).toBe(expected);
  });
});

describe('remaskMoney', () => {
  it.each([
    ['the first digit', '5|', 'R$ 0,05|'],
    ['a digit at the end', 'R$ 1.234,567|', 'R$ 12.345,67|'],
    ['a digit in the middle', 'R$ 19|.234,56', 'R$ 19|.234,56'],
    ['a backspace at the end', 'R$ 1.234,5|', 'R$ 123,45|'],
  ])('keeps the caret after %s', (_, typed, expected) => {
    expect(show(remaskMoney(...at(typed)))).toBe(expected);
  });

  it('returns the cents with the text', () => {
    expect(remaskMoney(...at('R$ 1.234,567|'))).toMatchObject({ cents: 1_234_567 });
  });

  it('empties the field when no digit is left', () => {
    expect(remaskMoney(...at('R$ |'))).toEqual({ cents: undefined, value: '', caret: 0 });
  });
});
