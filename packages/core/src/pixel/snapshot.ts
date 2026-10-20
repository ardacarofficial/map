import { MapDocument } from '../document';
import { TileLayer, isTileLayer } from '../layer';

/** Detached validation projection for pixel operations. Only remapped cells are
 * copied; allocation/metadata operations cannot inspect any other map cells.
 * Metadata identities (including lazy raster revisions) are retained verbatim.
 */
export function pixelEditSnapshot(doc: MapDocument, cells: readonly { layerId: string; x: number; y: number }[] = []): MapDocument {
  const copy = new MapDocument(doc.map, doc.seed);
  copy._setTilesets(doc.tilesets);
  copy._setEntityTypes(doc.entityTypes);
  copy._setRandomSets(doc.randomSets);
  copy._setCollections(doc.collections);
  copy._setProps(doc.props);
  copy.palette._restore(doc.palette.entries());
  for (const id of new Set(cells.map(c => c.layerId))) {
    const layer = doc.getLayer(id); if (!layer) continue;
    const props = { id: layer.id, name: layer.name, visible: layer.visible, locked: layer.locked, opacity: layer.opacity };
    const next = new TileLayer(props);
    copy._insertLayer(next, copy.layers.length);
  }
  for (const c of cells) {
    const layer = doc.getLayer(c.layerId), next = copy.getLayer(c.layerId);
    if (isTileLayer(layer) && next) next._setCell(c.x, c.y, layer.getCell(c.x, c.y));
  }
  return copy;
}
