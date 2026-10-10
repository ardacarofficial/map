/**
 * Tile-coordinate rulers along the top and left edges of the map canvas
 * (20 CSS px, mono 10 px, faint). Plain DOM: two 2D canvases and a corner
 * square in the canvas container; the map canvas is inset by the ruler size
 * while they are shown. Redrawn only when the camera, the hovered cell or
 * the map size changes. The hovered cell is highlighted on both rulers.
 */
import { RULER_SIZE, cellSpan, rulerTicks } from "./rulerMath";

export interface RulerView {
  /** Screen x / y (CSS px, relative to the map canvas) of map px 0. */
  readonly originX: number;
  readonly originY: number;
  /** CSS px per cell. */
  readonly cellW: number;
  readonly cellH: number;
  /** Map size in cells. */
  readonly cols: number;
  readonly rows: number;
  /** Map canvas size (CSS px) and device pixel ratio. */
  readonly viewW: number;
  readonly viewH: number;
  readonly resolution: number;
  /** Hovered cell, or null. */
  readonly hover: { readonly x: number; readonly y: number } | null;
}

interface RulerColors {
  bg: string;
  line: string;
  tick: string;
  text: string;
  accent: string;
  font: string;
}

function readColors(el: Element): RulerColors {
  const style = getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const mono = v("--font-mono", "ui-monospace, monospace");
  return {
    bg: v("--color-panel", "#19191c"),
    line: v("--color-line", "#2a2a30"),
    tick: v("--color-line-strong", "#3a3a42"),
    text: v("--color-faint", "#6c6c76"),
    accent: v("--color-accent", "#3dd6b0"),
    font: `10px ${mono}`,
  };
}

export class Rulers {
  readonly #container: HTMLElement;
  readonly #top = document.createElement("canvas");
  readonly #left = document.createElement("canvas");
  readonly #corner = document.createElement("div");
  #colors: RulerColors | null = null;
  #visible = false;
  #key = "";

