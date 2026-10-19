import { useEffect, useRef, useState } from 'react';
import { FLIP_D, FLIP_H, FLIP_V } from '@smap/core';
import { runCommand } from '../commands/registry';
import { t } from '../i18n';
import { Button, IconButton } from '../ui/primitives/Button';
import { Icon } from '../ui/primitives/Icon';
import { Tooltip } from '../ui/primitives/Tooltip';
import { SectionHeader } from '../ui/inspector/parts';
import { closeTileUsages, jumpToUsage, useTileUsages } from './usageActions';

const PAGE_SIZE = 50;
export function UsageResults() {
  const state = useTileUsages();
  const { current, results } = state;
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setPage(Math.floor(Math.max(0, current) / PAGE_SIZE)); }, [current, results]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-usage-result="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current, page]);
  if (state.status === 'idle') return null;
  const start = page * PAGE_SIZE;
  const disabled = state.stale || state.status !== 'ready';
  return <section data-tile-usages aria-label={t('tileUsage.title')}>
    <SectionHeader extra={<Tooltip label={t('common.close')}><IconButton size="sm" aria-label={t('common.close')} onClick={closeTileUsages}><Icon name="x" size={12} /></IconButton></Tooltip>}>{t('tileUsage.title')}</SectionHeader>
    <div className="flex flex-col gap-2 px-3 pb-3 text-sm">
      <p role="status" className="text-muted">{state.status === 'loading' ? t('tileUsage.loading') : state.status === 'error' ? t('tileUsage.error') : state.stale ? t('tileUsage.changed') : t('tileUsage.count', { count: state.results.length })}</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" disabled={state.status === 'loading'} onClick={() => runCommand('usage.refresh')}>{t('tileUsage.refresh')}</Button>
        <Tooltip label={t('tileUsage.previous')} command="usage.previous"><IconButton size="sm" disabled={disabled || !state.results.length} aria-label={t('tileUsage.previous')} onClick={() => runCommand('usage.previous')}><Icon name="chevron-left" size={16} /></IconButton></Tooltip>
        <Tooltip label={t('tileUsage.next')} command="usage.next"><IconButton size="sm" disabled={disabled || !state.results.length} aria-label={t('tileUsage.next')} onClick={() => runCommand('usage.next')}><Icon name="chevronRight" size={16} /></IconButton></Tooltip>
      </div>
      <div ref={listRef} role="list" aria-label={t('tileUsage.results')} className="flex flex-col">
        {state.results.slice(start, start + PAGE_SIZE).map((result, i) => {
          const flips = [result.flags & FLIP_H ? t('tileUsage.flipH') : '', result.flags & FLIP_V ? t('tileUsage.flipV') : '', result.flags & FLIP_D ? t('tileUsage.flipD') : ''].filter(Boolean).join(', ') || t('tileUsage.noFlip');
          return <div role="listitem" key={start + i}>
            <button type="button" disabled={disabled} data-usage-result={start + i} data-usage-map={result.mapId} data-usage-x={result.x} data-usage-y={result.y} aria-current={state.current === start + i ? 'location' : undefined}
              className="flex w-full flex-col items-start rounded-sm px-2 py-1 text-left outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent aria-[current=location]:bg-active disabled:opacity-50"
              onClick={() => { void jumpToUsage(start + i); }}>
              <span className="max-w-full truncate text-text">{t('tileUsage.mapCount', { name: result.mapName, count: state.counts[result.mapId] ?? 0 })}</span>
              <span className="max-w-full truncate text-muted">{t('tileUsage.cell', { layer: result.layerName, x: result.x, y: result.y, tile: result.tileId })}</span>
              <span className="text-xs text-faint">{flips}</span>
            </button>
          </div>;
        })}
      </div>
      {state.results.length > PAGE_SIZE && <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={disabled || !page} onClick={() => setPage(page - 1)}>{t('tileUsage.previousPage')}</Button>
        <span className="text-faint">{t('tileUsage.page', { page: page + 1, total: Math.ceil(state.results.length / PAGE_SIZE) })}</span>
        <Button size="sm" variant="secondary" disabled={disabled || start + PAGE_SIZE >= state.results.length} onClick={() => setPage(page + 1)}>{t('tileUsage.nextPage')}</Button>
      </div>}
    </div>
  </section>;
}
