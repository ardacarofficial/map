import { useShallow } from "zustand/react/shallow";
import { Popover } from '@base-ui/react/popover';
import { useState } from 'react';
import { parseHex } from '@smap/core';
import { t } from '../../i18n';
import { useEditorStore } from '../../state/editorStore';
import { usePixelUi } from '../../state/pixelUi';
import { usePixelColors } from '../../state/pixelColors';
import { runCommand } from '../../commands/registry';
import { Segmented } from '../primitives/Segmented';
import { TextField } from '../primitives/TextField';
import { NativeSelect } from '../primitives/NativeSelect';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Toggle } from "../primitives/Toggle";
import { Tooltip } from '../primitives/Tooltip';
import { menuPopupClass, menuPositionerClass } from '../primitives/menuStyles';

export function ModeSelector({ disabled = false }: { disabled?: boolean }) {
  const mode = usePixelUi(s => s.mode);
  const temporary = useEditorStore(s => s.project?.levelId?.startsWith('stamp:') ?? false);
  return <Segmented label={t('pixel.mode')} value={mode} disabled={disabled || temporary} title={temporary ? t('pixel.mapsOnly') : undefined} data-pixel-mode onValueChange={next => usePixelUi.getState().setMode(next)} items={[{ value: 'tile', label: t('pixel.tile') }, { value: 'pixel', label: t('pixel.pixel') }]} />;
}
function Swatch({ background = false }: { background?: boolean }) {
  const value = usePixelColors(s => background ? s.bg : s.fg);
  const [text, setText] = useState(value);
  const label = t(background ? 'pixel.background' : 'pixel.foreground');
  const commit = () => { const colors = usePixelColors.getState(); if (parseHex(text)) { (background ? colors.setBg : colors.setFg)(text); colors.addRecent(text); } };
  return <Popover.Root onOpenChange={open => { if (open) setText(value); else commit(); }}>
    <Tooltip label={label}><Popover.Trigger aria-label={label} className="size-control-sm shrink-0 rounded-sm border border-line-strong" style={{ backgroundColor: value }} data-pixel-swatch={background ? 'bg' : 'fg'} /></Tooltip>
    <Popover.Portal><Popover.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}><Popover.Popup className={`${menuPopupClass} flex w-56 flex-col gap-2 p-3!`}>
      <Popover.Title className="text-sm text-title">{label}</Popover.Title>
      <label className="flex flex-col gap-1 text-sm text-muted">{t('pixel.hex')}<TextField size="sm" aria-label={t('pixel.hex')} value={text} spellCheck={false} aria-invalid={!parseHex(text) || undefined} onChange={e => { setText(e.target.value); const c = usePixelColors.getState(); if (parseHex(e.target.value)) (background ? c.setBg : c.setFg)(e.target.value); }} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }} /></label>
      {!parseHex(text) && <span role="status" className="text-xs text-muted">{t('pixel.invalidHex')}</span>}
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
export function PixelOptions() {
  const tool = useEditorStore(s => s.tool), p = usePixelUi(useShallow(s => ({ size: s.size, shape: s.shape, scope: s.scope, fillMode: s.fillMode, filled: s.filled, mirrorH: s.mirrorH, mirrorV: s.mirrorV, pending: s.pending, setSize: s.setSize })));
  return <div data-tool-chip={tool} className="flex w-max items-center gap-2 whitespace-nowrap text-sm text-muted">
    <Swatch /><Swatch background />
    <Tooltip label={t('pixel.swap')} command="pixel.swap"><IconButton size="sm" aria-label={t('pixel.swap')} onClick={() => runCommand('pixel.swap')}><Icon name="arrow-left-right" size={16} /></IconButton></Tooltip>
    <Tooltip label={t('pixel.reset')} command="pixel.reset"><IconButton size="sm" aria-label={t('pixel.reset')} onClick={() => runCommand('pixel.reset')}><Icon name="rotate-ccw" size={16} /></IconButton></Tooltip>
    {(tool === 'brush' || tool === 'eraser' || tool === 'line') && <>
      <label className="flex items-center gap-2">{t('pixel.size')}<TextField size="sm" className="w-14" type="number" min={1} max={64} step={1} value={p.size} aria-label={t('pixel.size')} onChange={e => { if (e.target.value) p.setSize(Number(e.target.value)); }} /></label>
      <Segmented label={t('pixel.shape')} value={p.shape} onValueChange={shape => usePixelUi.setState({ shape })} items={[{ value: 'square', label: t('pixel.square') }, { value: 'circle', label: t('pixel.circle') }]} />
    </>}
    <label className="flex items-center gap-2" title={t('pixel.scopeHelp')}>{t('pixel.scope')}<NativeSelect size="sm" aria-label={t('pixel.scope')} value={p.scope} onChange={e => usePixelUi.setState({ scope: e.target.value as 'cell' | 'world' })}><option value="cell">{t('pixel.cell')}</option><option value="world">{t('pixel.world')}</option></NativeSelect></label>
    {tool === 'fill' && <Segmented label={t('pixel.fillMode')} value={p.fillMode} onValueChange={fillMode => usePixelUi.setState({ fillMode })} items={[{ value: 'contiguous', label: t('pixel.contiguous') }, { value: 'global', label: t('pixel.global') }]} />}
    {tool === 'rect' && <Segmented label={t('pixel.rectangle')} value={p.filled ? 'filled' : 'outline'} onValueChange={value => usePixelUi.setState({ filled: value === 'filled' })} items={[{ value: 'outline', label: t('pixel.outline') }, { value: 'filled', label: t('pixel.filled') }]} />}
    <div className="flex items-center gap-1"><Toggle checked={p.mirrorH} label={t('pixel.mirrorH')} onChange={mirrorH => usePixelUi.setState({ mirrorH })} /><span>{t('pixel.mirrorH')}</span></div>
    <div className="flex items-center gap-1"><Toggle checked={p.mirrorV} label={t('pixel.mirrorV')} onChange={mirrorV => usePixelUi.setState({ mirrorV })} /><span>{t('pixel.mirrorV')}</span></div>
    {p.pending && <span role="status">{t('pixel.pending')}</span>}
  </div>;
}
