import { ColorPaletteStore, COLORS_FILE_SUFFIX, parseColorPalette, serializeColorPalette, type ColorPaletteOp } from '@smap/core';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import { deliverFile } from '../export/exportActions';
import { useColorPanel } from '../state/colorPanel';
import { toast } from '../ui/toast/toastStore';
import { useProjectLibrary } from './projectLibrary';
import { getLevelWorkspace } from './session';

const stores = new WeakMap<NonNullable<ReturnType<typeof getLevelWorkspace>>, ColorPaletteStore>();
export function editColorPalette(op: ColorPaletteOp): void {
  const ws = getLevelWorkspace(); if (!ws) return;
  let palettes = stores.get(ws);
  if (!palettes) {
    palettes = new ColorPaletteStore(useProjectLibrary.getState().colorPalettes);
    stores.set(ws, palettes);
    const store = palettes;
    store.subscribe(() => {
      if (getLevelWorkspace() === ws) useProjectLibrary.setState(s => ({ colorPalettes: store.palettes, revision: s.revision + 1 }));
    });
  }
  palettes.dispatch(op, ws.history, ws.activeId, t('colorPanel.paletteEdit'));
}
export async function saveColorPalette(): Promise<void> {
  const palette = useProjectLibrary.getState().colorPalettes[Math.min(useColorPanel.getState().palette, useProjectLibrary.getState().colorPalettes.length - 1)]; if (!palette) return;
  try { await deliverFile(new Blob([serializeColorPalette(palette)], { type: 'application/json' }), `${palette.name.replace(/[\\/:*?"<>|]/g, '-')}${COLORS_FILE_SUFFIX}`, { name: t('colorPanel.file'), extensions: ['smap-colors.json'] }); }
  catch { toast.error(t('colorPanel.saveFailed')); }
}
export async function loadColorPalette(): Promise<void> {
  const ws = getLevelWorkspace(); if (!ws) return;
  try {
    const file = await getPlatform().openFile?.({ name: t('colorPanel.file'), extensions: ['smap-colors.json'] });
    if (!file || getLevelWorkspace() !== ws) return;
    const palette = parseColorPalette(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
    const index = useProjectLibrary.getState().colorPalettes.length;
    editColorPalette({ type: 'add', palette }); useColorPanel.setState({ palette: index, colorIndex: null, view: 'palettes' });
  } catch { toast.error(t('colorPanel.loadFailed')); }
}
