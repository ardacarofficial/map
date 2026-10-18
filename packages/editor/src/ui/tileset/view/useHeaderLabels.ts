import { useLayoutEffect, useState, type RefObject } from "react";

/** Measure both label variants, including labels kept out of flow in compact mode. */
export function useHeaderLabels(ref: RefObject<HTMLDivElement | null>) {
  const [labels, setLabels] = useState({ view: true });
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    let disposed = false;
    const measure = () => {
      if (disposed || !header.clientWidth) return;
      const style = getComputedStyle(header);
      const children = [...header.children].filter((child) => getComputedStyle(child).display !== "none");
      const gap = Number.parseFloat(style.columnGap) || 0;
      const available = header.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      let base = Math.max(0, children.length - 1) * gap;
      const widths = { view: { full: 0, compact: 0 } };
      for (const child of children) {
        const group = child.getAttribute("data-header-group");
        if (group === "view") {
          const spans = [...child.querySelectorAll<HTMLElement>("[data-header-label]")];
          const delta = spans.reduce((sum, span) => sum + span.getBoundingClientRect().width + (Number.parseFloat(getComputedStyle(span.parentElement!).columnGap) || 0), 0);
          const hidden = spans.some((span) => getComputedStyle(span).position === "absolute");
          const full = child.getBoundingClientRect().width + (hidden ? delta : 0);
          widths[group] = { full, compact: full - delta };
        } else {
          // Flexible source/drop areas can truncate or scroll before controls lose labels.
          base += child.hasAttribute("data-header-flexible") ? Number.parseFloat(getComputedStyle(child).minWidth) || 0 : child.getBoundingClientRect().width;
        }
      }
      setLabels((previous) => {
        // Restore with 8px spare space. Required widths stay independent of the rendered variant.
        const view = base + widths.view.full + (previous.view ? 0 : 8) <= available;
        return previous.view === view ? previous : { view };
      });
    };
    const observed = new Set<Element>();
    const resize = new ResizeObserver(measure);
    const observe = () => {
      const elements = new Set<Element>([header, ...header.children, ...header.querySelectorAll("[data-header-label]")]);
      for (const el of observed) if (!elements.has(el)) { resize.unobserve(el); observed.delete(el); }
      for (const el of elements) if (!observed.has(el)) { resize.observe(el); observed.add(el); }
      measure();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(header, { childList: true, subtree: true, characterData: true });
    observe();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      disposed = true;
      resize.disconnect();
      mutation.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [ref]);
  return labels;
}
