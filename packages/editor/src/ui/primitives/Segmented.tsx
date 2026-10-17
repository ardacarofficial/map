/** Controlled radiogroup: value/onValueChange, label, sm/md, items with label/icon/attrs/tooltip.
 * Name icon-only items with a tooltip or attrs["aria-label"]. */
import { useRef, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";

import { Icon, type IconName } from "./Icon";
import { rovingIndex, type ItemAttrs } from "./rovingFocus";
import { Tooltip } from "./Tooltip";

export type SegmentedItem<Value extends string = string> = {
  value: Value;
  label?: ReactNode;
  icon?: IconName | ReactElement;
  attrs?: ItemAttrs;
  tooltip?: string;
  disabled?: boolean;
};
export type SegmentedProps<Value extends string = string> = Omit<ComponentPropsWithRef<"div">, "onChange"> & {
  value: Value;
  onValueChange(value: Value): void;
  label: string;
  items: readonly SegmentedItem<Value>[];
  size?: "sm" | "md";
  disabled?: boolean;
};
export function Segmented<Value extends string>({ value, onValueChange, label, items, size = "sm", disabled = false, className = "", ref, ...rest }: SegmentedProps<Value>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const unavailable = items.map(item => !!(disabled || item.disabled || item.attrs?.disabled));
  const selected = items.findIndex((item, i) => item.value === value && !unavailable[i]);
  const focusIndex = selected < 0 ? unavailable.indexOf(false) : selected;
  return (
    <div ref={ref} {...rest} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={`inline-flex min-w-0 items-stretch rounded-sm border border-line bg-field ${size === "sm" ? "h-control-sm" : "h-control-md"} ${className}`}>
      {items.map((item, i) => {
        const button = (
          <button
            {...item.attrs}
            ref={node => { buttons.current[i] = node; }}
            type="button"
            role="radio"
            aria-checked={item.value === value}
            aria-label={item.attrs?.["aria-label"] ?? (typeof item.label === "string" ? item.label : item.tooltip)}
            disabled={unavailable[i]}
            tabIndex={i === focusIndex ? 0 : -1}
            className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm border px-2 text-sm disabled:opacity-40 ${item.value === value ? "border-line-strong bg-active text-title" : "border-transparent text-muted hover:text-text"} ${item.attrs?.className ?? ""}`}
            onClick={event => { item.attrs?.onClick?.(event); if (!event.defaultPrevented) onValueChange(item.value); }}
            onKeyDown={event => {
              item.attrs?.onKeyDown?.(event);
              if (event.defaultPrevented) return;
              const next = rovingIndex(event.key, i, unavailable, getComputedStyle(event.currentTarget).direction === "rtl");
              if (next === undefined) return;
              event.preventDefault();
              buttons.current[next]?.focus();
              onValueChange(items[next]!.value);
            }}
          >
            {item.icon && (typeof item.icon === "string" ? <Icon name={item.icon} /> : item.icon)}
            {item.label}
          </button>
        );
        return item.tooltip ? <Tooltip key={item.value} label={item.tooltip}>{button}</Tooltip> : <span key={item.value} className="contents">{button}</span>;
      })}
    </div>
  );
}
