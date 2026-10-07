import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover font-medium",
  secondary: "bg-raised text-text border border-line hover:bg-hover hover:border-line-strong",
  ghost: "text-muted hover:bg-hover hover:text-text",
};

export function Button({
  variant = "secondary",
  className = "",
  children,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-md whitespace-nowrap transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Square icon-only button (toolbar, rails, panel headers). */
export function IconButton({
  active = false,
  className = "",
  children,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={rest["aria-pressed"]}
      {...rest}
      className={`grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
      } ${className}`}
    >
      {children}
    </button>
  );
}
