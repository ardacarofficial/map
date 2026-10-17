/** Text and icon buttons. Sizes: sm 24px, md 28px (default), rail icons 32px. */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press font-medium",
  secondary: "bg-active text-text hover:bg-hover-popup",
  ghost: "bg-transparent text-muted hover:bg-hover hover:text-text",
  danger: "bg-danger text-on-accent hover:brightness-110 active:brightness-95 font-medium",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "secondary", size = "md", className = "", children, ref, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm text-sm whitespace-nowrap transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-40 ${size === "sm" ? "h-control-sm px-2" : "h-control-md px-3"} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  size?: "sm" | "md" | "rail";
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};
const ICON_SIZES = { sm: "size-control-sm", md: "size-control-md", rail: "size-control-rail" } as const;

/** Square icon button; supply an accessible name through aria-label. */
export function IconButton({ active = false, size = "md", className = "", children, ref, ...rest }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`grid ${ICON_SIZES[size]} shrink-0 place-items-center rounded-sm disabled:pointer-events-none disabled:opacity-40 ${active ? "bg-active text-accent" : "text-muted hover:bg-hover hover:text-text"} ${className}`}
    >
      {children}
    </button>
  );
}
