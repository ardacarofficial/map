import { registerColorCommands } from './colorCommands';
import { registerCommands } from './registry';
import { useEditorStore } from '../state/editorStore';
import { usePixelUi } from '../state/pixelUi';
import { usePixelColors } from '../state/pixelColors';
import { isWorldView } from './worldActions';
export function registerPixelCommands(): void {
  registerColorCommands();
  const ready = () => !!useEditorStore.getState().project && !useEditorStore.getState().project?.levelId?.startsWith('stamp:') && !isWorldView();
  const pixel = () => ready() && usePixelUi.getState().mode === 'pixel';
  registerCommands([
    { id: 'pixel.mode', title: 'pixel.modeCommand', category: 'tool', enabled: ready, run: () => { const s = usePixelUi.getState(); s.setMode(s.mode === 'tile' ? 'pixel' : 'tile'); } },
    { id: 'tool.line', title: 'pixel.line', category: 'tool', enabled: pixel, run: () => useEditorStore.getState().setTool('line') },
    { id: 'pixel.swap', title: 'pixel.swap', category: 'tool', enabled: pixel, run: () => usePixelColors.getState().swap() },
    { id: 'pixel.reset', title: 'pixel.reset', category: 'tool', enabled: pixel, run: () => usePixelColors.getState().reset() },
  ]);
}
