/**
 * Entities of the visible entity layers, drawn in screen space over the
 * tiles (crisp device-pixel outlines at every zoom): rounded boxes in the
 * type colour, a flag for the spawn point, a ring for portals (red and
 * dashed when the target level was removed), labels under the boxes
 * (type name, or "→ Zindan" for portals) hidden when zoomed out.
 *
 * What each entity looks like (colour, label, link status) is resolved once
 * per change — store "entities" / "entityTypes" / "layers" events (undo /
 * redo included) and level list changes — and cached; frames only lay the
 * cached items out. Label `Text` objects are pooled per label string and
 * colour (a broken link's label is red).
 */
import {
  isEntityLayer,
  type Entity,
  type EntityLayer,
  type MapStore,
  type ProjectData,
  type StoreChangeEvent,
} from "@smap/core";
import { Container, Graphics, Text, TextStyle } from "pixi.js";

import { entityTypeName } from "../commands/entityActions";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { screenToWorld, snappedOffset, type Point } from "./camera";
import type { CameraController } from "./cameraController";
import { CANVAS_COLORS, type CanvasColors } from "./colors";
import { entityBox, entityLook, hitSlop, hitTestEntities, labelsVisible, type EntityColors, type EntityLook } from "./entityLogic";

interface Item {
  readonly entity: Entity;
  readonly look: EntityLook;
}

interface LayerItems {
  readonly layer: EntityLayer;
  readonly items: Item[];
}

export interface EntityRendererHost {
  readonly camera: CameraController;
  readonly colors: CanvasColors;
  readonly entityColors: EntityColors;
  /** Entity whose outline is highlighted as hovered, or null. */
  hoverId(): string | null;
  requestRender(): void;
}

const LABEL_STYLE = new TextStyle({
  fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
  fontSize: 12,
  fontWeight: "500",
  fill: CANVAS_COLORS.text,
  stroke: { color: CANVAS_COLORS.cursorShadow, width: 3, join: "round" },
});

/** Label styles by fill colour (text, or the danger colour of a broken link). */
const labelStyles = new Map<number, TextStyle>([[CANVAS_COLORS.text, LABEL_STYLE]]);

function labelStyle(fill: number): TextStyle {
  let style = labelStyles.get(fill);
  if (!style) {
    style = LABEL_STYLE.clone();
    style.fill = fill;
    labelStyles.set(fill, style);
  }
  return style;
}

export class EntityRenderer {
  /** Screen-space root; add above the world container. */
  readonly root = new Container();
  readonly #shapes = new Container();
  readonly #marks = new Graphics();
  readonly #labels = new Container();
  readonly #layerGfx = new Map<string, Graphics>();
  readonly #pool = new Map<string, Text[]>();
  readonly #host: EntityRendererHost;
  #store: MapStore | null = null;
  #unsubscribe: (() => void) | null = null;
  readonly #unsubLibrary: () => void;
  #items: LayerItems[] = [];
  #dirty = true;

