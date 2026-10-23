import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import type { FormValues } from '../form/form-values';

interface DraftContextValue {
  /** What the form had when the last simulation was sent; undefined before the first one. */
  draft: FormValues | undefined;
  saveDraft(values: FormValues): void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

/**
 * Keeps the last form in memory so "Simular novamente" comes back filled in. Only in memory, never
 * in localStorage or sessionStorage: it holds CPF, birth date and salary, and must not outlive
 * the tab. A reload therefore brings back an empty form.
 */
export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<FormValues>();
  const value = useMemo<DraftContextValue>(
    () => ({
      draft,
      // Each simulation is a new consultation of the banks and records a new consent.
      saveDraft: (values) => setDraft({ ...values, consent: false }),
    }),
    [draft],
  );
  return <DraftContext value={value}>{children}</DraftContext>;
}

export function useDraft(): DraftContextValue {
  const context = useContext(DraftContext);
  if (!context) throw new Error('useDraft must be used inside <DraftProvider>');
  return context;
}
