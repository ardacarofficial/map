/** 28px section heading: title, actions, padding (8/12), optional controlled collapse. */
import type { ComponentPropsWithRef, ReactNode } from "react";

import { Icon } from "./Icon";

export type SectionHeaderProps = Omit<ComponentPropsWithRef<"header">, "title"> & {
  title: ReactNode;
  actions?: ReactNode;
  padding?: 8 | 12;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?(): void;
};
export function SectionHeader({ title, actions, padding = 8, collapsible = false, collapsed = false, onToggleCollapsed, className = "", ref, ...rest }: SectionHeaderProps) {
  return (
    <header ref={ref} {...rest} className={`flex h-control-md shrink-0 items-center gap-2 ${padding === 12 ? "px-3" : "px-2"} ${className}`}>
      {collapsible ? (
        <button type="button" aria-expanded={!collapsed} onClick={onToggleCollapsed} data-section-toggle="" className="flex h-control-sm min-w-0 items-center gap-1 rounded-sm text-xs font-semibold tracking-section text-muted uppercase hover:text-text">
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
          <span className="truncate">{title}</span>
        </button>
      ) : <h2 className="min-w-0 truncate text-xs font-semibold tracking-section text-muted uppercase">{title}</h2>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>}
    </header>
  );
}
