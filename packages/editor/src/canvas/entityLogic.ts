/**
 * Pure entity logic of the canvas: hit-testing, cell snapping, drag targets,
 * label text and visibility, colours. No Pixi, no DOM: unit tested.
 *
 * Entity positions are integer map pixels (top-left corner, y down); the
 * editor keeps them on cell corners (`x = cellX * tileWidth`).
 */
import {
  PORTAL_TYPE_ID,
  SPAWN_TYPE_ID,
  entitySize,
  portalLabel,
  portalStatus,
  type CellPoint,
  type Entity,
  type EntityType,
  type MapInfo,
  type PortalStatus,
  type ProjectData,
} from "@smap/core";

/** A point in map pixels. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Entity box in map pixels. */
export interface EntityBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function entityBox(entity: Entity, map: MapInfo): EntityBox {
  const s = entitySize(entity, map);
  return { x: entity.x, y: entity.y, width: s.width, height: s.height };
}

/**
 * Top-most entity (last in list order = drawn last) whose box contains `p`.
 * `slop` (map px) grows every box on each side, so tiny entities stay
 * clickable when zoomed out.
 */
export function hitTestEntities(entities: readonly Entity[], map: MapInfo, p: WorldPoint, slop = 0): Entity | null {
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i]!;
    const b = entityBox(e, map);
    if (p.x >= b.x - slop && p.y >= b.y - slop && p.x < b.x + b.width + slop && p.y < b.y + b.height + slop) return e;
  }
  return null;
}

/** Hit slop in map px for a given zoom (CSS px per map px): about 3 CSS px. */
export function hitSlop(zoom: number): number {
  return zoom > 0 ? 3 / zoom : 0;
}

/** Pixel position of an entity placed at `cell`, clamped into the map. */
export function snapToCell(cell: CellPoint, map: MapInfo): WorldPoint {
  const cx = Math.min(map.width - 1, Math.max(0, cell.x));
  const cy = Math.min(map.height - 1, Math.max(0, cell.y));
  return { x: cx * map.tileWidth, y: cy * map.tileHeight };
}

/**
 * Where a dragged entity goes: the entity's start cell moved by the cells the
 * pointer moved since `grab`, snapped to a cell corner and kept in the map.
 * Returns `start` unchanged while the pointer is still in its grab cell (an
 * off-grid entity is not snapped by a plain click).
 */
export function dragPosition(start: WorldPoint, grab: CellPoint, pointer: CellPoint, map: MapInfo): WorldPoint {
  const dx = pointer.x - grab.x;
  const dy = pointer.y - grab.y;
  if (dx === 0 && dy === 0) return start;
  return snapToCell(
    { x: Math.floor(start.x / map.tileWidth) + dx, y: Math.floor(start.y / map.tileHeight) + dy },
    map,
  );
}

/** Labels are drawn only when a cell is at least this many CSS px wide... */
export const LABEL_MIN_CELL_CSS_PX = 14;
/** ...and at most this many entities are on screen. */
export const LABEL_MAX_ON_SCREEN = 400;

/** True when entity labels should be drawn. */
export function labelsVisible(cellCssPx: number, onScreen: number): boolean {
  return cellCssPx >= LABEL_MIN_CELL_CSS_PX && onScreen <= LABEL_MAX_ON_SCREEN;
}

/** Display name of a type (the UI translates the built-in ones). */
export type TypeName = (type: EntityType) => string;

/** Text drawn next to an entity: portals show their target ("→ Zindan"), others their type name. */
export function entityLabel(entity: Entity, type: EntityType | undefined, project: ProjectData, nameOf: TypeName = (t) => t.name): string {
  if (entity.typeId === PORTAL_TYPE_ID) return portalLabel(project, entity);
  return (type && nameOf(type)) || entity.typeId;
}

/** `#rrggbb` → number, or `fallback`. */
export function parseHexColor(value: string | undefined, fallback: number): number {
  const m = value ? /^#([0-9a-f]{6})$/i.exec(value.trim()) : null;
  return m ? parseInt(m[1]!, 16) : fallback;
}

/** Colours the entity renderer uses (theme tokens with fallbacks). */
export interface EntityColors {
  readonly spawn: number;
  readonly portal: number;
  /** Missing type / missing portal target. */
  readonly danger: number;
  /** Fallback for a custom type without a usable colour. */
  readonly unknown: number;
}

/** How an entity is drawn. */
export type EntityShape = "spawn" | "portal" | "box";

export interface EntityLook {
  readonly color: number;
  readonly shape: EntityShape;
  /** Dashed red outline (portal whose target level was removed, or unknown type). */
  readonly broken: boolean;
  readonly label: string;
  readonly status: PortalStatus;
}

/** Resolves colour, shape, label and link status of an entity. */
export function entityLook(
  entity: Entity,
  type: EntityType | undefined,
  project: ProjectData,
  colors: EntityColors,
  nameOf?: TypeName,
): EntityLook {
  const status = portalStatus(project, entity);
  const label = entityLabel(entity, type, project, nameOf);
  if (entity.typeId === SPAWN_TYPE_ID) return { color: colors.spawn, shape: "spawn", broken: false, label, status };
  if (entity.typeId === PORTAL_TYPE_ID) {
    const broken = status === "missingLevel";
    return { color: broken ? colors.danger : colors.portal, shape: "portal", broken, label, status };
  }
  if (!type) return { color: colors.danger, shape: "box", broken: true, label, status };
  return { color: parseHexColor(type.color, colors.unknown), shape: "box", broken: false, label, status };
}
