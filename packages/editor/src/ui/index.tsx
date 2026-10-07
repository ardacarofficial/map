/**
 * React panels (toolbar, layers, tileset, properties, status bar).
 * Tile data never lives in React state; panels send commands to the
 * core `MapStore` and listen for its changes.
 */
export function App() {
  return (
    <div className="flex h-full items-center justify-center">
      <h1 className="text-sm font-medium">Harita Tasarlayıcı</h1>
    </div>
  );
}
