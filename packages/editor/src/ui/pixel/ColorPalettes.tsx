import { useRef, useState } from 'react';
import { MAX_COLOR_PALETTES, MAX_PALETTE_COLORS } from '@smap/core';
import { t } from '../../i18n';
import { useProjectLibrary } from '../../io/projectLibrary';
import { editColorPalette } from '../../io/colorPaletteIo';
import { useColorPanel } from '../../state/colorPanel';
import { usePixelColors } from '../../state/pixelColors';
import { runCommand } from '../../commands/registry';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { NativeSelect } from '../primitives/NativeSelect';
import { TextField } from '../primitives/TextField';
import { Tooltip } from '../primitives/Tooltip';
import { ColorSwatch } from './ColorSwatch';

export function ColorPalettes() {
  const palettes = useProjectLibrary(s => s.colorPalettes), selected = useColorPanel(s => s.palette), target = useColorPanel(s => s.target);
  const index = Math.min(selected, Math.max(0, palettes.length - 1)), palette = palettes[index];
  const [draft, setDraft] = useState<string | null>(null), colorIndex = useColorPanel(s => s.colorIndex);
  const setColorIndex = (colorIndex: number | null) => useColorPanel.setState({ colorIndex });
  const cancelRename = useRef(false);
  const replace = (colors: readonly string[]) => { if (palette) editColorPalette({ type: 'replace', index, palette: { ...palette, colors } }); };
  const reorder = (delta: number) => {
    if (!palette || colorIndex === null) return;
    const to = colorIndex + delta; if (to < 0 || to >= palette.colors.length) return;
    const colors = [...palette.colors]; [colors[to], colors[colorIndex]] = [colors[colorIndex]!, colors[to]!]; replace(colors); setColorIndex(to);
  };
  const rename = () => {
    if (!cancelRename.current && palette && draft?.trim() && draft.trim() !== palette.name) editColorPalette({ type: 'replace', index, palette: { ...palette, name: draft.trim() } });
    cancelRename.current = false; setDraft(null);
  };
  return <section className="flex shrink-0 flex-col gap-2 border-t border-line-subtle pt-3" data-color-palettes>
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-medium text-muted">{t('colorPanel.palettes')}</h3><div className="flex gap-1">
      <Tooltip label={t('colorPanel.newPalette')}><IconButton size="sm" aria-label={t('colorPanel.newPalette')} disabled={palettes.length >= MAX_COLOR_PALETTES} onClick={() => { editColorPalette({ type: 'add', palette: { name: t('colorPanel.defaultPalette', { number: palettes.length + 1 }), colors: [] } }); useColorPanel.setState({ palette: palettes.length }); setDraft(null); setColorIndex(null); }}><Icon name="plus" size={16} /></IconButton></Tooltip>
      <Tooltip label={t('colorPanel.load')}><IconButton size="sm" aria-label={t('colorPanel.load')} onClick={() => runCommand('colorPalette.load')}><Icon name="folder-open" size={16} /></IconButton></Tooltip>
      <Tooltip label={t('colorPanel.save')}><IconButton size="sm" aria-label={t('colorPanel.save')} disabled={!palette} onClick={() => { useColorPanel.setState({ palette: index }); runCommand('colorPalette.save'); }}><Icon name="save" size={16} /></IconButton></Tooltip>
    </div></div>
    {palette ? <>
      {palettes.length > 1 && <NativeSelect size="sm" aria-label={t('colorPanel.palettes')} value={index} onChange={e => { useColorPanel.setState({ palette: Number(e.target.value) }); setDraft(null); setColorIndex(null); }}>{palettes.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</NativeSelect>}
      <div className="flex items-center gap-1"><TextField size="md" className="min-w-0 flex-1" aria-label={t('colorPanel.paletteName')} maxLength={256} value={draft ?? palette.name} onChange={e => setDraft(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelRename.current = true; setDraft(null); e.currentTarget.blur(); } }} /><Tooltip label={t('colorPanel.removePalette')}><IconButton size="sm" aria-label={t('colorPanel.removePalette')} onClick={() => { editColorPalette({ type: 'remove', index }); setDraft(null); setColorIndex(null); }}><Icon name="trash-2" size={16} /></IconButton></Tooltip></div>
      <div className="color-palette-well rounded-sm border border-line-subtle bg-field p-2">
        <div className="color-swatches flex flex-wrap gap-1.5" role="group" aria-label={t('colorPanel.paletteColors')}>{palette.colors.map((color, i) => <ColorSwatch key={`${i}-${color}`} color={color} active={i === colorIndex} onClick={() => { const s = usePixelColors.getState(); (target === 'fg' ? s.setFg : s.setBg)(color); s.addRecent(color); setColorIndex(i); }} />)}</div>
        {palette.colors.length === 0 && <p className="text-xs text-faint">{t('colorPanel.paletteEmpty')}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><Button size="sm" variant="secondary" disabled={palette.colors.length >= MAX_PALETTE_COLORS} onClick={() => { replace([...palette.colors, usePixelColors.getState()[target]]); setColorIndex(palette.colors.length); }}><Icon name="plus" size={14} />{t('colorPanel.addColor')}</Button>
        <div className="flex items-center gap-1"><Tooltip label={t('colorPanel.previous')}><IconButton size="sm" aria-label={t('colorPanel.previous')} disabled={colorIndex === null || colorIndex <= 0 || colorIndex >= palette.colors.length} onClick={() => reorder(-1)}><Icon name="chevron-left" size={16} /></IconButton></Tooltip>
        <Tooltip label={t('colorPanel.next')}><IconButton size="sm" aria-label={t('colorPanel.next')} disabled={colorIndex === null || colorIndex >= palette.colors.length - 1} onClick={() => reorder(1)}><Icon name="chevron-right" size={16} /></IconButton></Tooltip>
        <Tooltip label={t('colorPanel.removeColor')}><IconButton size="sm" aria-label={t('colorPanel.removeColor')} disabled={colorIndex === null || colorIndex >= palette.colors.length} onClick={() => { replace(palette.colors.filter((_, i) => i !== colorIndex)); setColorIndex(null); }}><Icon name="minus" size={16} /></IconButton></Tooltip></div>
      </div>
    </> : <p className="rounded-sm border border-line-subtle bg-field p-3 text-xs text-faint">{t('colorPanel.palettesEmpty')}</p>}
  </section>;
}
