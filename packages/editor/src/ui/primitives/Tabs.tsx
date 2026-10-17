/** Controlled horizontal tabs: value/onValueChange, labelled items with icon/attrs, optional trailing slot. */
import { useRef, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";

import { Icon, type IconName } from "./Icon";
import { rovingIndex, type ItemAttrs } from "./rovingFocus";

export type TabItem<Value extends string = string> = { value: Value; label: ReactNode; icon?: IconName | ReactElement; attrs?: ItemAttrs; disabled?: boolean };
export type TabsProps<Value extends string = string> = Omit<ComponentPropsWithRef<"div">, "onChange"> & {
  value: Value;
  onValueChange(value: Value): void;
  items: readonly TabItem<Value>[];
  label: string;
  trailing?: ReactNode;
};
export function Tabs<Value extends string>({ value, onValueChange, items, label, trailing, className = "", ref, ...rest }: TabsProps<Value>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const disabled = items.map(item => !!(item.disabled || item.attrs?.disabled));
  const selected = items.findIndex((item, i) => item.value === value && !disabled[i]);
  const focusIndex = selected < 0 ? disabled.indexOf(false) : selected;
  return (
    <div ref={ref} {...rest} className={`flex h-tabrow shrink-0 items-stretch border-b border-line bg-tab-row ${className}`}>
      <div role="tablist" aria-label={label} aria-orientation="horizontal" className="flex min-w-0 flex-1 items-stretch">
        {items.map((item, i) => (
          <button
            {...item.attrs}
            key={item.value}
            ref={node => { buttons.current[i] = node; }}
            type="button"
            role="tab"
            disabled={disabled[i]}
            aria-selected={item.value === value}
            tabIndex={i === focusIndex ? 0 : -1}
            className={`relative flex min-w-0 items-center gap-1.5 px-3 text-sm disabled:opacity-40 ${item.value === value ? "text-title after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent" : "text-muted hover:text-text"} ${item.attrs?.className ?? ""}`}
            onClick={event => { item.attrs?.onClick?.(event); if (!event.defaultPrevented) onValueChange(item.value); }}
            onKeyDown={event => {
              item.attrs?.onKeyDown?.(event);
              if (event.defaultPrevented || event.key === "ArrowUp" || event.key === "ArrowDown") return;
              const next = rovingIndex(event.key, i, disabled, getComputedStyle(event.currentTarget).direction === "rtl");
              if (next === undefined) return;
              event.preventDefault();
              buttons.current[next]?.focus();
              onValueChange(items[next]!.value);
            }}
          >
            {item.icon && (typeof item.icon === "string" ? <Icon name={item.icon} /> : item.icon)}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
      {trailing && <div className="ml-auto flex shrink-0 items-center px-1">{trailing}</div>}
    </div>
  );
}