  constructor(host: EntityRendererHost) {
    this.#host = host;
    this.root.addChild(this.#shapes, this.#marks, this.#labels);
    this.#unsubLibrary = useProjectLibrary.subscribe((s, prev) => {
      if (s.levels !== prev.levels) this.#invalidate();
    });
  }

  setStore(store: MapStore | null): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#store = store;
    if (store) this.#unsubscribe = store.subscribe((e) => this.#handle(e));
    this.#invalidate();
  }

  destroy(): void {
    this.#unsubscribe?.();
    this.#unsubLibrary();
    this.root.destroy({ children: true });
    this.#pool.clear();
    this.#layerGfx.clear();
  }

  /** Top-most entity of `layer` under screen point `p` (CSS px). */
  hitTest(layer: EntityLayer, p: Point): Entity | null {
    const store = this.#store;
    if (!store) return null;
    const cam = this.#host.camera;
    const w = screenToWorld(cam.camera, p.x, p.y, cam.resolution);
    return hitTestEntities(layer.entities, store.document.map, w, hitSlop(cam.camera.zoom));
  }

  /** Top-most entity of any visible entity layer under `p` (top layer first). */
  hitTestVisible(p: Point): Entity | null {
    const doc = this.#store?.document;
    if (!doc) return null;
    const layers = doc.entityLayers();
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      if (!l.visible || l.opacity <= 0) continue;
      const hit = this.hitTest(l, p);
      if (hit) return hit;
    }
    return null;
  }

  /** Lays the entities out for the current camera. */
  draw(): void {
    this.#marks.clear();
    for (const g of this.#layerGfx.values()) g.clear();
    for (const t of this.#labels.children) t.visible = false;
    const store = this.#store;
    if (!store) return;
    if (this.#dirty) this.#rebuild();
    const cam = this.#host.camera;
    const map = store.document.map;
    const res = cam.resolution;
    const px = 1 / res;
    const k = cam.lineWidth();
    const off = snappedOffset(cam.camera, res);
    const ox = Math.round(off.x * res);
    const oy = Math.round(off.y * res);
    const z = cam.camera.zoom * res;
    const vw = cam.viewW * res;
    const vh = cam.viewH * res;
    const state = useEditorStore.getState();
    const selectedId = state.selectedEntityId;
    const hoverId = this.#host.hoverId();
    const colors = this.#host.colors;

    type Placed = { item: Item; x0: number; y0: number; x1: number; y1: number; alpha: number };
    const placed: Placed[] = [];
    for (const { layer, items } of this.#items) {
      const g = this.#gfx(layer.id);
      g.visible = layer.visible && layer.opacity > 0;
      g.alpha = layer.opacity;
      if (!g.visible) continue;
      for (const item of items) {
        const b = entityBox(item.entity, map);
        let x0 = Math.round(ox + b.x * z);
        let y0 = Math.round(oy + b.y * z);
        let x1 = Math.round(ox + (b.x + b.width) * z);
        let y1 = Math.round(oy + (b.y + b.height) * z);
        // Never smaller than a few device px, so entities stay visible far out.
        const min = 4 * k;
        if (x1 - x0 < min) {
          const c = (x0 + x1) / 2;
          x0 = Math.round(c - min / 2);
          x1 = x0 + min;
        }
        if (y1 - y0 < min) {
          const c = (y0 + y1) / 2;
          y0 = Math.round(c - min / 2);
          y1 = y0 + min;
        }
        if (x1 < 0 || y1 < 0 || x0 > vw || y0 > vh) continue;
        drawEntity(g, item.look, x0, y0, x1, y1, k, px);
        placed.push({ item, x0, y0, x1, y1, alpha: layer.opacity });
      }
    }

    // Hover and selection marks (above every layer). A broken link keeps its
    // red in every state: its marks are drawn in the danger colour.
    const m = this.#marks;
    for (const p of placed) {
      const id = p.item.entity.id;
      const broken = p.item.look.broken;
      if (id === selectedId && broken) {
        // Red on red would vanish: a separate frame, a dark gap away from the red box.
        outline(m, p.x0 - 4 * k, p.y0 - 4 * k, p.x1 + 4 * k, p.y1 + 4 * k, 4 * k, px);
        m.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.6 });
        outline(m, p.x0 - 3 * k, p.y0 - 3 * k, p.x1 + 3 * k, p.y1 + 3 * k, 2 * k, px);
        m.fill(p.item.look.color);
      } else if (id === selectedId) {
        outline(m, p.x0 - 2 * k, p.y0 - 2 * k, p.x1 + 2 * k, p.y1 + 2 * k, k, px);
        m.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.55 });
        outline(m, p.x0 - k, p.y0 - k, p.x1 + k, p.y1 + k, 2 * k, px);
        m.fill(colors.accent);
      } else if (id === hoverId) {
        outline(m, p.x0 - k, p.y0 - k, p.x1 + k, p.y1 + k, k, px);
        m.fill(broken ? { color: p.item.look.color, alpha: 1 } : { color: 0xffffff, alpha: 0.85 });
      }
    }

    const cellCss = map.tileWidth * cam.camera.zoom;
    if (!labelsVisible(cellCss, placed.length)) return;
    const used = new Map<string, number>();
    for (const p of placed) {
      const label = p.item.look.label;
      if (!label) continue;
      const fill = p.item.look.broken ? p.item.look.color : this.#host.colors.text;
      const key = `${fill}|${label}`;
      const n = used.get(key) ?? 0;
      used.set(key, n + 1);
      const t = this.#label(label, fill, n, res);
      t.visible = true;
      t.alpha = p.alpha;
      t.position.set(((p.x0 + p.x1) / 2) * px, (p.y1 + 2 * k) * px);
    }
  }

  // ------------------------------------------------------------------ internals

  #handle(e: StoreChangeEvent): void {
    if (e.structure.some((s) => s === "entities" || s === "entityTypes" || s === "layers" || s === "map")) this.#invalidate();
  }

  #invalidate(): void {
    this.#dirty = true;
    this.#host.requestRender();
  }

  /** Re-resolves every entity's look; drops a selection whose entity is gone. */
  #rebuild(): void {
    this.#dirty = false;
    const doc = this.#store?.document;
    this.#items = [];
    const alive = new Set<string>();
    if (doc) {
      const levels = useProjectLibrary.getState().levels;
      const project: ProjectData = { name: "", levels, tilesets: [] };
      for (const layer of doc.layers) {
        if (!isEntityLayer(layer)) continue;
        alive.add(layer.id);
        this.#items.push({
          layer,
          items: layer.entities.map((entity) => ({
            entity,
            look: entityLook(entity, doc.getEntityType(entity.typeId), project, this.#host.entityColors, entityTypeName),
          })),
        });
      }
    }
    // Layer graphics in layer order; drop removed layers.
    for (const [id, g] of this.#layerGfx) {
      if (alive.has(id)) continue;
      g.destroy();
      this.#layerGfx.delete(id);
    }
    this.#items.forEach(({ layer }, i) => this.#shapes.addChildAt(this.#gfx(layer.id), Math.min(i, this.#shapes.children.length)));
    const s = useEditorStore.getState();
    if (s.selectedEntityId && !doc?.findEntity(s.selectedEntityId)) s.setSelectedEntity(null);
  }

  #gfx(layerId: string): Graphics {
    let g = this.#layerGfx.get(layerId);
    if (!g) {
      g = new Graphics();
      this.#layerGfx.set(layerId, g);
      this.#shapes.addChild(g);
    }
    return g;
  }

  #label(text: string, fill: number, n: number, resolution: number): Text {
    const key = `${fill}|${text}`;
    let list = this.#pool.get(key);
    if (!list) this.#pool.set(key, (list = []));
    let t = list[n];
    if (!t) {
      t = new Text({ text, style: labelStyle(fill), resolution });
      t.anchor.set(0.5, 0);
      list.push(t);
      this.#labels.addChild(t);
    } else if (t.resolution !== resolution) t.resolution = resolution;
    return t;
  }
}

