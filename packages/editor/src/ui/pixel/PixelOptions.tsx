import { ColorSwatch } from './ColorSwatch';
import { useShallow } from "zustand/react/shallow";
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
import { useColorPanel } from '../../state/colorPanel';
import { revealPanel } from '../layout/dockStore';

export function ModeSelector({ disabled = false }: { disabled?: boolean }) {
  const mode = usePixelUi(s => s.mode);
  const temporary = useEditorStore(s => s.project?.levelId?.startsWith('stamp:') ?? false);
  const selector = <Segmented label={t('pixel.mode')} value={mode} disabled={disabled || temporary} data-pixel-mode onValueChange={next => usePixelUi.getState().setMode(next)} items={[{ value: 'tile', label: t('pixel.tile') }, { value: 'pixel', label: t('pixel.pixel') }]} />;
  return temporary ? <Tooltip label={t('pixel.mapsOnly')}><span className="inline-flex">{selector}</span></Tooltip> : selector;
}
function Swatch({ background = false }: { background?: boolean }) {
  const value = usePixelColors(s => background ? s.bg : s.fg);
  const label = t(background ? 'pixel.background' : 'pixel.foreground');
  return <ColorSwatch color={value} label={label} quick={background ? 'bg' : 'fg'} onClick={() => { useColorPanel.setState({ target: background ? 'bg' : 'fg', view: 'picker' }); revealPanel('color'); }} />;
}
export function PixelOptions() {
  const tool = useEditorStore(s => s.tool), p = usePixelUi(useShallow(s => ({ size: s.size, shape: s.shape, scope: s.scope, fillMode: s.fillMode, filled: s.filled, mirrorH: s.mirrorH, mirrorV: s.mirrorV, pending: s.pending, setSize: s.setSize })));
  return <div data-tool-chip={tool} className="flex w-max items-center gap-2 whitespace-nowrap text-sm text-muted">
    <Swatch /><Swatch background />
    {(tool === 'brush' || tool === 'eraser' || tool === 'line') && <>
      <label className="flex items-center gap-2">{t('pixel.size')}<TextField size="sm" className="w-14" type="number" min={1} max={64} step={1} value={p.size} aria-label={t('pixel.size')} onChange={e => { if (e.target.value) p.setSize(Number(e.target.value)); }} /></label>
      <Segmented label={t('pixel.shape')} value={p.shape} onValueChange={shape => usePixelUi.setState({ shape })} items={[{ value: 'square', label: t('pixel.square') }, { value: 'circle', label: t('pixel.circle') }]} />
    </>}
    <Tooltip label={t('pixel.scopeHelp')}><label className="flex items-center gap-2">{t('pixel.scope')}<NativeSelect size="sm" aria-label={t('pixel.scope')} value={p.scope} onChange={e => usePixelUi.setState({ scope: e.target.value as 'cell' | 'world' })}><option value="cell">{t('pixel.cell')}</option><option value="world">{t('pixel.world')}</option></NativeSelect></label></Tooltip>
    {tool === 'fill' && <Segmented label={t('pixel.fillMode')} value={p.fillMode} onValueChange={fillMode => usePixelUi.setState({ fillMode })} items={[{ value: 'contiguous', label: t('pixel.contiguous') }, { value: 'global', label: t('pixel.global') }]} />}
    {tool === 'rect' && <Segmented label={t('pixel.rectangle')} value={p.filled ? 'filled' : 'outline'} onValueChange={value => usePixelUi.setState({ filled: value === 'filled' })} items={[{ value: 'outline', label: t('pixel.outline') }, { value: 'filled', label: t('pixel.filled') }]} />}
    <div className="flex items-center gap-1"><Toggle checked={p.mirrorH} label={t('pixel.mirrorH')} onChange={mirrorH => usePixelUi.setState({ mirrorH })} /><span>{t('pixel.mirrorH')}</span></div>
    <div className="flex items-center gap-1"><Toggle checked={p.mirrorV} label={t('pixel.mirrorV')} onChange={mirrorV => usePixelUi.setState({ mirrorV })} /><span>{t('pixel.mirrorV')}</span></div>
    {(p.mirrorH || p.mirrorV) && <Tooltip label={t('colorPanel.resetOrigin')}><IconButton size="sm" aria-label={t('colorPanel.resetOrigin')} onClick={() => runCommand('pixel.resetOrigin')}><Icon name="rotate-ccw" size={16} /></IconButton></Tooltip>}
    {p.pending && <span role="status">{t('pixel.pending')}</span>}
  </div>;
}
