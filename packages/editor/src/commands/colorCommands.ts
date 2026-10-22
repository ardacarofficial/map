import { registerCommands } from './registry';
import { usePixelUi } from '../state/pixelUi';
import { useColorPanel } from '../state/colorPanel';
import { usePixelColors } from '../state/pixelColors';
import { useProjectLibrary } from '../io/projectLibrary';
import { getLevelWorkspace } from '../io/session';
import { saveColorPalette, loadColorPalette } from '../io/colorPaletteIo';
import { useEditorStore } from '../state/editorStore';
import { isWorldView } from './worldActions';
import { revealPanel } from '../ui/layout/dockStore';

export function registerColorCommands(): void {
  const ready = () => !!useEditorStore.getState().project && !useEditorStore.getState().project?.levelId?.startsWith('stamp:') && !isWorldView();
  const control = () => typeof document === 'undefined' ? null : document.activeElement?.getAttribute('data-color-control');
  registerCommands([
    { id: 'colorPalette.load', title: 'colorPanel.load', category: 'file', enabled: ready, run: () => { useColorPanel.setState({ view: 'palettes' }); revealPanel('color'); void loadColorPalette(); } },
    { id: 'colorPalette.save', title: 'colorPanel.save', category: 'file', enabled: () => ready() && useProjectLibrary.getState().colorPalettes.length > 0, run: () => { useColorPanel.setState({ view: 'palettes' }); revealPanel('color'); void saveColorPalette(); } },
    { id: 'pixel.resetOrigin', title: 'colorPanel.resetOrigin', category: 'tool', enabled: () => ready() && usePixelUi.getState().mode === 'pixel', run: () => { const store = getLevelWorkspace()?.active.store; if (store) { usePixelUi.getState().mirrorOrigins.delete(store); usePixelUi.setState(s => ({ originRevision: s.originRevision + 1 })); } } },
    ...(['left', 'right', 'up', 'down', 'leftFast', 'rightFast', 'upFast', 'downFast'] as const).map(direction => ({
      id: `color.${direction}` as const, title: `colorPanel.${direction}` as const, category: 'tool' as const, inPalette: false,
      enabled: () => ready() && !!control(),
      run: () => {
        const target = useColorPanel.getState().target, colors = usePixelColors.getState(), hsv = colors[target === 'fg' ? 'fgHsv' : 'bgHsv'];
        const step = direction.endsWith('Fast') ? 10 : 1, positive = direction.startsWith('right') || direction.startsWith('up'), delta = positive ? step : -step;
        const kind = control();
        colors.setHsv(target, kind === 'square' ? direction.startsWith('left') || direction.startsWith('right') ? { ...hsv, s: hsv.s + delta / 100 } : { ...hsv, v: hsv.v + delta / 100 } : kind === 'hue' ? { ...hsv, h: hsv.h + delta } : { ...hsv, a: hsv.a + delta });
        colors.addRecent(usePixelColors.getState()[target]);
      },
    })),
  ]);
}
