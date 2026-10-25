import { AgentError, AgentErrorCode, type AgentHost, type AgentSessionSnapshot, type AgentWorldPort, type EditLease, type LeaseableMapStore, type PendingWorldHistoryPort, type PreparedAgentMap, type SessionClient } from "@smap/agent";
import { createDocument, BUILTIN_ENTITY_TYPES, isBuiltinEntityTypeId, type ProjectLevel } from "@smap/core";
import { getLevelWorkspace, getProjectFolder, publishLevelState } from "../io/session";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { onTilesetImage, tilesetImageRevision } from "../state/tilesetImages";
import { usePixelUi } from "../state/pixelUi";
import { modalOpen } from "../commands/modal";
import { useUiStore } from "../ui/uiStore";
import { useSaveStatus } from "../io/saveStatus";
import { t } from "../i18n";
import { agentActivity } from "./activity";
import { agentWorldChanging, editGate, getAgentWorldSessionId } from "./editGate";
import { createMetadataJournal } from "./metadataJournal";
import { createEditorControls } from "./editorControls";
import { captureEditorContext } from "./editorContext";
import { createImagePort } from "./images";
import { createVisualReferencePort } from "./visualReferences";
import { createReferencePort } from "./referenceLibrary";
import { createObjectsPort } from "./objectsPort";
import { captureDraftStart, clearDraftBaseline } from "./draftBaseline";
import { createSmartSourcePort } from "./smartSources";
import { createTagsPort, type TagsIoPort } from "./tagsIo";

