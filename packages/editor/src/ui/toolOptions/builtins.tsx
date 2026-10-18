import { activeSmartStamp, useSmartStampSession } from "../stamps/smartStampSession";
import { SmartStampOptions } from "./SmartStampOptions";

import { isEntityLayer, isTileLayer } from "@smap/core";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import type { CommandId } from "../../shortcuts/shortcuts";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { t, type MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { BrushSizeChip } from "../inspector/BrushSizeChip";
import { registerToolOptions } from "./registry";
import { SelectionModeOptions, LayerPickOptions } from "./SelectionPickOptions";
import { SelectionScopeOptions } from "./SelectionScopeOptions";
import { RectangleOptions } from "./RectangleOptions";
import { RandomToggle } from "./RandomToggle";

/** Options bar: size only (the FIRÇA card shows the shape once the size is above 1). */
function OptionsBrushSize() {
  const usage = useSmartStampSession(s => s.usage);
  return <BrushSizeChip withShape={!!activeSmartStamp() && usage === "road"} />;
}

const TRANSFORMS: readonly { command: CommandId; icon: IconName; title: MessageKey }[] = [
  { command: "edit.flipX", icon: "flip-horizontal-2", title: "commands.edit.flipX" },
  { command: "edit.flipY", icon: "flip-vertical-2", title: "commands.edit.flipY" },
  { command: "edit.rotateCCW", icon: "rotate-ccw", title: "inspector.rotateCCW" },
  { command: "edit.rotateCW", icon: "rotate-cw", title: "inspector.rotateCW" },
];

/** Existing brush/stamp transform commands, sharing their enabled state. */
function BrushTransforms() {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  // Command predicates also depend on brush content and selection.
  useEditorStore((s) => s.selection);
  useEditorStore((s) => s.stamp);
  useEditorStore((s) => s.region);
  useEditorStore((s) => s.randomSet);
  useEditorStore((s) => s.activeLayerId);
  return <div className="flex items-center gap-1" data-tool-option="transforms">{TRANSFORMS.map(({ command, icon, title }) => {
    const cmd = getCommand(command);
    return <Tooltip key={command} label={t(cmd?.title ?? title)} command={command}><IconButton size="md" aria-label={t(cmd?.title ?? title)} disabled={!cmd || !isEnabled(cmd)} data-command={command} onClick={() => runCommand(command)}><Icon name={icon} size={16} /></IconButton></Tooltip>;
  })}</div>;
}

let registered = false;

/** Registers the built-in entries (idempotent). */
export function registerBuiltinToolOptions(): void {
  if (registered) return;
  registered = true;
  registerToolOptions(["brush", "eraser", "rect", "fill"], SmartStampOptions, { id: "smartStamp.usage", order: 15, when: () => !!activeSmartStamp() });
  registerToolOptions("select", SelectionScopeOptions, { id: "selection.scope", order: 10 });
  registerToolOptions(["rect"], RectangleOptions, { id: "builtin.rectangle", order: 5, when: (c) => !isEntityLayer(c.layer) && (!activeSmartStamp() || useSmartStampSession.getState().usage === "road") });
  registerToolOptions(["brush", "eraser"], OptionsBrushSize, { id: "builtin.brushSize", order: 10, when: (c) => !isEntityLayer(c.layer) });
  registerToolOptions(["brush", "fill", "rect"], RandomToggle, { id: "builtin.random", order: 20, when: (c) => isTileLayer(c.layer) && !activeSmartStamp() });
  registerToolOptions(["brush", "fill", "rect"], BrushTransforms, { id: "builtin.transforms", order: 40, when: (c) => c.brush !== "none" });
  registerToolOptions("select", SelectionModeOptions, { id: "selection.mode", order: 5 });
  registerToolOptions("eyedropper", LayerPickOptions, { id: "pick.scope", order: 5 });
}
