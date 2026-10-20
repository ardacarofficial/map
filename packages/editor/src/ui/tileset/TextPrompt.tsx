/**
 * A small "name it" dialog (new group, rename): `askText()` resolves with
 * the trimmed text, or `null` when cancelled.
 */
import { Dialog } from "../primitives/Overlays";
import { useState, type FormEvent } from "react";
import { create } from "zustand";

import { t } from "../../i18n";
import { backdropClass, popupClass } from "../dialogs/styles";
import { TextField } from "../primitives/TextField";
import { Button } from "../primitives/Button";
import { registerTilesetModal } from "../tilesetImport/importStore";
import { selectAll } from "../primitives/selectAll";

export interface TextPromptRequest {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly confirm: string;
}

interface PromptState {
  request: TextPromptRequest | null;
  resolve: ((text: string | null) => void) | null;
}

const usePrompt = create<PromptState>()(() => ({ request: null, resolve: null }));

function finish(text: string | null): void {
  const { resolve } = usePrompt.getState();
  usePrompt.setState({ request: null, resolve: null });
  resolve?.(text);
}

export function askText(request: TextPromptRequest): Promise<string | null> {
  finish(null);
  return new Promise((resolve) => usePrompt.setState({ request, resolve }));
}

registerTilesetModal(() => usePrompt.getState().request !== null);

export function TextPromptDialog() {
  const request = usePrompt((s) => s.request);
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && finish(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} w-100 max-w-[calc(100vw-32px)] p-4`} data-dialog="text-prompt">
          {request && <PromptForm request={request} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PromptForm({ request }: { request: TextPromptRequest }) {
  const [value, setValue] = useState(request.initial);
  const ok = value.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ok) finish(value.trim());
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Dialog.Title className="text-lg font-semibold">{request.title}</Dialog.Title>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-muted">
        {request.label}
        <TextField size="md"
          autoFocus
          value={value}
          maxLength={64}
          spellCheck={false}
          autoComplete="off"
          {...selectAll}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!ok}
          className="w-full"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => finish(null)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={!ok}>
          {request.confirm}
        </Button>
      </div>
    </form>
  );
}
