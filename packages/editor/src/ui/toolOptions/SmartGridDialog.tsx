import { AlertDialog } from "../primitives/Overlays";
import { adoptMapGrid, useSmartGridQuestion } from "../../commands/smartBrushGrid";
import { useEditorStore } from "../../state/editorStore";
import { t } from "../../i18n";
import { Button } from "../primitives/Button";
import { backdropClass,popupClass,dialogWidthS } from "../dialogs/styles";
export function SmartGridDialog(){
 const question=useSmartGridQuestion(s=>s.question),store=useEditorStore(s=>s.project?.store);
 const open=!!question&&question.store===store;
 const close=()=>useSmartGridQuestion.setState({question:null});
 return <AlertDialog.Root open={open} onOpenChange={next=>{if(!next)close();}}><AlertDialog.Portal>
  <AlertDialog.Backdrop className={backdropClass}/><AlertDialog.Popup className={`${popupClass} ${dialogWidthS}`} data-dialog="smart-grid">
   {question&&<div className="flex flex-col gap-3 p-4">
    <AlertDialog.Title className="text-lg font-semibold text-title">{t("smartStamp.importGridTitle")}</AlertDialog.Title>
    <AlertDialog.Description className="text-md text-muted">{t("smartStamp.importGridQuestion",{sourceW:question.source.tileWidth,sourceH:question.source.tileHeight,mapW:question.store.document.map.tileWidth,mapH:question.store.document.map.tileHeight})}</AlertDialog.Description>
    <div className="flex justify-end gap-2">
     <Button variant="secondary" onClick={close}>{t("smartStamp.keepGrid")}</Button>
     <Button variant="primary" onClick={()=>{adoptMapGrid(question.store,question.source);close();}}>{t("smartStamp.adoptGrid",{size:question.source.tileWidth})}</Button>
    </div>
   </div>}
  </AlertDialog.Popup>
 </AlertDialog.Portal></AlertDialog.Root>;
}
