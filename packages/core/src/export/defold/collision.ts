import { deriveCollision } from "../../collision";
import type { MapDocument } from "../../document";

/** Conservative package budget. Each batch gets a separate GO/component;
 * increasing map complexity creates more batches, never truncated shapes.
 * This is below native uint32 shape/index limits and the GO component budget.
 */
export const DEFOLD_SHAPES_PER_OBJECT = 16;

interface Rectangle { x: number; y: number; width: number; height: number }

/** Same identical-horizontal-run merge as TMJ, using the shared resolver. */
function rectangles(doc: MapDocument): Rectangle[] {
  const { width, height, data } = deriveCollision(doc);
  const result: Rectangle[] = [];
  let previous = new Map<string, Rectangle>();
  for (let y = 0; y < height; y++) {
    const current = new Map<string, Rectangle>();
    for (let x = 0; x < width;) {
      if (!data[y * width + x]) { x++; continue; }
      const start = x;
      while (x < width && data[y * width + x]) x++;
      const key = `${start},${x - start}`;
      let rect = previous.get(key);
      if (rect) rect.height++;
      else { rect = { x: start, y, width: x - start, height: 1 }; result.push(rect); }
      current.set(key, rect);
    }
    previous = current;
  }
  return result;
}

export function defoldCollisionObjects(doc: MapDocument): string[] {
  const rects = rectangles(doc);
  const { tileWidth, tileHeight } = doc.map;
  const objects: string[] = [];
  for (let start = 0; start < rects.length; start += DEFOLD_SHAPES_PER_OBJECT) {
    const batch = rects.slice(start, start + DEFOLD_SHAPES_PER_OBJECT);
    const lines = [
      "type: COLLISION_OBJECT_TYPE_STATIC", "mass: 0", "friction: 0.1", "restitution: 0",
      'group: "map"', 'mask: "default"', "embedded_collision_shape {",
    ];
    for (const [i, rect] of batch.entries()) {
      const x = (rect.x + rect.width / 2) * tileWidth;
      const y = -(rect.y + rect.height / 2) * tileHeight;
      lines.push("  shapes {", "    shape_type: TYPE_BOX",
        `    position { x: ${x} y: ${y} z: 0 }`, "    rotation { x: 0 y: 0 z: 0 w: 1 }",
        `    index: ${i * 3}`, "    count: 3", `    id: "box-${start + i}"`, "  }");
    }
    for (const rect of batch) lines.push(`  data: ${rect.width * tileWidth / 2}`, `  data: ${rect.height * tileHeight / 2}`, "  data: 0.5");
    lines.push("}", "");
    objects.push(lines.join("\n"));
  }
  return objects;
}