export interface EditorAgentHost extends AgentHost { tags: TagsIoPort; setClients(clients: SessionClient[]): void }
export function createEditorHost(): EditorAgentHost {
  const instanceId=crypto.randomUUID();
  let clients:SessionClient[]=[],revision=0,lastSignature="";
  let baselineContent=0,baselineLibrary=0,baselineCaptured=false;
  const preparedStores=new WeakMap<LeaseableMapStore,string>();
  const provisional=new Set<string>(),preparedLevels=new WeakMap<PreparedAgentMap,ProjectLevel>();
  const workspace=()=>{const ws=getLevelWorkspace();if(!ws)throw new AgentError(AgentErrorCode.NO_WORLD,"No open world");return ws;};
  const contentRevision=()=>{
    const ws=getLevelWorkspace(),signature=JSON.stringify([getAgentWorldSessionId(),ws?.contentRevision??0,useProjectLibrary.getState().revision,tilesetImageRevision()]);
    if(signature!==lastSignature){lastSignature=signature;revision++;}return revision;
  };
  const subscribeContent=(listener:()=>void)=>{
    let observed=getLevelWorkspace(),off=observed?.subscribeContent(listener);
    const offEditor=useEditorStore.subscribe(()=>{const next=getLevelWorkspace();if(next!==observed){off?.();observed=next;off=next?.subscribeContent(listener);listener();}});
    const offLibrary=useProjectLibrary.subscribe((s,p)=>{if(s.revision!==p.revision)listener();});
    let images=tilesetImageRevision();
    // Re-cut hints (map switch, regrid) keep the revision; only new bytes are content.
    const offImages=onTilesetImage(()=>{const next=tilesetImageRevision();if(next!==images){images=next;listener();}});
    return()=>{off?.();offEditor();offLibrary();offImages();};
  };
  const world:AgentWorldPort={
    maps:()=>{
      const ws=getLevelWorkspace();return ws?.levels.map(level=>{
        const entry=ws.entry(level.id),map=entry?.store.document.map;
        return{id:level.id,name:level.name,world:level.world,loaded:!!entry,dirty:entry?.dirty??false,...(map?{width:map.width,height:map.height,tileWidth:map.tileWidth,tileHeight:map.tileHeight}:{})};
      })??[];
    },
    tilesets:()=>{
      const ws=getLevelWorkspace();if(!ws)return[];
      const all=new Map(ws.active.store.document.tilesets.map(ts=>[ts.id,ts]));
      for(const id of ws.cachedIds())for(const ts of ws.entry(id)!.store.document.tilesets)if(!all.has(ts.id))all.set(ts.id,ts);
      return [...all.values()];
    },
    stamps:()=>useProjectLibrary.getState().stamps,
    settings:()=>{const settings=useProjectLibrary.getState().settings;return settings.layerTemplate.length?settings:{...settings,layerTemplate:[{name:t("layers.defaultName"),kind:"tile" as const}]};},
    entityTypes:()=>[...BUILTIN_ENTITY_TYPES,...(getLevelWorkspace()?.active.store.document.entityTypes??[])].map(type=>({id:type.id,name:type.name,builtin:isBuiltinEntityTypeId(type.id),fields:type.fields.map(field=>({name:field.name,type:field.type,default:field.default,...(field.enumValues?{enumValues:[...field.enumValues]}:{})}))})),
    async loadMap(id){const ws=workspace(),entry=await ws.load(id,getProjectFolder()?.fs??null);if(getLevelWorkspace()!==ws)throw new AgentError(AgentErrorCode.STALE_WORLD,"World changed while loading map");return entry.store;},
    pinMap(id){workspace().pin(id);return()=>{};},
    async prepareAgentMap(args,signal){
      const ws=workspace(),folder=getProjectFolder();signal.throwIfAborted();
      const files=folder?await folder.fs.list("levels"):[];signal.throwIfAborted();
      if(ws!==getLevelWorkspace())throw new AgentError(AgentErrorCode.STALE_WORLD,"World changed during map preparation");
      const prepared=ws.prepareAgentLevel({name:args.name,width:args.width,height:args.height,tileSize:args.tileWidth,tileHeight:args.tileHeight,layerName:t("layers.defaultName")},files);
      const level=args.world?{...prepared.level,world:args.world}:prepared.level;
      const result:PreparedAgentMap={store:prepared.store,map:{id:level.id,name:level.name,path:level.path,width:args.width,height:args.height,tileWidth:args.tileWidth,tileHeight:args.tileHeight,world:level.world}};
      preparedLevels.set(result,level);preparedStores.set(prepared.store,level.id);return result;
    },
    stageAgentMap(prepared){
      const level=preparedLevels.get(prepared);if(!level)throw new AgentError(AgentErrorCode.INVALID_ARGUMENT,"Map was not prepared by this runtime");
      workspace().pin(workspace().activeId);
      workspace().stageAgentLevel(level,prepared.store);provisional.add(level.id);preparedLevels.delete(prepared);preparedStores.delete(prepared.store);publishLevelState({listChanged:true});
    },
    removeProvisionalMap(id){
      if(!provisional.has(id))return;const ws=workspace();ws.removeProvisionalLevel(id);provisional.delete(id);
      const project=useEditorStore.getState().project;
      if(project?.levelId===id){const level=ws.activeLevel;useEditorStore.getState().switchLevel({name:ws.name,store:ws.active.store,levelPath:level.path,levelId:level.id},null);}
      publishLevelState({listChanged:true});
    },
    approveProvisionalMap(id){provisional.delete(id);},subscribeContent,
  };
  const metadata=createMetadataJournal(),images=createImagePort(world,contentRevision);
  const host:EditorAgentHost={
    session():AgentSessionSnapshot {
      const ws=getLevelWorkspace(),project=useEditorStore.getState().project,folder=getProjectFolder();
      return{instanceId,worldSessionId:ws?getAgentWorldSessionId():null,revision:contentRevision(),world:ws?{name:ws.name,locationLabel:folder?.label??"",saved:!!folder,dirty:useEditorStore.getState().dirty||ws.hasUnsavedLevels}:null,maps:[...world.maps()],activeMapId:ws?.activeId??null,activeLayerId:project?.levelId?.startsWith("stamp:")?null:useEditorStore.getState().activeLayerId,clients};
    },
    editorContext:()=>captureEditorContext(world,contentRevision()),
    editorControls:createEditorControls(world,contentRevision),
    setClients(value){clients=value;},
    loadMap:world.loadMap,subscribeWorldContent:subscribeContent,world,metadata,images,
    visualReferences:createVisualReferencePort(world,contentRevision),
    references:createReferencePort(world,contentRevision),
    objects:createObjectsPort(world,contentRevision),
    smartSources:createSmartSourcePort(world,metadata,()=>{const ws=getLevelWorkspace();return ws?.cachedIds().map(id=>ws.entry(id)!.store)??[];}),
    tags:createTagsPort({world,images,folder:()=>getProjectFolder()?.fs??null,worldId:getAgentWorldSessionId}),
    activity:agentActivity,
    clock:{now:Date.now,schedule(delay,cb){const timer=setTimeout(cb,delay);return()=>clearTimeout(timer);}},
    ids:{next:kind=>`${kind}-${crypto.randomUUID()}`},
    transactions:{
      writeGate:editGate,
      history:{beginPending(origin,label){const history=workspace().history as unknown as PendingWorldHistoryPort;if(!history.beginPending)throw new AgentError(AgentErrorCode.EDITOR_UNAVAILABLE,"Core pending world history is unavailable");return history.beginPending(origin,label);}},
      acquireLease(id,store,owner):EditLease {
        if(workspace().entry(id)?.store!==store && preparedStores.get(store)!==id)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Lease target is not the live map");
        const leaseable=store as typeof store & LeaseableMapStore;
        if(!leaseable.acquireEditLease)throw new AgentError(AgentErrorCode.EDITOR_UNAVAILABLE,"Core map edit leases are unavailable");
        return leaseable.acquireEditLease(owner);
      },
      assertCanBegin(){
        const ws=workspace(),project=useEditorStore.getState().project;
        if(agentWorldChanging()||modalOpen()||project?.levelId?.startsWith("stamp:")||useUiStore.getState().busy||useSaveStatus.getState().diskConflict||usePixelUi.getState().pending||ws.cachedIds().some(id=>ws.entry(id)!.store.inTransaction))throw new AgentError(AgentErrorCode.WRITER_BUSY,"Finish the current editor operation first");
      },
      captureBaseline(mapIds){
        const ws=workspace(),snapshot=metadata.snapshot();
        if(!baselineCaptured){
          baselineCaptured=true;baselineContent=ws.contentRevision;baselineLibrary=snapshot.libraryRevision;
          ws.setPendingProjectData(createDocument({...ws.active.store.document.map,tilesets:snapshot.project.tilesets,entityTypes:snapshot.project.entityTypes,randomSets:snapshot.project.randomSets,collections:snapshot.project.collections}));
        }
        for(const id of mapIds){const entry=ws.entry(id);if(entry)captureDraftStart(id,entry.store);}
        return{worldSessionId:getAgentWorldSessionId()!,editorDirty:useEditorStore.getState().dirty,metadata:snapshot,maps:ws.cachedIds().filter(id=>mapIds.includes(id)).map(mapId=>({mapId,...ws.entry(mapId)!}))};
      },
      restoreBaseline(baseline){
        if(baseline.worldSessionId!==getAgentWorldSessionId())throw new AgentError(AgentErrorCode.STALE_WORLD,"Cannot restore a different world");
        metadata.restore(baseline.metadata);workspace().restorePersistence(baseline.maps,baseline.metadata.pendingRemovals);
        useEditorStore.getState().setDirty(baseline.editorDirty);publishLevelState();
      },
      finalized(outcome){baselineCaptured=false;clearDraftBaseline();workspace().setPendingProjectData(null);publishLevelState();if(outcome==="approved" && (workspace().contentRevision!==baselineContent || useProjectLibrary.getState().revision!==baselineLibrary))useEditorStore.getState().setDirty(true);},
    },
  };
  return host;
}
