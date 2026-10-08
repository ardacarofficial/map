import { describe, expect, it, vi } from "vitest";

import type { CommandId } from "../../shortcuts/shortcuts";
import { resolveContextItems, SEPARATOR, type ContextEntry, type ContextLookup } from "./contextItems";

function lookup(enabled: Partial<Record<CommandId, boolean>>, keys: Partial<Record<CommandId, string>> = {}) {
  const ran: CommandId[] = [];
  const l: ContextLookup = {
    command: (id) => (id in enabled ? { title: `title:${id}`, enabled: enabled[id]! } : undefined),
    shortcut: (id) => keys[id] ?? null,
    run: (id) => void ran.push(id),
  };
  return { l, ran };
}

describe("resolveContextItems", () => {
  it("takes a command item's title, shortcut and enabled state from the registry", () => {
    const { l, ran } = lookup({ "layer.duplicate": true, "layer.mergeDown": false }, { "layer.duplicate": "Ctrl+J" });
    const items = resolveContextItems(
      [
        { type: "item", id: "dup", command: "layer.duplicate" },
        { type: "item", id: "merge", label: "Aşağıyla birleştir", command: "layer.mergeDown" },
      ],
      l,
    );
    expect(items).toMatchObject([
      { id: "dup", label: "title:layer.duplicate", shortcut: "Ctrl+J", enabled: true },
      { id: "merge", label: "Aşağıyla birleştir", shortcut: null, enabled: false },
    ]);
    const dup = items[0]!;
    if (dup.type === "item") dup.run();
    expect(ran).toEqual(["layer.duplicate"]);
  });

  it("lets an item's own action and disabled flag win over the command", () => {
    const run = vi.fn();
    const { l, ran } = lookup({ "layer.add": false });
    const [own, forced] = resolveContextItems(
      [
        { type: "item", id: "new", label: "Yeni", command: "layer.add", run },
        { type: "item", id: "del", label: "Sil", run, disabled: true, danger: true },
      ],
      l,
    );
    // An own action is enabled even when the command (shown for its shortcut) is not.
    expect(own).toMatchObject({ enabled: true });
    expect(forced).toMatchObject({ enabled: false, danger: true });
    if (own?.type === "item") own.run();
    expect(run).toHaveBeenCalledOnce();
    expect(ran).toEqual([]);
  });

  it("drops unregistered command items and tidies separators", () => {
    const { l } = lookup({ "edit.copy": true });
    const entries: ContextEntry[] = [
      SEPARATOR,
      { type: "item", id: "cut", command: "edit.cut" },
      SEPARATOR,
      SEPARATOR,
      { type: "item", id: "copy", command: "edit.copy" },
      SEPARATOR,
      { type: "item", id: "paste", command: "edit.paste" },
      SEPARATOR,
    ];
    expect(resolveContextItems(entries, l).map((e) => (e.type === "item" ? e.id : "-"))).toEqual(["copy"]);
  });

  it("keeps check states for toggle items", () => {
    const { l } = lookup({});
    const [on, off, plain] = resolveContextItems(
      [
        { type: "item", id: "a", label: "A", run: () => undefined, checked: true },
        { type: "item", id: "b", label: "B", run: () => undefined, checked: false },
        { type: "item", id: "c", label: "C", run: () => undefined },
      ],
      l,
    );
    expect(on).toMatchObject({ checked: true });
    expect(off).toMatchObject({ checked: false });
    expect(plain).toMatchObject({ checked: undefined });
  });
});
