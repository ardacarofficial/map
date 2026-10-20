/** Tooltip labels add a shortcut, explanation or an icon's accessible name. */
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { useContext, useEffect, useId, useRef, useState, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { keysFor, type CommandId } from '../../shortcuts/shortcuts';
import { Kbd } from './Kbd';
import { ActiveModalScope, OverlayLifecycle } from './OverlayLifecycle';
import { ModalOverlayScope } from './Overlays';
import { activeModalScope, dismissTooltipEvent, overlayPosition } from './overlayPolicy';

/** Shared 500ms warm-up, immediate close, and 400ms instant-follow window. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <OverlayLifecycle><BaseTooltip.Provider delay={500} closeDelay={0} timeout={400}>{children}</BaseTooltip.Provider></OverlayLifecycle>;
}
export type TooltipProps = Omit<ComponentPropsWithRef<typeof BaseTooltip.Trigger>, 'children' | 'render' | 'disabled'> & {
  label: string;
  command?: CommandId;
  keys?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  disabled?: boolean;
  children: ReactElement;
};
export function Tooltip({ label, command, keys: keysOverride, side = 'bottom', sideOffset = 6, disabled = false, children, ...rest }: TooltipProps) {
  const tooltipId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const owner = useContext(ModalOverlayScope);
  const modal = useContext(ActiveModalScope);
  const blocked = disabled || (modal !== null && modal !== owner);
  const keys = keysOverride ?? (command ? keysFor(command)[0] : undefined);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(dismissTooltipEvent, close);
    return () => window.removeEventListener(dismissTooltipEvent, close);
  }, []);
  const describedBy = [rest['aria-describedby'], (children.props as { 'aria-describedby'?: string })['aria-describedby'], blocked ? undefined : tooltipId].filter(Boolean).join(' ') || undefined;
  return <BaseTooltip.Root disabled={blocked} open={open && !blocked} onOpenChange={next => {
    const element = trigger.current;
    const text = element?.textContent?.trim().replace(/\s+/g, ' ');
    const truncated = element && [element, ...element.querySelectorAll<HTMLElement>('*')].some(node => node.scrollWidth > node.clientWidth);
    const duplicate = !keys && text === label.trim().replace(/\s+/g, ' ') && !truncated;
    const active = activeModalScope();
    setOpen(next && !duplicate && !element?.closest('[data-popup-open]') && (!active || active === owner));
  }}>
    <BaseTooltip.Trigger {...rest} ref={trigger} onClick={event => { setOpen(false); rest.onClick?.(event); }} aria-describedby={describedBy} render={children} />
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner {...overlayPosition} side={side} sideOffset={Math.max(overlayPosition.sideOffset, sideOffset)} data-overlay-owner={owner ?? undefined} className="overlay-tooltip">
        <BaseTooltip.Popup id={tooltipId} role="tooltip" className="overlay-tooltip-content flex items-center gap-2 rounded-sm border border-line-strong bg-popup px-2 py-1 text-sm text-text shadow-popup transition-[opacity,translate] duration-(--duration-ui) ease-out data-ending-style:translate-y-0.5 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:translate-y-0.5 data-starting-style:opacity-0">
          <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>{keys && <Kbd keys={keys} />}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  </BaseTooltip.Root>;
}
