import { isTileLayer, type MapDocument } from "@smap/core";

export function tileLayerForPick(doc: MapDocument, activeLayerId: string | null): string | null {
  const active = activeLayerId ? doc.getLayer(activeLayerId) : undefined;
  if (isTileLayer(active)) return null;
  const layers = doc.layers;
  const plain = (i: number) => isTileLayer(layers[i]);
  const from = activeLayerId && active ? doc.indexOfLayer(activeLayerId) : layers.length;
  for (let i = from - 1; i >= 0; i--) if (plain(i)) return layers[i]!.id;
  for (let i = layers.length - 1; i > from; i--) if (plain(i)) return layers[i]!.id;
  return null;
}
