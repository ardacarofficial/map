import { t } from '../../i18n';
/** Swatch RGBA is content; transparency chrome is drawn from checker tokens. */
export function ColorSwatch({ color, label, active = false, onClick, onContextMenu, quick }: { color: string; label?: string; active?: boolean; onClick(): void; onContextMenu?(): void; quick?: 'fg' | 'bg' }) {
  return <button type="button" data-pixel-swatch={quick} aria-label={label ?? t('colorPanel.color', { color })} title={label ?? color} aria-pressed={active} className={`size-color-swatch shrink-0 overflow-hidden rounded-xs border ${active ? 'border-accent' : 'border-control-border'} bg-checker-a`} onClick={onClick} onContextMenu={e => { if (onContextMenu) { e.preventDefault(); onContextMenu(); } }}>
    <span className="grid size-full grid-cols-2 grid-rows-2"><span className="bg-checker-b" /><span /><span /><span className="bg-checker-b" /></span>
    <span className="relative -top-full block size-full" style={{ backgroundColor: color }} />
  </button>;
}
