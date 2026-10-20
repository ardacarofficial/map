import { createContext, useEffect, useState, type ReactNode } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useDockStore } from '../layout/dockStore';
import { setActiveModalScope, dismissOverlays, dismissTooltips } from './overlayPolicy';

import { findActiveModalScope } from './overlayDom';

export const ActiveModalScope = createContext<string | null>(null);
/** One lifecycle subscription for the application, rather than one observer per tooltip. */
export function OverlayLifecycle({ children }: { children: ReactNode }) {
  const store = useEditorStore(state => state.project?.store);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    let current: string | null = null;
    const update = () => {
      const next = findActiveModalScope();
      if (next === current) return;
      current = next;
      setActiveModalScope(next);
      // Close background menus without sending Escape to the newly opened dialog.
      dismissOverlays();
      document.body.toggleAttribute('data-modal-open', next !== null);
      setActive(next);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ending-style', 'data-overlay-modal'] });
    update();
    const dock = useDockStore.subscribe((next, previous) => {
      if (next.layout !== previous.layout || next.gestures > previous.gestures) dismissOverlays();
    });
    const editor = useEditorStore.subscribe((next, previous) => {
      if (next.project !== previous.project) dismissOverlays();
    });
    const press = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // A tooltip must be gone before any inline form is mounted.
      dismissTooltips();
      if (target.closest('[data-canvas-host]')) dismissOverlays();
    };
    const wheel = (event: WheelEvent) => { if (event.target instanceof Element && event.target.closest('[data-canvas-host]')) dismissOverlays(); };
    document.addEventListener('wheel', wheel, { capture: true, passive: true });
    const key = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') dismissTooltips(); };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', press, true);
    const focus = (event: FocusEvent) => { if (event.target instanceof Element && event.target.matches('input,textarea,[contenteditable=true]')) dismissTooltips(); };
    document.addEventListener('focusin', focus);
    return () => {
      observer.disconnect(); dock(); editor();
      document.removeEventListener('wheel', wheel, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('focusin', focus);
      document.body.removeAttribute('data-modal-open');
      setActiveModalScope(null);
    };
  }, []);
  useEffect(() => {
    if (!store) return;
    let sources = store.document.tilesets.map(source => source.id);
    return store.subscribe(() => {
      const next = store.document.tilesets.map(source => source.id);
      if (sources.some(id => !next.includes(id))) dismissOverlays();
      sources = next;
    });
  }, [store]);
  return <ActiveModalScope.Provider value={active}>{children}</ActiveModalScope.Provider>;
}
