import { useEffect, useState } from "react";

import { AiTagsEditor } from "../agent/AiTagsEditor";
import { AiBar } from "../agent/AiBar";
import { useAiCommands } from "../agent/commands";
import { t } from "../../i18n";
import { CanvasHost } from "../canvas/CanvasHost";
import { PointPickOverlay } from "../levels/PointPickOverlay";
import { StampCloseDialog, StampEditorBanner } from "../stampEditor/StampEditorChrome";
import { CanvasFeedback } from "../feedback/CanvasFeedback";
import { BlockedActionFeedback } from "../feedback/BlockedActionFeedback";
import { CanvasContextMenu } from "../contextMenus/CanvasContextMenu";
import { useUiStore } from "../uiStore";
import { AppBar } from "./AppBar";
import { fitColumns } from "./columns";
import { COLLAPSED_PX } from "./dockModel";
import { useDockStore } from "./dockStore";
import { DockZone } from "./DockZone";
import { DockDropIndicator } from "./DockTabDrag";
import { PanelHosts } from "./panels";
import { ToolRail } from "./ToolRail";
import { useRulersSync } from "./rulers";
import { StatusBar } from "./StatusBar";
import { OptionsBar } from "./OptionsBar";

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** Resizable side columns surround the canvas options, canvas and dock. */
export function EditorLayout() {
  useAiCommands();
  const hidden = useUiStore((s) => s.panelsHidden);
  const viewport = useViewportWidth();
  const zones = useDockStore(s => s.layout.zones);
  useRulersSync();
  const expanded = (zone: "left" | "right") => !hidden && zones[zone].state === "expanded" && zones[zone].groups.length > 0;
  const widths = fitColumns(viewport, { library: zones.left.expandedPx, right: zones.right.expandedPx }, { library: expanded("left"), right: expanded("right") });
  const sideSize = (zone: "left" | "right") => zones[zone].state === "collapsed" ? COLLAPSED_PX : zone === "left" ? widths.library : widths.right;
  const bottomSize = zones.bottom.state === "collapsed" ? COLLAPSED_PX : zones.bottom.expandedPx;

  return (
    <div className="flex h-full flex-col">
      <AppBar />
      <div className="flex min-h-0 flex-1">
        <div className={hidden ? "hidden" : "contents"}><ToolRail /></div>
        <DockZone zone="left" size={sideSize("left")} temporaryHidden={hidden} />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <OptionsBar />
          <AiBar />
          <StampEditorBanner />
          <main aria-label={t("layout.canvas")} className="dock-canvas relative min-h-0 min-w-0 flex-1 bg-canvas">
            <CanvasHost />
            <CanvasFeedback />
            <PointPickOverlay />
            <CanvasContextMenu />
            <BlockedActionFeedback />
          </main>
          <DockZone zone="bottom" size={bottomSize} temporaryHidden={hidden} />
        </div>
        <DockZone zone="right" size={sideSize("right")} temporaryHidden={hidden} />
      </div>
      <PanelHosts />
      <AiTagsEditor />
      <DockDropIndicator />
      <StampCloseDialog />
      <StatusBar />
    </div>
  );
}
