/**
 * The editor's frame without content, shown while a project handed over at
 * start-up (desktop: double-clicked `.smap`) is still being read. The window
 * can appear right away instead of after the open (CLAUDE.md v0.5: "bir
 * saniyenin altında açılır"), and the welcome screen does not flash first.
 * Plain boxes, no landmarks: empty regions would only confuse screen readers.
 */
export function EditorSkeleton() {
  return (
    <div aria-busy="true" className="flex h-full flex-col">
      <div className="h-toolbar shrink-0 border-b border-line bg-bg" />
      <div className="flex min-h-0 flex-1">
        <div className="w-rail shrink-0 border-r border-line bg-bg" />
        <div className="w-sidebar shrink-0 border-r border-line bg-panel" />
        <div className="flex min-w-0 flex-1 flex-col bg-canvas">
          <div className="h-optionsbar border-b border-line bg-panel" />
        </div>
        <div className="w-rightbar shrink-0 border-l border-line bg-panel" />
      </div>
      <div className="h-statusbar shrink-0 border-t border-line bg-bg" />
    </div>
  );
}
