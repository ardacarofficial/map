import { Tooltip } from '../primitives/Tooltip';
import { t } from '../../i18n';
/** Swatch RGBA is content; transparency chrome is drawn from checker tokens. */
export function ColorSwatch({ color, label, caption, active = false, onClick, onContextMenu, quick }: { color: string; label?: string; caption?: string; active?: boolean; onClick(): void; onContextMenu?(): void; quick?: 'fg' | 'bg' }) {
  return <Tooltip label={label ?? t('colorPanel.color', { color })}><button type="button" data-pixel-swatch={quick} aria-label={label ?? t('colorPanel.color', { color })} aria-pressed={active} className={`${caption ? 'color-target' : 'color-swatch size-color-swatch'} shrink-0 rounded-sm border outline-offset-2 focus-visible:outline focus-visible:outline-accent ${active ? 'border-accent bg-accent-soft' : 'border-control-border'} ${caption ? 'hover:bg-hover' : 'hover:border-title'}`} onClick={onClick} onContextMenu={e => { if (onContextMenu) { e.preventDefault(); onContextMenu(); } }}>
    <span className="color-swatch-preview relative block shrink-0 overflow-hidden rounded-xs bg-checker-a">
      <span className="grid size-full grid-cols-2 grid-rows-2"><span className="bg-checker-b" /><span /><span /><span className="bg-checker-b" /></span>
      <span className="absolute inset-0" style={{ backgroundColor: color }} />
    </span>
    {caption && <span className="flex min-w-0 flex-col gap-0.5 text-left"><span className={`truncate text-sm ${active ? 'text-title' : 'text-muted'}`}>{caption}</span><span className="truncate text-xs text-faint tabular-nums">{color.slice(0, 7).toUpperCase()}</span></span>}
  </button></Tooltip>;
}
