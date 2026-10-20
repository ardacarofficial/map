/** Base UI retains focus, safe-polygon submenus and dismissal semantics. */
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
// Import the package entry so the application popover alias cannot recurse.
import { Popover as BasePopover } from '@base-ui/react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { createContext, useCallback, useContext, useEffect, useId, useRef, type ComponentProps, type RefObject } from 'react';
import { canRestoreOverlayFocus, dismissOverlayEvent, dismissTooltips, overlayPosition } from './overlayPolicy';

import { findActiveModalScope } from './overlayDom';

export const ModalOverlayScope = createContext<string | null>(null);

function useDismiss(actions: RefObject<{ close(): void } | null>, open: RefObject<boolean>) {
  useEffect(() => {
    const close = () => { if (open.current) actions.current?.close(); };
    window.addEventListener(dismissOverlayEvent, close);
    return () => window.removeEventListener(dismissOverlayEvent, close);
  }, [actions, open]);
}
function MenuRoot(props: ComponentProps<typeof BaseMenu.Root>) {
  const ref = useRef<BaseMenu.Root.Actions | null>(null);
  const actions = props.actionsRef ?? ref;
  const openRef = useRef(props.open ?? props.defaultOpen ?? false);
  useEffect(() => { if (props.open !== undefined) openRef.current = props.open; }, [props.open]);
  useDismiss(actions, openRef);
  return <BaseMenu.Root {...props} actionsRef={actions} onOpenChange={(open, details) => {
    openRef.current = open;
    if (open) dismissTooltips();
    props.onOpenChange?.(open, details);
  }} />;
}
function ContextRoot(props: ComponentProps<typeof BaseContextMenu.Root>) {
  const ref = useRef<BaseContextMenu.Root.Actions | null>(null);
  const actions = props.actionsRef ?? ref;
  const openRef = useRef(props.open ?? props.defaultOpen ?? false);
  useEffect(() => { if (props.open !== undefined) openRef.current = props.open; }, [props.open]);
  useDismiss(actions, openRef);
  return <BaseContextMenu.Root {...props} actionsRef={actions} onOpenChange={(open, details) => {
    openRef.current = open;
    if (open) dismissTooltips();
    props.onOpenChange?.(open, details);
  }} />;
}
function PopoverRoot(props: ComponentProps<typeof BasePopover.Root>) {
  const ref = useRef<BasePopover.Root.Actions | null>(null);
  const actions = props.actionsRef ?? ref;
  const openRef = useRef(props.open ?? props.defaultOpen ?? false);
  useEffect(() => { if (props.open !== undefined) openRef.current = props.open; }, [props.open]);
  useDismiss(actions, openRef);
  return <BasePopover.Root {...props} actionsRef={actions} onOpenChange={(open, details) => {
    openRef.current = open;
    if (open) dismissTooltips();
    props.onOpenChange?.(open, details);
  }} />;
}
function MenuPositioner(props: ComponentProps<typeof BaseMenu.Positioner>) {
  const owner = useContext(ModalOverlayScope);
  return <BaseMenu.Positioner {...props} {...overlayPosition} data-overlay-policy="" data-overlay-owner={owner ?? undefined} />;
}
function ContextPositioner(props: ComponentProps<typeof BaseContextMenu.Positioner>) {
  const owner = useContext(ModalOverlayScope);
  return <BaseContextMenu.Positioner {...props} {...overlayPosition} data-overlay-policy="" data-overlay-owner={owner ?? undefined} />;
}
function PopoverPositioner(props: ComponentProps<typeof BasePopover.Positioner>) {
  const owner = useContext(ModalOverlayScope);
  return <BasePopover.Positioner {...props} {...overlayPosition} data-overlay-policy="" data-overlay-owner={owner ?? undefined} />;
}
function returnFocusTarget(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const popup = active.closest('[role="menu"]');
  const label = popup?.getAttribute('aria-labelledby');
  return (label ? document.getElementById(label) : null) ?? active;
}
function useReturnFocus(owner: string) {
  const target = useRef(returnFocusTarget());
  return useCallback(() => {
    const active = document.activeElement;
    const outside = active instanceof HTMLElement && active !== document.body && active !== document.documentElement
      && !active.hasAttribute('data-base-ui-focus-guard') && active.isConnected
      && active.closest<HTMLElement>('[data-overlay-modal]')?.dataset.overlayModal !== owner;
    if (!canRestoreOverlayFocus(owner, findActiveModalScope(), outside)) return false;
    return target.current?.isConnected && target.current.getClientRects().length ? target.current : document.querySelector<HTMLElement>('[data-canvas-host]');
  }, [owner]);
}
function DialogPopup(props: ComponentProps<typeof BaseDialog.Popup>) {
  const id = useId();
  const finalFocus = useReturnFocus(id);
  return <ModalOverlayScope.Provider value={id}><BaseDialog.Popup finalFocus={finalFocus} {...props} data-overlay-modal={id} /></ModalOverlayScope.Provider>;
}
function AlertPopup(props: ComponentProps<typeof BaseAlertDialog.Popup>) {
  const id = useId();
  const finalFocus = useReturnFocus(id);
  return <ModalOverlayScope.Provider value={id}><BaseAlertDialog.Popup finalFocus={finalFocus} {...props} data-overlay-modal={id} /></ModalOverlayScope.Provider>;
}
export const Menu = { ...BaseMenu, Root: MenuRoot, Positioner: MenuPositioner };
export const ContextMenu = { ...BaseContextMenu, Root: ContextRoot, Positioner: ContextPositioner };
export const Popover = { ...BasePopover, Root: PopoverRoot, Positioner: PopoverPositioner };
export const Dialog = { ...BaseDialog, Popup: DialogPopup };
export const AlertDialog = { ...BaseAlertDialog, Popup: AlertPopup };
