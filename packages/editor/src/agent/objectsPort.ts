/** Host side of reference_detect_objects (K5) and suggest_stamps (K6). Reads only: reference pictures, stamps and
 * tileset art; never writes the map, the stamp library or any PNG. */
import {
  AgentError, AgentErrorCode, OBJECT_LIMITS,
  type AgentObjectsPort, type AgentWorldPort, type DetectObjectsRequest, type ObjectMatch, type PreviewImage,
} from "@smap/agent";
import type { RgbaImage, Stamp } from "@smap/core";
import { encodeAgentPng, imagePixels } from "./images";
import { imageWork } from "./imageWork";
import { drawPreviewOverlays, previewLayout } from "./preview";
import { RasterReplay } from "./raster";
import { referencePixels, resolveGrid, worldTileIndex } from "./referenceLibrary";
import { detectObjects, type DetectTemplate } from "./objects/detect";
import { resampleToMapPixels, stampRgba } from "./objects/raster";
import { suggestStampCandidates } from "./objects/suggest";

const fail = (code: AgentErrorCode, message: string, details: Record<string, string | number | boolean> = {}): never => { throw new AgentError(code, message, details); };
const BOX_COLORS = [[105, 201, 174, 255], [231, 183, 95, 255], [240, 112, 122, 255], [120, 170, 255, 255], [200, 140, 255, 255], [250, 240, 120, 255]] as const;

