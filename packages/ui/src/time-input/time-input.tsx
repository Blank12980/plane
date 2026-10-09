/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Input } from "../form-fields";

export type TimeInputProps = {
  value: string | null;
  onCommit: (value: string | null) => Promise<void>;
  onError: (error: unknown) => void;
  label: string;
  clearLabel: string;
  disabled?: boolean;
};

/** A time control that commits on blur or Enter and keeps failed edits visible. */
export function TimeInput({ value, onCommit, onError, label, clearLabel, disabled = false }: TimeInputProps) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const committing = useRef(false);

  useEffect(() => setDraft(value ?? ""), [value]);

  const commit = async (next: string) => {
    if (disabled || committing.current || next === (value ?? "")) return;
    if (next && !/^([01]\d|2[0-3]):[0-5]\d$/.test(next)) return;
    committing.current = true;
    setSaving(true);
    try {
      await onCommit(next || null);
      setDraft(next);
    } catch (error) {
      onError(error);
    } finally {
      committing.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        type="time"
        step={60}
        value={draft}
        aria-label={label}
        disabled={disabled || saving}
        inputSize="xs"
        mode="transparent"
        className="min-w-0 grow"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            inputRef.current?.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value ?? "");
          }
        }}
      />
      {value && (
        <button
          type="button"
          aria-label={clearLabel}
          disabled={disabled || saving}
          className="rounded-sm p-1 text-secondary disabled:opacity-50"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void commit("")}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
