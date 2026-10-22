import { usePixelUi } from '../../state/pixelUi';
import { t } from '../../i18n';
import { runCommand } from '../../commands/registry';
import { usePixelColors } from '../../state/pixelColors';
import { useColorPanel } from '../../state/colorPanel';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Segmented } from '../primitives/Segmented';
import { Tooltip } from '../primitives/Tooltip';
import { ColorFields } from './ColorFields';
import { HsvPicker } from './HsvPicker';
import { ColorPalettes } from './ColorPalettes';
import { ColorSwatch } from './ColorSwatch';
import './colorPanel.css';

export function ColorPanel() {
  const pixel = usePixelUi(s => s.mode === 'pixel');
  const colors = usePixelColors(), target = useColorPanel(s => s.target), view = useColorPanel(s => s.view);
  return <div className="color-panel flex min-h-0 min-w-0 flex-1 flex-col" data-color-panel>
    <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle p-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented label={t('colorPanel.views')} value={view} onValueChange={next => useColorPanel.setState({ view: next })} items={[{ value: 'picker', label: t('colorPanel.title'), attrs: { 'aria-label': t('colorPanel.picker') } }, { value: 'palettes', label: t('tilesetList.palettes') }]} />
        <div className="flex items-center gap-1"><Tooltip label={t('pixel.swap')} command="pixel.swap"><IconButton size="sm" disabled={!pixel} aria-label={t('pixel.swap')} onClick={() => runCommand('pixel.swap')}><Icon name="arrow-left-right" size={16} /></IconButton></Tooltip>
        <Tooltip label={t('pixel.reset')} command="pixel.reset"><IconButton size="sm" disabled={!pixel} aria-label={t('pixel.reset')} onClick={() => runCommand('pixel.reset')}><Icon name="rotate-ccw" size={16} /></IconButton></Tooltip></div>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2">{(['fg', 'bg'] as const).map(id => <ColorSwatch key={id} color={colors[id]} caption={t(id === 'fg' ? 'pixel.foreground' : 'pixel.background')} label={t(id === 'fg' ? 'colorPanel.editFg' : 'colorPanel.editBg')} active={target === id} onClick={() => useColorPanel.setState({ target: id })} />)}</div>
    </div>
    <div className="color-panel-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2" data-color-view={view}>
      {view === 'picker' ? <><HsvPicker /><ColorFields key={target} /></> : <>
        <section className="flex shrink-0 flex-col gap-2"><h3 className="text-xs font-medium text-muted">{t('colorPanel.recent')}</h3><div className="color-swatches flex flex-wrap gap-1.5" data-color-recents>{colors.recent.map(color => <ColorSwatch key={color} color={color} onClick={() => { (target === 'fg' ? colors.setFg : colors.setBg)(color); colors.addRecent(color); }} />)}{colors.recent.length === 0 && <p className="text-xs text-faint">{t('colorPanel.recentEmpty')}</p>}</div></section>
        <ColorPalettes />
      </>}
    </div>
  </div>;
}
