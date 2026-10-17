/** Ref-forwarding input: sm/md sizing, optional leading icon and trailing content. */
import type { ComponentPropsWithRef, ReactElement, ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

export type TextFieldProps = Omit<ComponentPropsWithRef<"input">, "size"> & {
  size?: "sm" | "md";
  leadingIcon?: IconName | ReactElement;
  trailing?: ReactNode;
};
export function TextField({ size = "md", leadingIcon, trailing, className = "", style, ref, ...rest }: TextFieldProps) {
  return (
    <span style={style} className={`relative flex min-w-0 items-center ${className}`}>
      {leadingIcon && <span className="pointer-events-none absolute left-2 flex text-muted">{typeof leadingIcon === "string" ? <Icon name={leadingIcon} /> : leadingIcon}</span>}
      <input
        ref={ref}
        {...rest}
        className={`w-full min-w-0 rounded-sm border border-line bg-field text-text placeholder:text-faint hover:border-line-strong focus:border-accent focus-visible:outline-none disabled:opacity-40 ${size === "sm" ? "h-control-sm text-sm" : "h-control-md text-md"} ${leadingIcon ? "pl-7" : "pl-2"} ${trailing ? "pr-7" : "pr-2"}`}
      />
      {trailing && <span className="absolute right-2 flex items-center text-faint">{trailing}</span>}
    </span>
  );
}
