import { isEntityLayer, type MapStore, type Tileset } from "@smap/core";
import { create } from "zustand";
import { useEditorStore } from "../state/editorStore";
import { useLevelUi } from "./levelActions";
import { brushSource, brushUnavailable, refreshUnpublishedBrush } from "./smartBrushActions";
import { refreshSmartStampSession } from "../ui/stamps/smartStampSession";
import { logSmartBrush } from "./smartBrushErrors";
export function emptyMap(store:MapStore):boolean {
 return store.document.layers.every(l=>l.chunkCount===0&&(!isEntityLayer(l)||l.entities.length===0));
}
export function adoptMapGrid(store:MapStore,source:Tileset):void {
 if(!emptyMap(store)||store.inTransaction||useEditorStore.getState().project?.store!==store)return;
 const {width,height}=store.document.map;
 store.dispatch({type:"resizeMap",width,height,tileWidth:source.tileWidth,tileHeight:source.tileHeight});
 refreshUnpublishedBrush(useEditorStore.getState().stamp);refreshSmartStampSession();
 logSmartBrush("adopt-grid",{level:useEditorStore.getState().project?.levelId,native:[source.tileWidth,source.tileHeight]});
}
export function remedyBrushGrid():void {
 const editor=useEditorStore.getState(),store=editor.project?.store,source=brushSource(editor.stamp);
 if(!store||!source||brushUnavailable(editor.stamp)?.code!=="gridMismatch")return;
 if(emptyMap(store))adoptMapGrid(store,source);
 else useLevelUi.setState({newLevelOpen:true,newLevelGrid:{tileWidth:source.tileWidth,tileHeight:source.tileHeight}});
}
interface GridQuestion {readonly store:MapStore;readonly source:Tileset}
export const useSmartGridQuestion=create<{question:GridQuestion|null}>(()=>({question:null}));
const asked=new WeakSet<MapStore>();
/** Ask once per map, after import; the PNG and confirmed source grid are immutable. */
export function suggestImportedGrid(store:MapStore,source:Tileset):void {
 if(asked.has(store)||!emptyMap(store)||(source.tileWidth===store.document.map.tileWidth&&source.tileHeight===store.document.map.tileHeight))return;
 asked.add(store);useSmartGridQuestion.setState({question:{store,source}});
}