/** One entity in device px (`px` converts to stage units). */
function drawEntity(g: Graphics, look: EntityLook, x0: number, y0: number, x1: number, y1: number, k: number, px: number): void {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 8 * k || h < 8 * k) {
    // Far out: a solid chip.
    g.rect(x0 * px, y0 * px, w * px, h * px).fill({ color: look.color, alpha: 0.9 });
    return;
  }
  const inset = k;
  const bx = (x0 + inset) * px;
  const by = (y0 + inset) * px;
  const bw = (w - 2 * inset) * px;
  const bh = (h - 2 * inset) * px;
  const radius = Math.min(4 * k, w / 5, h / 5) * px;
  const line = w >= 20 * k && h >= 20 * k ? 2 * k : k;
  // Dark halo outside keeps the box readable on any tile.
  g.roundRect(bx, by, bw, bh, radius).stroke({ color: CANVAS_COLORS.cursorShadow, width: k * px, alpha: 0.45, alignment: 0 });
  g.roundRect(bx, by, bw, bh, radius).fill({ color: look.color, alpha: look.broken ? 0.7 : 0.42 });
  if (look.broken) dashed(g, x0 + inset, y0 + inset, x1 - inset, y1 - inset, Math.max(line, 2 * k), px, look.color);
  else g.roundRect(bx, by, bw, bh, radius).stroke({ color: look.color, width: line * px, alignment: 1 });

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const s = Math.min(w, h) * 0.56;
  if (look.shape === "spawn") {
    // Flag: pole + pennant.
    const pole = Math.max(k, Math.round(s * 0.09));
    const left = Math.round(cx - s * 0.32);
    const top = Math.round(cy - s / 2);
    g.rect(left * px, top * px, pole * px, s * px).fill({ color: 0xffffff, alpha: 0.95 });
    g.poly([
      (left + pole) * px, top * px,
      (left + pole + s * 0.62) * px, (top + s * 0.21) * px,
      (left + pole) * px, (top + s * 0.42) * px,
    ]).fill({ color: 0xffffff, alpha: 0.95 });
  } else if (look.shape === "portal") {
    const r = s * 0.4;
    g.ellipse(cx * px, cy * px, r * px, r * 1.15 * px).stroke({ color: 0xffffff, width: Math.max(k, s * 0.1) * px, alpha: 0.95 });
    g.circle(cx * px, cy * px, Math.max(k, s * 0.08) * px).fill({ color: 0xffffff, alpha: 0.95 });
  }
}

/** `k`-device-px outline just inside x0..x1, y0..y1. */
function outline(g: Graphics, x0: number, y0: number, x1: number, y1: number, k: number, px: number): void {
  const w = x1 - x0;
  const h = y1 - y0;
  g.rect(x0 * px, y0 * px, w * px, k * px)
    .rect(x0 * px, (y1 - k) * px, w * px, k * px)
    .rect(x0 * px, (y0 + k) * px, k * px, (h - 2 * k) * px)
    .rect((x1 - k) * px, (y0 + k) * px, k * px, (h - 2 * k) * px);
}

/** Dashed `k`-px outline (broken link). */
function dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, k: number, px: number, color: number): void {
  const dash = 4 * k;
  const step = 7 * k;
  for (let x = x0; x < x1; x += step) {
    const w = Math.min(dash, x1 - x);
    g.rect(x * px, y0 * px, w * px, k * px).rect(x * px, (y1 - k) * px, w * px, k * px);
  }
  for (let y = y0; y < y1; y += step) {
    const h = Math.min(dash, y1 - y);
    g.rect(x0 * px, y * px, k * px, h * px).rect((x1 - k) * px, y * px, k * px, h * px);
  }
  g.fill(color);
}