export function createObjectsPort(world: AgentWorldPort, revision: () => number): AgentObjectsPort {
  return {
    async detect(args: DetectObjectsRequest, call) {
      const store = await world.loadMap(args.mapId), map = store.document.map, mapRevision = store.revision;
      const reference = referencePixels(args.referenceId) ?? fail(AgentErrorCode.UNKNOWN_ID, "Unknown referenceId");
      // "auto": the saved reference_align grid, else detection (whole-map fit when unsure); "none": whole-map fit.
      const grid = await resolveGrid({ referenceId: args.referenceId, mapId: args.mapId, ...(args.alignment !== undefined ? { alignment: args.alignment } : {}) },
        store.document, { x: 0, y: 0, width: map.width, height: map.height }, call, () => worldTileIndex(world, revision, call));
      const alignment = grid.alignment, warnings = [...grid.warnings];
      const cols = Math.min(alignment.cols, map.width), rows = Math.min(alignment.rows, map.height);
      if (cols * map.tileWidth * rows * map.tileHeight > OBJECT_LIMITS.workPixels)
        fail(AgentErrorCode.LIMIT_EXCEEDED, "The aligned area is too large to search (8 megapixels of map art)", { nextAction: "Detect on a smaller map, or align a crop of the picture." });
      const checkpoint = imageWork(call);
      const work = resampleToMapPixels(reference, alignment, map.tileWidth, map.tileHeight, cols, rows);
      // Templates: every listed stamp's art with its real alpha, at the map's tile size.
      const stamps = args.stampIds.map(id => world.stamps().find(s => s.id === id)).filter((s): s is Stamp => !!s);
      const sources = new Map<string, RgbaImage>();
      for (const id of new Set(stamps.flatMap(s => s.palette.map(p => p.tilesetId)))) {
        try { sources.set(id, await imagePixels(id, call.signal)); } catch (error) { call.signal.throwIfAborted(); if (!(error instanceof AgentError)) throw error; }
      }
      const templates: DetectTemplate[] = [];
      for (const stamp of stamps) {
        if (stamp.width > OBJECT_LIMITS.stampSide || stamp.height > OBJECT_LIMITS.stampSide) { warnings.push(`${stamp.id}: larger than 16×16 cells, not searched`); continue; }
        if (stamp.width > cols || stamp.height > rows) continue;
        const { image, missing } = stampRgba(stamp, world.tilesets(), id => sources.get(id), map.tileWidth, map.tileHeight);
        if (missing.length) warnings.push(`${stamp.id}: artwork of ${missing.join(", ")} is unavailable`);
        templates.push({ id: stamp.id, cellsW: stamp.width, cellsH: stamp.height, image });
        const pause = checkpoint(); if (pause) await pause;
      }
      const out = await detectObjects({ work, tileWidth: map.tileWidth, tileHeight: map.tileHeight, templates, minScore: args.minScore ?? 0.85, maxMatches: OBJECT_LIMITS.matches, checkpoint }).catch((error: unknown) => {
        if (error instanceof AgentError && error.code === AgentErrorCode.TIMEOUT)
          throw new AgentError(AgentErrorCode.TIMEOUT, "Object detection ran out of time", { nextAction: "Pass stampIds for only the objects the picture shows, or detect on a smaller map." });
        throw error;
      });
      call.signal.throwIfAborted();
      if (store.revision !== mapRevision) fail(AgentErrorCode.REVISION_CONFLICT, "Map changed during detection", { nextAction: "Call reference_detect_objects again." });
      const matches: ObjectMatch[] = out.matches.map(m => ({ stampId: m.id, x: m.x, y: m.y, score: m.score, pixelResidual: { dx: m.dx, dy: m.dy } }));
      const positionsByStamp: Record<string, [number, number][]> = {};
      for (const m of matches) (positionsByStamp[m.stampId] ??= []).push([m.x, m.y]);
      const data = { mapId: args.mapId, referenceId: args.referenceId, alignment, matches, positionsByStamp, truncated: out.truncated, warnings, mapRevision };
      if (args.preview === false) return { data };
      // Preview: the aligned picture on the map grid, box n = matches[n-1].
      const region = { x: 0, y: 0, width: cols, height: rows };
      const layout = previewLayout(region, map.tileWidth, map.tileHeight, { coordinates: true, maxSide: 1536 });
      const art = new RasterReplay(layout.width, layout.height, layout.contentRect);
      art.fill({ x: 0, y: 0, width: layout.width, height: layout.height }, [27, 33, 42, 255]); art.checker(layout.contentRect);
      art.drawImage(work as unknown as CanvasImageSource, 0, 0, work.width, work.height, layout.left, layout.top, layout.contentRect.width, layout.contentRect.height);
      const canvas = new RasterReplay(layout.width, layout.height);
      canvas.data.set(art.data);
      drawPreviewOverlays(canvas, layout, region, { grid: true, coordinates: true });
      const order = [...new Set(matches.map(m => m.stampId))];
      out.matches.forEach((m, i) => {
        const color = BOX_COLORS[order.indexOf(m.id) % BOX_COLORS.length]!;
        const box = { x: Math.round(layout.left + m.px * layout.scale), y: Math.round(layout.top + m.py * layout.scale), width: Math.max(2, Math.round(m.width * layout.scale)), height: Math.max(2, Math.round(m.height * layout.scale)) };
        canvas.outline(box, color, box.width >= 24 ? 2 : 1);
        canvas.label(String(i + 1), box.x + 1, box.y + 1, box.width >= 32 ? 2 : 1);
      });
      call.signal.throwIfAborted();
      const image: PreviewImage = { width: layout.width, height: layout.height, scale: layout.scale, pixelOrigin: { x: 0, y: 0 }, cellSize: { width: layout.cw, height: layout.ch }, contentRect: layout.contentRect, grid: true, coordinates: true };
      return { data: { ...data, image }, image: { png: encodeAgentPng(canvas), width: layout.width, height: layout.height, revision: revision(), warnings: [] } };
    },

    async suggest(args, call) {
      const tileset = world.tilesets().find(t => t.id === args.tilesetId) ?? fail(AgentErrorCode.UNKNOWN_ID, "Unknown tileset");
      const pixels = await imagePixels(tileset.id, call.signal);
      const region = args.region ?? { x: 0, y: 0, width: tileset.columns, height: tileset.rows };
      const out = suggestStampCandidates({ tileset, pixels, region, minTiles: args.minTiles ?? 2, stamps: world.stamps() });
      call.signal.throwIfAborted();
      // Preview: the sheet region with numbered candidate boxes.
      const step = { x: tileset.tileWidth + tileset.spacing, y: tileset.tileHeight + tileset.spacing };
      const source = { x: tileset.margin + region.x * step.x, y: tileset.margin + region.y * step.y, width: region.width * step.x - tileset.spacing, height: region.height * step.y - tileset.spacing };
      if (source.x + source.width > pixels.width || source.y + source.height > pixels.height) fail(AgentErrorCode.SOURCE_CHANGED, "Tileset sheet is smaller than its grid");
      const side = 1536, pad = 8, fit = side / Math.max(source.width, source.height);
      const scale = fit >= 1 ? Math.min(8, Math.floor(fit)) : fit;
      const content = { x: pad, y: pad, width: Math.max(1, Math.floor(source.width * scale)), height: Math.max(1, Math.floor(source.height * scale)) };
      const width = content.width + 2 * pad, height = content.height + 2 * pad;
      const art = new RasterReplay(width, height, content);
      art.fill({ x: 0, y: 0, width, height }, [27, 33, 42, 255]); art.checker(content);
      art.drawImage(pixels as unknown as CanvasImageSource, source.x, source.y, source.width, source.height, content.x, content.y, content.width, content.height);
      const canvas = new RasterReplay(width, height);
      canvas.data.set(art.data);
      const cell = tileset.tileWidth * scale;
      if (cell >= 6) {
        for (let x = 1; x < region.width; x++) canvas.fill({ x: content.x + Math.round((x * step.x - tileset.spacing / 2) * scale), y: content.y, width: 1, height: content.height }, [155, 175, 185, 60]);
        for (let y = 1; y < region.height; y++) canvas.fill({ x: content.x, y: content.y + Math.round((y * step.y - tileset.spacing / 2) * scale), width: content.width, height: 1 }, [155, 175, 185, 60]);
      }
      for (const c of out.candidates) {
        const box = { x: content.x + Math.round((c.region.x - region.x) * step.x * scale), y: content.y + Math.round((c.region.y - region.y) * step.y * scale),
          width: Math.max(2, Math.round((c.region.width * step.x - tileset.spacing) * scale)), height: Math.max(2, Math.round((c.region.height * step.y - tileset.spacing) * scale)) };
        const color = c.existingStampId ? [155, 175, 185, 255] : BOX_COLORS[(c.n - 1) % BOX_COLORS.length]!;
        canvas.outline(box, color, cell >= 24 ? 2 : 1);
        canvas.label(String(c.n), box.x + 1, box.y + 1, cell >= 16 ? 2 : 1);
      }
      call.signal.throwIfAborted();
      return {
        data: { tilesetId: tileset.id, candidates: out.candidates, truncated: out.truncated, skipped: out.skipped, image: { width, height, scale, contentRect: content, origin: { x: region.x, y: region.y } } },
        image: { png: encodeAgentPng(canvas), width, height, revision: revision(), warnings: [] },
      };
    },
  };
}
