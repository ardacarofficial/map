import type { ReactNode } from "react";

import { Icon } from "../primitives/Icon";

/**
 * A titled block in a panel column. With `onToggleCollapsed` the title is a
 * button that folds the section to its header (chevron before the title).
 */
export function PanelSection({
  title,
  heading,
  actions,
  extra,
  collapsed = false,
  onToggleCollapsed,
  className = "",
  bare = false,
  children,
}: {
  title: string;
  /** Body only: a host (e.g. the right column's tab strip) already shows the title. */
  bare?: boolean;
  /** Replaces the title text in the header (e.g. tabs); `title` still names the section. */
  heading?: ReactNode;
  actions?: ReactNode;
  /** Trailing header control after the actions (e.g. the column's hide button). */
  extra?: ReactNode;
  /** Folded to its header: the body is not rendered. */
  collapsed?: boolean;
  /** Makes the title a fold / unfold button. */
  onToggleCollapsed?(): void;
  className?: string;
  children: ReactNode;
}) {
  const title_ =
    heading ??
    (onToggleCollapsed ? (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        data-section-toggle=""
        className="-ml-1 flex h-6 min-w-0 items-center gap-1 rounded-sm pr-1.5 pl-0.5 text-xs font-semibold tracking-section text-muted uppercase hover:bg-hover hover:text-text"
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={12} className="shrink-0 text-faint" />
        <span className="truncate">{title}</span>
      </button>
    ) : (
      <h2 className="text-xs font-semibold tracking-section text-muted uppercase">{title}</h2>
    ));
  if (bare) {
    return (
      <section aria-label={title} className={`flex min-h-0 flex-col ${className}`}>
        {children}
      </section>
    );
  }
  return (
    <section aria-label={title} data-collapsed={collapsed ? "" : undefined} className={`flex min-h-0 flex-col border-b border-line-subtle last:border-b-0 ${className}`}>
      <header className="flex h-control-md shrink-0 items-center gap-1 px-2">
        {title_}
        <div className="ml-auto flex items-center gap-0.5">
          {actions}
          {extra}
        </div>
      </header>
      {!collapsed && children}
    </section>
  );
}
