/**
 * The editor's frame without content, shown while a project handed over at
 * start-up (desktop: double-clicked `.smap`) is still being read. The window
 * can appear right away instead of after the open (CLAUDE.md v0.5: "bir
 * saniyenin altında açılır"), and the welcome screen does not flash first.
 */
export function EditorSkeleton() {
  return (
    <div aria-busy="true" className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <div className="h-toolbar border-b border-line bg-panel" />
      <div className="h-optionsbar border-b border-line bg-panel" />
      <div className="flex min-h-0">
        <div className="w-rail shrink-0 border-r border-line bg-panel" />
        <aside className="w-sidebar shrink-0 border-r border-line bg-panel max-lg:hidden" />
        <main className="min-w-0 flex-1 bg-canvas" />
        <aside className="w-sidebar shrink-0 border-l border-line bg-panel" />
      </div>
      <div className="h-statusbar border-t border-line bg-panel" />
    </div>
  );
}
