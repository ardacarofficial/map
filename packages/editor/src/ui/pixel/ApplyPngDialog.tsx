import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useRef } from 'react';
import type { RasterImage } from '@smap/core';
import { choosePngBackup, choosePngVariant, closePngWriteback, confirmPngWriteback, pngCanConfirm, pngReasonKey, pngTileBefore, pngUsageCount, selectPngSource, usePngWriteback, variantGroups, type PngDraft } from '../../commands/pixelWriteback';
import { t } from '../../i18n';
import { getLevelWorkspace, getProjectFolder } from '../../io/session';
import { decodeSourcePng } from '../../io/sourcePng';
import { useEditorStore } from '../../state/editorStore';
import { Button } from '../primitives/Button';
import { NativeSelect } from '../primitives/NativeSelect';
import { Segmented } from '../primitives/Segmented';
import { DialogBody, DialogFooter, DialogHeader, dialogLayoutClass } from '../dialogs/DialogFrame';
import { backdropClass, dialogWidthM, popupClass } from '../dialogs/styles';

function Preview({ image, label }: { image:RasterImage|undefined;label:string }) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const ctx=ref.current?.getContext('2d');if(ctx&&image)ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);},[image]);
  return <figure className="flex shrink-0 flex-col gap-1"><canvas ref={ref} width={image?.width??1} height={image?.height??1} aria-label={label} className="checker size-20 object-contain pixelated" /><figcaption className="text-xs text-muted">{label}</figcaption></figure>;
}
export function ApplyPngDialog() {
  const {draft,busy,error,changed}=usePngWriteback();
  const project=useEditorStore(s=>s.project);
  useEffect(()=>{if(draft&&(getLevelWorkspace()!==draft.ws||getProjectFolder()!==draft.folder))closePngWriteback();},[draft,project]);
  useEffect(()=>draft?.ws.history.subscribe(()=>{if(draft.ws.history.version!==draft.historyVersion)usePngWriteback.setState({changed:true});}),[draft]);
  if(!draft)return null;
  const source=draft.source;
  const groups=source?variantGroups(draft.variants,source):[];
  return <Dialog.Root open onOpenChange={open=>{if(!open)closePngWriteback();}}>
    <Dialog.Portal><Dialog.Backdrop className={backdropClass}/><Dialog.Popup className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`} data-png-writeback-dialog>
      <DialogHeader title={t(draft.mode==='apply'?'pngWriteback.apply':'pngWriteback.restore')} onClose={closePngWriteback}/>
      <DialogBody className="flex flex-col gap-3 text-sm">
        <p>{t('pngWriteback.effect')}</p><p className="text-muted">{t('pngWriteback.undo')}</p>
        <Segmented label={t('pngWriteback.action')} value={draft.mode} disabled={busy} items={[{value:'apply',label:t('pngWriteback.apply')},{value:'restore',label:t('pngWriteback.restore')}]} onValueChange={mode=>{usePngWriteback.setState({draft:{...draft,mode},changed:false});if(source)void selectPngSource(source.id);}}/>
        <label className="flex flex-col gap-2 text-muted">{t('pngWriteback.destination')}<NativeSelect aria-label={t('pngWriteback.destination')} disabled={busy} value={source?.id??''} onChange={e=>{void selectPngSource(e.target.value);}}>{draft.sources.map(s=><option key={s.id} value={s.id}>{s.imagePath}</option>)}</NativeSelect></label>
        {source&&<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1"><dt className="text-muted">{t('pngWriteback.destination')}</dt><dd className="break-all font-mono" data-png-destination>{source.imagePath}</dd><dt className="text-muted">{t('pngWriteback.backup')}</dt><dd className="break-all font-mono" data-png-backup>{draft.backupPath}</dd></dl>}
        {draft.mode==='apply'?<>
          {groups.map(group=><fieldset key={group.tileId} className="flex flex-col gap-2 border-t border-line-subtle pt-3" data-png-source-tile={group.tileId}>
            <legend className="text-text">{t('pngWriteback.sourceTile',{tile:group.tileId})} · {t('pngWriteback.usages',{count:source?pngUsageCount(draft,source.id,group.tileId):0})}</legend>
            {group.variants.length>1&&<p className="text-muted">{t('pngWriteback.conflict')}</p>}
            <div role="radiogroup" aria-label={t('pngWriteback.sourceTile',{tile:group.tileId})} className="flex flex-col gap-2">
              {group.variants.map(v=><button key={v.key} type="button" role="radio" aria-checked={draft.choices[group.tileId]===v.key} disabled={busy} data-png-variant={v.key} onClick={()=>choosePngVariant(group.tileId,v.key)} className="flex items-center gap-3 rounded-sm border border-line-strong p-2 text-left aria-checked:bg-active focus-visible:outline focus-visible:outline-accent disabled:opacity-40">
                <Preview image={pngTileBefore(draft,group.tileId)} label={t('pngWriteback.before')}/><Preview image={v.pixels} label={t('pngWriteback.after')}/>
                <span className="flex flex-col gap-1"><span>{v.edited.name} · {v.tileId}</span><span className="text-muted">{t('pngWriteback.usages',{count:pngUsageCount(draft,v.edited.id,v.tileId)})}</span><span className="text-xs text-muted">{t(draft.choices[group.tileId]===v.key?'pngWriteback.selected':'pngWriteback.choose')}</span></span>
              </button>)}
              <button type="button" role="radio" aria-checked={draft.choices[group.tileId]==='skip'} disabled={busy} onClick={()=>choosePngVariant(group.tileId,'skip')} className="self-start rounded-sm px-2 py-1 text-muted aria-checked:bg-active focus-visible:outline focus-visible:outline-accent">{t('pngWriteback.skip')}</button>
            </div>
          </fieldset>)}
          {!groups.length&&!busy&&<p className="text-muted">{t('pngWriteback.empty')}</p>}
          {draft.variants.filter(v=>v.reason).map(v=><p key={v.key} className="text-muted" data-png-unsupported>{v.edited.name} · {v.tileId} — {t(pngReasonKey(v.reason!))}</p>)}
        </>:<Restore draft={draft} busy={busy}/>}
        {changed&&<div role="alert" className="flex flex-col items-start gap-2"><p>{t('pngWriteback.changed')}</p><Button disabled={busy||!source} onClick={()=>{if(source)void selectPngSource(source.id,true);}}>{t('pngWriteback.reload')}</Button></div>}
        {draft.rebased&&<p role="status" className="text-muted">{t('pngWriteback.reloaded')}</p>}
        {error&&<div role="alert" className="flex flex-col items-start gap-2"><p className="text-danger">{t(error)}</p><Button disabled={busy||!source} onClick={()=>{if(source)void selectPngSource(source.id);}}>{t('pngWriteback.reload')}</Button></div>}
        {busy&&<p role="status" className="text-muted">{t('pngWriteback.busy')}</p>}
      </DialogBody>
      <DialogFooter><Button size="md" disabled={busy} onClick={closePngWriteback}>{t('common.cancel')}</Button><Button size="md" variant="primary" disabled={busy||changed||!!error||!pngCanConfirm(draft)} onClick={()=>{void confirmPngWriteback();}} data-png-confirm>{t(draft.mode==='apply'?'pngWriteback.confirm':'pngWriteback.confirmRestore')}</Button></DialogFooter>
    </Dialog.Popup></Dialog.Portal>
  </Dialog.Root>;
}
function Restore({draft,busy}:{draft:PngDraft;busy:boolean}) {
  const restored=draft.restoreBytes?decodeSourcePng(draft.restoreBytes):null;
  return <>
    <label className="flex flex-col gap-2 text-muted">{t('pngWriteback.backups')}<NativeSelect aria-label={t('pngWriteback.backups')} value={draft.restore??''} disabled={busy||!draft.backups.length} onChange={e=>{void choosePngBackup(e.target.value);}}><option value="" disabled>{t('pngWriteback.chooseBackup')}</option>{draft.backups.map(p=><option key={p} value={p}>{p}</option>)}</NativeSelect></label>
    {!draft.backups.length&&<p className="text-muted">{t('pngWriteback.noBackups')}</p>}
    {restored&&<div className="flex gap-3"><Preview image={draft.snapshot?.pixels} label={t('pngWriteback.before')}/><Preview image={{...restored,data:new Uint8Array(restored.data),revision:0}} label={t('pngWriteback.after')}/></div>}
  </>;
}
