import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "./menuStyles";
export const selectTriggerClass =
  "flex h-control-sm min-w-0 flex-1 items-center gap-2 rounded-sm border border-line bg-field px-2 text-sm text-text outline-none transition-colors hover:border-line-strong data-popup-open:border-line-strong focus-visible:border-accent";

/** A labelled option of {@link MenuSelect}. */
export interface SelectOption<V> {
  readonly value: V;
  readonly label: string;
  readonly leading?: ReactNode;
  readonly detail?: string;
}

/** Small select (Base UI menu) for card rows. */
export function MenuSelect<V extends string | number>({
  value,
  options,
  onChange,
  label,
  dataAttr,
}: {
  value: V;
  options: readonly SelectOption<V>[];
  onChange(value: V): void;
  label: string;
  dataAttr?: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className={selectTriggerClass} {...(dataAttr ? { [dataAttr]: String(current?.value ?? "") } : {})}>
        {current?.leading}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? ""}</span>
        <Icon name="chevronDown" size={12} className="shrink-0 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-80 min-w-50 overflow-y-auto`}>
            {options.map((o) => (
              <Menu.Item key={String(o.value)} className={menuItemClass} data-select-option={String(o.value)} onClick={() => onChange(o.value)}>
                {o.leading}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.detail && <span className="shrink-0 font-mono text-2xs text-faint tabular">{o.detail}</span>}
                {o.value === value && <Icon name="tick" size={12} className="text-accent" />}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
