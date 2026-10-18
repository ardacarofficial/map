/** Controlled horizontal tabs: value/onValueChange, labelled items with icon/attrs, optional trailing slot. */
import { useCallback, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";

import { t } from "../../i18n";
import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";
import { rovingIndex, type ItemAttrs } from "./rovingFocus";

/** Nearest-edge scroll; an oversized tab stays aligned instead of oscillating. */
export function tabRevealDelta(left: number, right: number, viewLeft: number, viewRight: number): number {
  if (right - left > viewRight - viewLeft) return left - viewLeft;
  if (left < viewLeft) return left - viewLeft;
  return Math.max(0, right - viewRight);
}

export type TabItem<Value extends string = string> = { value: Value; label: ReactNode; icon?: IconName | ReactElement; attrs?: ItemAttrs; disabled?: boolean };
export type TabsProps<Value extends string = string> = Omit<ComponentPropsWithRef<"div">, "onChange"> & {
  value: Value;
  onValueChange(value: Value): void;
  items: readonly TabItem<Value>[];
  label: string;
  trailing?: ReactNode;
  orientation?: "horizontal" | "vertical";
  scrollable?: boolean;
};
export function Tabs<Value extends string>({ value, onValueChange, items, label, trailing, orientation = "horizontal", scrollable = false, className = "", ref, ...rest }: TabsProps<Value>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const list = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });
  const scrolling = scrollable && orientation === "horizontal";
  const reveal = useCallback((button: HTMLButtonElement | null) => {
    const el = list.current;
    if (!scrolling || !el || !button) return;
    const r = button.getBoundingClientRect(), v = el.getBoundingClientRect();
    el.scrollLeft += tabRevealDelta(r.left, r.right, v.left, v.right);
  }, [scrolling]);
  useLayoutEffect(() => {
    const el = list.current;
    if (!scrolling || !el) return;
    const measure = () => {
      // Compare against the width without arrows to avoid a sticky overflow state.
      const arrows = overflow ? 2 * Number.parseFloat(getComputedStyle(el).getPropertyValue("--spacing-control-sm")) : 0;
      setOverflow(el.scrollWidth > el.clientWidth + arrows + 1);
      setEdges(previous => {
        const start = el.scrollLeft <= 1, end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
        return previous.start === start && previous.end === end ? previous : { start, end };
      });
      reveal(buttons.current.find(button => button?.getAttribute("aria-selected") === "true") ?? null);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    for (const button of buttons.current) if (button) resize.observe(button);
    measure();
    return () => resize.disconnect();
  }, [scrolling, overflow, items.length, value, reveal]);
  const disabled = items.map(item => !!(item.disabled || item.attrs?.disabled));
  const selected = items.findIndex((item, i) => item.value === value && !disabled[i]);
  const focusIndex = selected < 0 ? disabled.indexOf(false) : selected;
  return (
    <div ref={ref} {...rest} className={`flex h-tabrow shrink-0 items-stretch border-b border-line bg-tab-row ${className}`}>
      {scrolling && overflow && <IconButton size="sm" data-tabs-previous aria-label={t("panelTabs.previous")} title={t("panelTabs.previous")} disabled={edges.start} className="self-center" onClick={() => list.current?.scrollBy({ left: -list.current.clientWidth })}><Icon name="chevron-left" size={12} /></IconButton>}
      <div ref={list} onScroll={scrolling ? event => {
        const el = event.currentTarget;
        setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
      } : undefined} role="tablist" aria-label={label} aria-orientation={orientation} className={`flex min-w-0 flex-1 items-stretch ${scrolling ? "overflow-x-auto [scrollbar-width:none]" : ""}`}>
        {items.map((item, i) => (
          <button
            {...item.attrs}
            key={item.value}
            ref={node => { buttons.current[i] = node; }}
            title={item.attrs?.title ?? (typeof item.label === "string" ? item.label : undefined)}
            onFocus={event => { item.attrs?.onFocus?.(event); reveal(event.currentTarget); }}
            type="button"
            role="tab"
            disabled={disabled[i]}
            aria-selected={item.value === value}
            tabIndex={i === focusIndex ? 0 : -1}
            className={`relative flex min-w-0 items-center gap-1.5 ${scrolling ? "shrink-0 whitespace-nowrap" : ""} px-3 text-sm disabled:opacity-40 ${item.value === value ? "text-title after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent" : "text-muted hover:text-text"} ${item.attrs?.className ?? ""}`}
            onClick={event => { item.attrs?.onClick?.(event); if (!event.defaultPrevented) onValueChange(item.value); }}
            onKeyDown={event => {
              item.attrs?.onKeyDown?.(event);
              if (event.defaultPrevented || (orientation === "horizontal" ? event.key === "ArrowUp" || event.key === "ArrowDown" : event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
              const next = rovingIndex(event.key, i, disabled, getComputedStyle(event.currentTarget).direction === "rtl");
              if (next === undefined) return;
              event.preventDefault();
              buttons.current[next]?.focus();
              onValueChange(items[next]!.value);
            }}
          >
            {item.icon && (typeof item.icon === "string" ? <Icon name={item.icon} /> : item.icon)}
            <span className={scrolling ? "whitespace-nowrap" : "truncate"}>{item.label}</span>
          </button>
        ))}
      </div>
      {scrolling && overflow && <IconButton size="sm" data-tabs-next aria-label={t("panelTabs.next")} title={t("panelTabs.next")} disabled={edges.end} className="self-center" onClick={() => list.current?.scrollBy({ left: list.current.clientWidth })}><Icon name="chevronRight" size={12} /></IconButton>}
      {trailing && <div className="ml-auto flex shrink-0 items-center px-1">{trailing}</div>}
    </div>
  );
}
