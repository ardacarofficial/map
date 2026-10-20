import { useRef, useState } from 'react';
import { parseHex } from '@smap/core';
import { t } from '../../i18n';
import { usePixelColors } from '../../state/pixelColors';
import { useColorPanel } from '../../state/colorPanel';
import { colorFields, hsvFromField } from '../../state/colorFields';
import { TextField } from '../primitives/TextField';
import { Segmented } from '../primitives/Segmented';

export function ColorFields() {
  const target = useColorPanel(s => s.target), mode = useColorPanel(s => s.mode);
  const hex = usePixelColors(s => s[target]), hue = usePixelColors(s => target === 'fg' ? s.fgHsv.h : s.bgHsv.h);
  // Each draft belongs to its focused field; no conversion changes the cursor mid-typing.
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const cancelBlur = useRef(false);
  const channels = colorFields(hex, mode, hue), labels = mode === 'rgb' ? ['colorPanel.red', 'colorPanel.green', 'colorPanel.blue', 'colorPanel.alpha'] as const : ['colorPanel.hue', 'colorPanel.saturation', 'colorPanel.lightness', 'colorPanel.alpha'] as const;
  const choose = (value: string) => { const c = usePixelColors.getState(); (target === 'fg' ? c.setFg : c.setBg)(value); c.addRecent(value); };
  const commit = () => {
    if (cancelBlur.current) { cancelBlur.current = false; return; }
    if (!draft) return;
    if (draft.key === 'hex') { if (parseHex(draft.text)) choose(draft.text); }
    else {
      const colors = usePixelColors.getState();
      const next = hsvFromField(colors[target === 'fg' ? 'fgHsv' : 'bgHsv'], mode, Number(draft.key), draft.text);
      if (next) { colors.setHsv(target, next); colors.addRecent(usePixelColors.getState()[target]); }
    }
    setDraft(null);
  };
  return <div className="flex flex-col gap-2" data-color-fields>
    <Segmented label={t('colorPanel.fields')} value={mode} onValueChange={next => { commit(); useColorPanel.setState({ mode: next }); }} items={[{ value: 'rgb', label: t('colorPanel.rgb') }, { value: 'hsl', label: t('colorPanel.hsl') }]} />
    <div className="grid grid-cols-2 gap-2">{channels.map((value, index) => {
      const key = String(index), text = draft?.key === key ? draft.text : String(value), invalid = !text.trim() || !Number.isFinite(Number(text));
      return <label key={index} className="flex min-w-0 items-center gap-2 text-sm text-muted"><span>{t(labels[index]!)}</span><TextField size="sm" className="w-full min-w-0" type="number" aria-label={t(labels[index]!)} value={text} min={0} max={mode === 'rgb' || index === 3 ? 255 : index === 0 ? 359 : 100} step={1} aria-invalid={invalid || undefined} onChange={e => setDraft({ key, text: e.target.value })} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelBlur.current = true; setDraft(null); e.currentTarget.blur(); } }} /></label>;
    })}</div>
    <label className="flex items-center gap-2 text-sm text-muted">{t('colorPanel.hex')}<TextField size="sm" className="min-w-0 flex-1" aria-label={t('pixel.hex')} spellCheck={false} value={draft?.key === 'hex' ? draft.text : hex} aria-invalid={draft?.key === 'hex' && !parseHex(draft.text) || undefined} onChange={e => setDraft({ key: 'hex', text: e.target.value })} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelBlur.current = true; setDraft(null); e.currentTarget.blur(); } }} /></label>
    {draft && (draft.key === 'hex' ? !parseHex(draft.text) : !draft.text.trim() || !Number.isFinite(Number(draft.text))) && <span role="status" className="text-xs text-muted">{t('colorPanel.invalid')}</span>}
  </div>;
}
