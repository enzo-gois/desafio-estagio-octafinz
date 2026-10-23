import { type InputHTMLAttributes, useRef } from 'react';
import type { MaskedEdit } from '../lib/caret';

interface MaskedInputProps<E extends MaskedEdit> extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
> {
  value: string;
  /** Raw text and caret as the browser has them -> masked text and where the caret goes. */
  remask: (raw: string, caret: number) => E;
  onEdit: (edit: E) => void;
}

/** A controlled input that re-masks every change and keeps the caret where the customer was. */
export function MaskedInput<E extends MaskedEdit>({
  value,
  remask,
  onEdit,
  ...props
}: MaskedInputProps<E>) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <input
      {...props}
      ref={input}
      value={value}
      onChange={(event) => {
        const { value: raw, selectionStart } = event.target;
        const edit = remask(raw, selectionStart ?? raw.length);
        onEdit(edit);
        // After React has written the value: also when nothing changed (a dropped character),
        // where React puts the old value back and the browser sends the caret to the end.
        queueMicrotask(() => {
          if (input.current === document.activeElement) {
            input.current?.setSelectionRange(edit.caret, edit.caret);
          }
        });
      }}
    />
  );
}
