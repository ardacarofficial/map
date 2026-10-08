import { useEffect, useRef, useState, type ReactNode } from "react";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { formatNumber, t } from "../../i18n";
import type { CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore, type CellRegion } from "../../state/editorStore";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { useStructureVersion } from "../hooks";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { fillBlocker } from "./fillCheck";
import { placeSelectionBar, type BarPlacement } from "./placement";
import { registerSelectionBarCommands, useSelectionBarPrefs } from "./selectionBarStore";

registerSelectionBarCommands();

function samePlacement(a: BarPlacement | null, b: BarPlacement): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.side === b.side;
}

/**
 * Small floating bar next to a map selection (select tool): Doldur, Sil,
 * Kopyala, Kes, Stamp olarak kaydet, Seçimi kaldır — each runs the existing
 * command (or the canvas' region fill). It sits below the selection, flips
 * above near the bottom edge, and follows pan / zoom. Esc clears the
 * selection and with it the bar; View → "Seçim çubuğu" hides it for good.
 * Mount inside the (relative) canvas container.
 */
export function SelectionBar() {
  const region = useEditorStore((s) => s.region);
  const tool = useEditorStore((s) => s.tool);
  const enabled = useSelectionBarPrefs((s) => s.enabled);
  const world = useWorldView((s) => s.view === "world");
  if (!region || tool !== "select" || !enabled || world) return null;
  return <Bar region={region} />;
}

function Bar({ region }: { region: CellRegion }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<BarPlacement | null>(null);
  const placementRef = useRef<BarPlacement | null>(null);
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  // Re-render when the brush / layer changes (fill and command enablement).
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const gridValue = useEditorStore((s) => s.gridValue);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const blocker = fillBlocker(store?.document, { activeLayerId, gridValue, stamp, selection, randomSet });

  // Follow the camera: there is no pan / zoom event, so re-place every frame (cheap; state only changes on movement).
  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = requestAnimationFrame(place);
      const el = ref.current;
      const view = el?.parentElement;
      if (!el || !view) return;
      const sel = getCanvasHandle()?.cellRectToScreen(region) ?? null;
      const next = placeSelectionBar(
        sel,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: view.clientWidth, height: view.clientHeight },
      );
      if (samePlacement(placementRef.current, next)) return;
      placementRef.current = next;
      setPlacement(next);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [region]);

  const fill = () => {
    if (blocker) return;
    getCanvasHandle()?.fillRegion(region);
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("selectionBar.label")}
      data-selection-bar={placement?.side ?? "measuring"}
      // Keep keyboard focus on the canvas (Esc, Ctrl+C keep working after a click).
      onPointerDown={(e) => e.preventDefault()}
      style={{ transform: placement ? `translate(${placement.x}px, ${placement.y}px)` : undefined }}
      className={`absolute top-0 left-0 z-20 flex items-center gap-0.5 rounded-lg border border-line bg-raised/95 p-1 text-sm shadow-popup backdrop-blur-sm transition-opacity duration-100 ${
        placement ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className="px-1.5 font-mono text-2xs text-faint tabular" aria-label={t("selectionBar.size", { width: region.width, height: region.height })}>
        {formatNumber(region.width)}×{formatNumber(region.height)}
      </span>
      <Divider />
      <BarButton icon="fill" label={t("selectionBar.fill")} onClick={fill} disabledReason={blocker ? t(blocker) : null} primary />
      <CommandButton command="edit.delete" icon="trash" label={t("selectionBar.erase")} />
      <Divider />
      <CommandButton command="edit.copy" icon="copy" label={t("selectionBar.copy")} />
      <CommandButton command="edit.cut" glyph={<ScissorsGlyph />} label={t("selectionBar.cut")} />
      <CommandButton command="stamp.saveSelection" icon="stamp" label={t("selectionBar.saveStamp")} />
      <Divider />
      <CommandButton command="edit.deselect" icon="x" label={t("selectionBar.deselect")} iconOnly />
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />;
}

function CommandButton({
  command,
  icon,
  glyph,
  label,
  iconOnly = false,
}: {
  command: CommandId;
  icon?: IconName;
  glyph?: ReactNode;
  label: string;
  iconOnly?: boolean;
}) {
  const cmd = getCommand(command);
  const enabled = !!cmd && isEnabled(cmd);
  return (
    <BarButton
      icon={icon}
      glyph={glyph}
      label={label}
      command={command}
      iconOnly={iconOnly}
      disabledReason={enabled ? null : label}
      onClick={() => runCommand(command)}
    />
  );
}

function BarButton({
  icon,
  glyph,
  label,
  command,
  onClick,
  disabledReason,
  primary = false,
  iconOnly = false,
}: {
  icon?: IconName | undefined;
  glyph?: ReactNode;
  label: string;
  command?: CommandId | undefined;
  onClick(): void;
  /** Non-null: the button is disabled and the tooltip says why. */
  disabledReason: string | null;
  primary?: boolean;
  iconOnly?: boolean;
}) {
  const disabled = disabledReason !== null;
  return (
    <Tooltip label={disabled && disabledReason !== label ? disabledReason : label} {...(command ? { command } : {})} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-action={command ?? "fill"}
        onClick={() => {
          if (!disabled) onClick();
        }}
        className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md text-sm transition-colors duration-100 ${iconOnly ? "w-7 justify-center" : "px-2"} ${
          disabled
            ? "cursor-default text-faint opacity-50"
            : primary
              ? "text-accent hover:bg-accent-soft"
              : "text-muted hover:bg-hover hover:text-text"
        }`}
      >
        {icon ? <Icon name={icon} size={14} className="shrink-0" /> : glyph}
        {!iconOnly && <span className="whitespace-nowrap">{label}</span>}
      </button>
    </Tooltip>
  );
}

/** Scissors (Kes) — not in the shared icon set yet. */
function ScissorsGlyph() {
  return (
    <svg aria-hidden width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  );
}
