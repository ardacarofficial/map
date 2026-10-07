import type { ReactNode } from "react";

/** A titled block in the right-hand panel column. */
export function PanelSection({
  title,
  actions,
  className = "",
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={`flex min-h-0 flex-col border-b border-line last:border-b-0 ${className}`}>
      <header className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted">{title}</h2>
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      </header>
      {children}
    </section>
  );
}
