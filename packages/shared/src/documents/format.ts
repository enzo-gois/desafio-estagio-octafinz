// Only these mask characters are stripped. Anything else (e.g. "@") is kept so that
// the document fails validation instead of being silently "fixed".
const MASK_CHARACTERS = /[./\- ]/g;

export function stripDocumentMask(value: string): string {
  return value.replace(MASK_CHARACTERS, '');
}

// Sequences like "11111111111" pass the modulo 11 math, so they are rejected explicitly.
export function isRepeatedSequence(value: string): boolean {
  return /^(.)\1*$/.test(value);
}
