import { usePixelUi } from '../../state/pixelUi';
import { t } from '../../i18n';
import { runCommand } from '../../commands/registry';
import { usePixelColors } from '../../state/pixelColors';
import { useColorPanel } from '../../state/colorPanel';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Tooltip } from '../primitives/Tooltip';
import { ColorFields } from './ColorFields';
import { HsvPicker } from './HsvPicker';
import { ColorPalettes } from './ColorPalettes';
import { ColorSwatch } from './ColorSwatch';

export function ColorPanel() {
  const pixel = usePixelUi(s => s.mode === 'pixel');
  const colors = usePixelColors(), target = useColorPanel(s => s.target);
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2" data-color-panel>
    <div className="flex items-center gap-2">{(['fg', 'bg'] as const).map(id => <ColorSwatch key={id} color={colors[id]} label={t(id === 'fg' ? 'colorPanel.editFg' : 'colorPanel.editBg')} active={target === id} onClick={() => useColorPanel.setState({ target: id })} />)}
      <Tooltip label={t('pixel.swap')} command="pixel.swap"><IconButton size="sm" disabled={!pixel} aria-label={t('pixel.swap')} onClick={() => runCommand('pixel.swap')}><Icon name="arrow-left-right" size={16} /></IconButton></Tooltip>
      <Tooltip label={t('pixel.reset')} command="pixel.reset"><IconButton size="sm" disabled={!pixel} aria-label={t('pixel.reset')} onClick={() => runCommand('pixel.reset')}><Icon name="rotate-ccw" size={16} /></IconButton></Tooltip>
      <span className="text-sm text-muted">{t(target === 'fg' ? 'pixel.foreground' : 'pixel.background')}</span>
    </div>
    <HsvPicker /><ColorFields key={target} />
    <section className="flex flex-col gap-2 border-t border-line-subtle pt-3"><h3 className="text-xs text-muted">{t('colorPanel.recent')}</h3><div className="flex flex-wrap gap-1" data-color-recents>{colors.recent.map(color => <ColorSwatch key={color} color={color} onClick={() => { (target === 'fg' ? colors.setFg : colors.setBg)(color); colors.addRecent(color); }} />)}</div></section>
    <ColorPalettes />
  </div>;
}