  constructor(container: HTMLElement) {
    this.#container = container;
    const base: Partial<CSSStyleDeclaration> = { position: "absolute", display: "none", pointerEvents: "none", userSelect: "none" };
    Object.assign(this.#top.style, base, { top: "0", left: `${RULER_SIZE}px`, right: "0", height: `${RULER_SIZE}px` });
    Object.assign(this.#left.style, base, { top: `${RULER_SIZE}px`, left: "0", bottom: "0", width: `${RULER_SIZE}px` });
    Object.assign(this.#corner.style, base, { top: "0", left: "0", width: `${RULER_SIZE}px`, height: `${RULER_SIZE}px` });
    this.#top.setAttribute("aria-hidden", "true");
    this.#left.setAttribute("aria-hidden", "true");
    this.#corner.setAttribute("aria-hidden", "true");
    this.#top.dataset.ruler = "top";
    this.#left.dataset.ruler = "left";
  }

  get visible(): boolean {
    return this.#visible;
  }

  /** CSS px the map canvas is inset from the container's top-left (0 when hidden). */
  get inset(): number {
    return this.#visible ? RULER_SIZE : 0;
  }

  mount(): void {
    this.#container.append(this.#corner, this.#top, this.#left);
    this.#colors = readColors(this.#container);
    this.#corner.style.background = this.#colors.bg;
    this.#corner.style.boxShadow = `inset -1px -1px 0 ${this.#colors.line}`;
  }

  setVisible(visible: boolean): void {
    if (visible === this.#visible) return;
    this.#visible = visible;
    const display = visible ? "block" : "none";
    this.#top.style.display = display;
    this.#left.style.display = display;
    this.#corner.style.display = display;
    this.#key = "";
  }

  /** Draws for `view` (null: blank rulers, e.g. the world view or no map). Cheap when nothing changed. */
  draw(view: RulerView | null): void {
    if (!this.#visible || !this.#colors) return;
    const key = view
      ? [view.originX, view.originY, view.cellW, view.cellH, view.cols, view.rows, view.viewW, view.viewH, view.resolution, view.hover?.x, view.hover?.y].join(",")
      : "blank";
    if (key === this.#key) return;
    this.#key = key;
    const res = view?.resolution ?? (window.devicePixelRatio || 1);
    const w = view?.viewW ?? this.#top.clientWidth;
    const h = view?.viewH ?? this.#left.clientHeight;
    this.#drawOne(this.#top, w, res, view && { origin: view.originX, cell: view.cellW, cells: view.cols, hover: view.hover?.x ?? null }, false);
    this.#drawOne(this.#left, h, res, view && { origin: view.originY, cell: view.cellH, cells: view.rows, hover: view.hover?.y ?? null }, true);
  }

  destroy(): void {
    this.#top.remove();
    this.#left.remove();
    this.#corner.remove();
  }

  /** One ruler: `length` CSS px along its axis (`vertical`: the left ruler, labels turned -90°). */
  #drawOne(
    canvas: HTMLCanvasElement,
    length: number,
    res: number,
    axis: { origin: number; cell: number; cells: number; hover: number | null } | null,
    vertical: boolean,
  ): void {
    const c = this.#colors!;
    const devLen = Math.max(1, Math.round(length * res));
    const devThick = Math.round(RULER_SIZE * res);
    const cw = vertical ? devThick : devLen;
    const ch = vertical ? devLen : devThick;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Draw in "along / across" CSS px: x runs along the ruler, y across it (0 = outer edge).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, cw, ch);
    if (vertical) ctx.setTransform(0, res, res, 0, 0, 0);
    else ctx.setTransform(res, 0, 0, res, 0, 0);
    const px = 1 / res;
    // Inner edge line (towards the map).
    ctx.fillStyle = c.line;
    ctx.fillRect(0, RULER_SIZE - px, length, px);
    if (!axis) return;
    const span = cellSpan(axis.origin, axis.cell, length, axis.hover, axis.cells);
    if (span) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = c.accent;
      ctx.fillRect(span.from, 0, span.to - span.from, RULER_SIZE);
      ctx.globalAlpha = 1;
      ctx.fillRect(span.from, RULER_SIZE - 2 * px, span.to - span.from, 2 * px);
    }
    ctx.font = c.font;
    ctx.textBaseline = "top";
    const snap = (v: number) => Math.round(v * res) / res;
    const ticks = rulerTicks(axis.origin, axis.cell, length, axis.cells);
    for (const t of ticks) {
      const x = snap(t.pos);
      const len = t.major ? 7 : 3;
      ctx.fillStyle = t.major ? c.text : c.tick;
      ctx.fillRect(x, RULER_SIZE - len, px, len);
      if (!t.major || t.cell >= axis.cells) continue;
      const hovered = axis.hover === t.cell;
      ctx.fillStyle = hovered ? c.accent : c.text;
      label(ctx, String(t.cell), x, vertical);
    }
    // Hovered cell number when it has no label of its own.
    if (axis.hover !== null && span) {
      const labelled = ticks.some((t) => t.major && t.cell === axis.hover);
      if (!labelled) {
        const x = snap(span.from);
        ctx.fillStyle = c.accent;
        label(ctx, String(axis.hover), x, vertical);
      }
    }
  }
}

/**
 * A cell number just after the tick at `at` (along the ruler). On the left
 * ruler it is turned to read bottom-to-top (the drawing space there is
 * mirrored, so a mirror back is a quarter turn).
 */
function label(ctx: CanvasRenderingContext2D, text: string, at: number, vertical: boolean): void {
  if (!vertical) {
    ctx.textAlign = "left";
    ctx.fillText(text, at + 3, 3);
    return;
  }
  ctx.save();
  ctx.translate(at + 3, 4);
  ctx.scale(-1, 1);
  ctx.textAlign = "right";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
