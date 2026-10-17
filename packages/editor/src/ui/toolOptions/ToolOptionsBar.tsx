import { Fragment, useSyncExternalStore } from "react";

import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { registerBrushCommands } from "./brushCommands";
import { registerBuiltinToolOptions } from "./builtins";
import { OptionDivider } from "./parts";
import { subscribeToolOptions, toolOptionsFor, toolOptionsVersion } from "./registry";

registerBuiltinToolOptions();
registerBrushCommands();

/**
 * The active tool's options (from the tool options registry), inline in
 * the options bar above the canvas, left to right. Nothing on the world map.
 */
export function ToolOptions() {
  const world = useWorldView((s) => s.view === "world");
  const tool = useEditorStore((s) => s.tool);
  const store = useEditorStore((s) => s.project?.store);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useStructureVersion(store);
  useSyncExternalStore(subscribeToolOptions, toolOptionsVersion);
  if (world) return null;
  const doc = store?.document;
  const layer = activeLayerId ? doc?.getLayer(activeLayerId) : undefined;
  const entries = toolOptionsFor({ tool, doc, layer });
  return (
    <div role="group" aria-label={t("toolOptions.bar")} data-tool-chip={tool} className="flex min-w-0 items-center gap-2 whitespace-nowrap">
      {entries.map(({ id, Component }, i) => (
        <Fragment key={id}>
          {i > 0 && <OptionDivider />}
          <Component />
        </Fragment>
      ))}
    </div>
  );
}
