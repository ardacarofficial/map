import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { usePixelColors } from '../../state/pixelColors';
import { useColorPanel } from '../../state/colorPanel';
import { drawColorControl, type ColorControl } from './colorCanvas';

function Control({ control }: { control: ColorControl }) {
  const target = useColorPanel(s => s.target), hsv = usePixelColors(s => target === 'fg' ? s.fgHsv : s.bgHsv);
  const ref = useRef<HTMLCanvasElement>(null), dragging = useRef<{ id: number; before: typeof hsv } | null>(null);
  useEffect(() => { if (ref.current) drawColorControl(ref.current, control, hsv); }, [control, hsv]);
  const update = (x: number, y: number) => {
    const box = ref.current!.getBoundingClientRect(), h = usePixelColors.getState()[target === 'fg' ? 'fgHsv' : 'bgHsv'];
    const px = Math.max(0, Math.min(1, (x - box.left) / box.width)), py = Math.max(0, Math.min(1, (y - box.top) / box.height));
    usePixelColors.getState().setHsv(target, control === 'square' ? { ...h, s: px, v: 1 - py } : control === 'hue' ? { ...h, h: px * 359 } : { ...h, a: px * 255 });
  };
  const label = t(control === 'square' ? 'colorPanel.sv' : control === 'hue' ? 'colorPanel.hue' : 'colorPanel.alpha');
  return <canvas ref={ref} width={160} height={control === 'square' ? 160 : 24} data-color-control={control} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={control === 'square' ? 100 : control === 'hue' ? 359 : 255} aria-valuenow={Math.round(control === 'square' ? hsv.s * 100 : control === 'hue' ? Math.min(359, hsv.h) : hsv.a)} aria-valuetext={control === 'square' ? t('colorPanel.svValue', { saturation: Math.round(hsv.s * 100), value: Math.round(hsv.v * 100) }) : undefined}
    className={`${control === 'square' ? 'size-color-square' : 'h-color-swatch w-color-square'} shrink-0 touch-none rounded-xs border border-control-border outline-offset-2 focus-visible:outline focus-visible:outline-accent`}
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); dragging.current = { id: e.pointerId, before: usePixelColors.getState()[target === 'fg' ? 'fgHsv' : 'bgHsv'] }; e.currentTarget.setPointerCapture(e.pointerId); update(e.clientX, e.clientY); }}
    onPointerMove={e => { if (dragging.current?.id === e.pointerId) update(e.clientX, e.clientY); }}
    onPointerUp={e => { if (dragging.current?.id !== e.pointerId) return; update(e.clientX, e.clientY); dragging.current = null; e.currentTarget.releasePointerCapture(e.pointerId); usePixelColors.getState().addRecent(usePixelColors.getState()[target]); }}
    onLostPointerCapture={() => { if (dragging.current) usePixelColors.getState().setHsv(target, dragging.current.before); dragging.current = null; }}
    onPointerCancel={() => { if (dragging.current) usePixelColors.getState().setHsv(target, dragging.current.before); dragging.current = null; }}
    onKeyDown={e => { if (e.key === 'Escape' && dragging.current) { e.preventDefault(); const id = dragging.current.id; usePixelColors.getState().setHsv(target, dragging.current.before); dragging.current = null; e.currentTarget.releasePointerCapture(id); } }} />;
}
export function HsvPicker() { return <div className="flex flex-col gap-2"><Control control="square" /><Control control="hue" /><Control control="alpha" /></div>; }
