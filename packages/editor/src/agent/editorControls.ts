import { AgentError, AgentErrorCode as E, type AgentEditorControlsPort, type AgentWorldPort, type ConfigureEditorArgs, type EditorCommandInfo, type EditorControlState, type EditorExportPreferences } from "@smap/agent";
import { FLIP_H, FLIP_V, FLIP_D, isEntityLayer, isTileLayer, isValidTileId, makeCell, type MapDocument } from "@smap/core";
import { allCommands, getCommand, isEnabled, runCommand } from "../commands/registry";
import { loadExportSettings, updateExportSettings, type ExportSettings } from "../export/exportSettings";
import { availableLocales, getLocale, t } from "../i18n";
import { getLevelWorkspace, openLevel } from "../io/session";
import { updateAppPreferences } from "../platform/appSettings";
import { effectiveShortcuts, SHORTCUTS, type CommandId } from "../shortcuts/shortcuts";
import { useEditorStore } from "../state/editorStore";
import { useMajorGrid } from "../state/majorGridSettings";
import { usePixelColors } from "../state/pixelColors";
import { usePixelUi } from "../state/pixelUi";
import { useRectangleOptions } from "../state/rectangleOptions";
import { getCanvasHandle } from "../ui/canvas/canvasHandle";
import { copyLayout, PANEL_IDS, ZONE_IDS } from "../ui/layout/dockModel";
import { useDockStore } from "../ui/layout/dockStore";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { useUiStore } from "../ui/uiStore";
import { editGate } from "./editGate";
import { captureEditorContext } from "./editorContext";

/** Audited UI-only commands. Category/prefix never grants execution to a future command. */
const UI_COMMANDS: ReadonlySet<string> = new Set([
  "tool.line", "tool.brush", "tool.eraser", "tool.fill", "tool.rect", "tool.select", "tool.eyedropper", "tool.entity", "tool.hand",
  "brush.smaller", "brush.larger", "pixel.mode", "pixel.swap", "pixel.reset", "pixel.resetOrigin",
  "view.toggleCollision", "view.toggleGrid", "view.toggleLibrary", "view.toggleInspector", "view.toggleRecent", "view.resetLayout",
  "view.focusNextRegion", "view.focusPrevRegion", "view.togglePanels", "view.toggleMinimap", "view.zoomIn", "view.zoomOut", "view.zoomReset", "view.frameMap", "view.world",
  "view.toggleLevels", "view.toggleProperties", "view.toggleLayers", "view.toggleRulers", "view.history", "view.aiActivity",
  "view.toggleBottom",
  ...ZONE_IDS.flatMap(zone => [`dock.${zone}.show`, `dock.${zone}.hide`]),
  ...PANEL_IDS.flatMap(panel => [...ZONE_IDS.map(zone => `panel.${panel}.${zone}`), ...["show", "forward", "backward", "split", "merge", "hide"].map(action => `panel.${panel}.${action}`)]),
  "map.settings", "map.resize", "project.settings", "palette.open", "settings.language", "settings.editShortcuts", "ai.openSettings", "tileset.fit", "tileset.goto",
  "selection.toggleScope", "edit.selectAll", "edit.deselect", "edit.invertSelection",
]);
function check(condition: unknown, code: typeof E[keyof typeof E], message: string): asserts condition { if (!condition) throw new AgentError(code, message); }
export function createEditorControls(world: AgentWorldPort, revision: () => number): AgentEditorControlsPort {
  function getState(): EditorControlState {
    const e = useEditorStore.getState(), p = usePixelUi.getState(), colors = usePixelColors.getState(), r = useRectangleOptions.getState(), tv = useTilesetView.getState(), ui = useUiStore.getState();
    const layout = copyLayout(useDockStore.getState().layout), effective = new Map(effectiveShortcuts().map(s => [s.command, [...s.keys]]));
    return {
      context: captureEditorContext(world, revision()), mode: p.mode,
      view: { gridVisible:e.gridVisible,collisionOverlay:e.collisionOverlay,minimapVisible:getCanvasHandle()?.isMinimapVisible()??null,rulersVisible:layout.rulersVisible,panelsHidden:ui.panelsHidden,majorGrid:{...useMajorGrid.getState().settings} },
      brush:{size:e.brushSize,shape:e.brushShape,collisionValue:e.gridValue},rectangle:{mode:r.mode,thickness:r.thickness},
      selection:{scope:e.selectionScope,mode:e.selectionMode,pickScope:e.pickScope,entityId:e.selectedEntityId,entityTypeId:e.entityTypeId},
      tileset:{activeId:ui.activeTilesetId,view:tv.view,query:tv.query,zoom:tv.globalZoom},
      pixel:{size:p.size,shape:p.shape,scope:p.scope,fillMode:p.fillMode,filled:p.filled,mirrorH:p.mirrorH,mirrorV:p.mirrorV,foreground:colors.fg,background:colors.bg},layout,
      application:{locale:getLocale(),availableLocales:availableLocales().map(l=>({id:l.id,name:l.nativeName})),shortcuts:SHORTCUTS.map(s=>({command:s.command,keys:effective.get(s.command)??[],defaults:[...s.keys]}))},
      capabilities:{documentEdits:"begin_edit → tools → finish_edit → user review",uiControlsDuringReview:true,commandExecution:"explicit UI allowlist",canApproveOwnEdits:false,filesystem:false,shell:false},
    };
  }
  function alternatives(id: string): string[] {
    if (id === "map.resize") return ["resize_map"];
    if (id === "map.settings" || id.startsWith("level.")) return ["get_map_info","edit_map","create_map","configure_editor"];
    if (id.startsWith("project.")) return ["get_world_settings","configure_world"];
    if (id.startsWith("stamp.")) return ["create_stamp","edit_stamp","place_stamp"];
    if (id.startsWith("layer.")) return ["edit_layer"];
    if (id.startsWith("entity.")) return ["list_entity_types","place_entity","edit_entity"];
    if (id.startsWith("file.export")) return ["get_export_settings","configure_export","render_preview"];
    if (["edit.cut","edit.delete"].includes(id)) return ["paint_cells","paint_rect","edit_entity"];
    if (id === "edit.paste") return ["place_stamp","paint_cells"];
    if (["edit.flipX","edit.flipY","edit.rotateCW","edit.rotateCCW"].includes(id)) return ["place_stamp","paint_cells"];
    return [];
  }
  function commandInfo(): EditorCommandInfo[] {
    const keys = new Map(effectiveShortcuts().map(s => [s.command, [...s.keys]]));
    return allCommands().map(c => {
      const remoteExecutable=UI_COMMANDS.has(c.id);
      return {id:c.id,title:t(c.title),category:c.category,enabled:isEnabled(c),checked:c.checked?.()??null,keys:keys.get(c.id)??[],remoteExecutable,alternatives:alternatives(c.id),reason:remoteExecutable?null:c.id.startsWith("ai.")?"Human-controlled AI lifecycle or sidecar action":"Use typed document transaction tools or the application's human file workflow"};
    });
  }
  async function configure(args: ConfigureEditorArgs, call: Parameters<AgentEditorControlsPort["configure"]>[1]): Promise<EditorControlState> {
    const original=useEditorStore.getState(), ws=getLevelWorkspace();
    check(!useUiStore.getState().busy && !usePixelUi.getState().pending && !(original.project?.store.inTransaction && !editGate.blocked),E.WRITER_BUSY,"Finish the current editor gesture first");
    if(args.activeMapId)check(ws?.level(args.activeMapId),E.UNKNOWN_ID,"Unknown map");
    let doc: MapDocument | undefined=original.project?.store.document;
    if(args.activeMapId && args.activeMapId!==original.project?.levelId){
      const target=await world.loadMap(args.activeMapId);call.signal.throwIfAborted();
      check(getLevelWorkspace()===ws,E.STALE_WORLD,"World changed while resolving navigation");doc=target.document;
    }
    const crossMap=!!args.activeMapId&&args.activeMapId!==original.project?.levelId;
    const orientedLayer=args.activeLayerId??(crossMap?(doc?.layers.filter(l=>!isEntityLayer(l)).at(-1)??doc?.layers.at(-1))?.id:original.activeLayerId);
    const selected=args.selection;
    if(args.activeLayerId)check(doc?.getLayer(args.activeLayerId),E.UNKNOWN_ID,"Unknown layer in target map");
    if(selected?.region){const b=selected.region;check(doc&&b.x+b.width<=doc.map.width&&b.y+b.height<=doc.map.height,E.OUT_OF_BOUNDS,"Selection exceeds target map");}
    if(selected?.tile){const tile=selected.tile,ts=world.tilesets().find(t=>t.id===tile.tilesetId);check(ts&&isValidTileId(ts,tile.tileId),E.UNKNOWN_ID,"Unknown tile");
      if(tile.flags)check(doc&&doc.getLayer(orientedLayer??"")&&isTileLayer(doc.getLayer(orientedLayer??"")!),E.INVALID_ARGUMENT,"An oriented brush requires an active tile layer");}
    if(selected&&"tile"in selected&&"stampId"in selected)throw new AgentError(E.INVALID_ARGUMENT,"Choose tile or stampId in one request");
    const stamp=selected?.stampId?world.stamps().find(s=>s.id===selected.stampId):undefined;
    if(selected?.stampId)check(stamp,E.UNKNOWN_ID,"Unknown stamp");
    if(selected?.entityId)check(doc?.layers.some(l=>isEntityLayer(l)&&l.entities.some(e=>e.id===selected.entityId)),E.UNKNOWN_ID,"Unknown entity in target map");
    if(selected?.entityTypeId)check(world.entityTypes().some(t=>t.id===selected.entityTypeId),E.UNKNOWN_ID,"Unknown entity type");
    if(args.tileset?.activeId)check(world.tilesets().some(t=>t.id===args.tileset!.activeId),E.UNKNOWN_ID,"Unknown tileset");
    const canvas=getCanvasHandle();
    if(args.camera||args.minimapVisible!==undefined)check(canvas,E.EDITOR_UNAVAILABLE,"Canvas is unavailable");
    if(args.camera?.center){const at=args.camera.center;check(doc&&at.x<doc.map.width&&at.y<doc.map.height,E.OUT_OF_BOUNDS,"Camera center exceeds target map");check((args.camera.view??canvas?.getView())==="level",E.INVALID_ARGUMENT,"Camera center uses level cells; set view to level");}
    if(args.camera?.frame && (args.camera.center||args.camera.zoom!==undefined))throw new AgentError(E.INVALID_ARGUMENT,"Use frame or explicit center/zoom");
    const requestedMode=args.mode??usePixelUi.getState().mode;
    if(args.tool&&requestedMode==="pixel")check(["brush","eraser","fill","eyedropper","line","rect","hand"].includes(args.tool),E.INVALID_ARGUMENT,"Tool is unavailable in pixel mode");
    call.signal.throwIfAborted();
    if(args.activeMapId && args.activeMapId!==original.project?.levelId){
      check(await openLevel(args.activeMapId),E.EDITOR_UNAVAILABLE,"Could not activate target map");
      check(getLevelWorkspace()===ws,E.STALE_WORLD,"World changed while activating map");
    }
    const e=useEditorStore.getState(),p=usePixelUi.getState(),ui=useUiStore.getState(),tv=useTilesetView.getState();
    if(args.activeLayerId)e.setActiveLayer(args.activeLayerId);
    else if(crossMap&&selected?.tile?.flags&&orientedLayer)e.setActiveLayer(orientedLayer);
    if(args.mode)p.setMode(args.mode);if(args.tool)e.setTool(args.tool);
    if(args.gridVisible!==undefined&&args.gridVisible!==e.gridVisible)e.toggleGrid();
    if(args.collisionOverlay!==undefined&&args.collisionOverlay!==e.collisionOverlay)e.toggleCollisionOverlay();
    if(args.panelsHidden!==undefined&&args.panelsHidden!==ui.panelsHidden)ui.togglePanels();
    if(args.rulersVisible!==undefined){const layout=copyLayout(useDockStore.getState().layout);layout.rulersVisible=args.rulersVisible;useDockStore.getState().update(layout);}
    if(args.majorGrid)useMajorGrid.getState().update(args.majorGrid);
    if(args.minimapVisible!==undefined)canvas!.setMinimapVisible(args.minimapVisible);
    if(args.brush?.size!==undefined)e.setBrushSize(args.brush.size);if(args.brush?.shape)e.setBrushShape(args.brush.shape);if(args.brush?.collisionValue!==undefined)e.setGridValue(args.brush.collisionValue);
    if(args.rectangle?.mode)useRectangleOptions.getState().setMode(args.rectangle.mode);if(args.rectangle?.thickness!==undefined)useRectangleOptions.getState().setThickness(args.rectangle.thickness);
    if(selected){
      if(selected.scope)e.setSelectionScope(selected.scope);if(selected.mode)e.setSelectionMode(selected.mode);if(selected.pickScope)e.setPickScope(selected.pickScope);
      if("region"in selected)e.setRegion(selected.region?{...selected.region}:null);
      if("entityId"in selected)e.setSelectedEntity(selected.entityId??null);if(selected.entityTypeId)e.setEntityTypeId(selected.entityTypeId);
      if("tile"in selected){e.setStamp(null);e.setRandomSet([]);e.setSelection(selected.tile?{tilesetId:selected.tile.tilesetId,tileId:selected.tile.tileId}:null);tv.setSelection(null);
        if(selected.tile){ui.setActiveTileset(selected.tile.tilesetId);tv.requestReveal(selected.tile.tilesetId,[selected.tile.tileId]);const f=selected.tile.flags??0;
          if(f){const l=doc!.getLayer(orientedLayer!)!;e.setStamp({width:1,height:1,palette:[{tilesetId:selected.tile.tilesetId,tileId:selected.tile.tileId}],layers:[{layerId:l.id,name:l.name,cells:Uint32Array.of(makeCell(1,(f&1?FLIP_H:0)|(f&2?FLIP_V:0)|(f&4?FLIP_D:0)))}]});}}
      }
      if("stampId"in selected){e.setSelection(null);e.setRandomSet([]);e.setStamp(stamp??null);tv.setSelection(null);}
    }
    if(args.tileset){if(args.tileset.activeId){ui.setActiveTileset(args.tileset.activeId);tv.requestJump(args.tileset.activeId);}if(args.tileset.view)tv.setView(args.tileset.view);if(args.tileset.query!==undefined)tv.setQuery(args.tileset.query);if("zoom"in args.tileset)tv.setGlobalZoom(args.tileset.zoom??null);}
    if(args.pixel){const {foreground,background,...patch}=args.pixel;usePixelUi.setState(patch);if(foreground)usePixelColors.getState().setFg(foreground);if(background)usePixelColors.getState().setBg(background);}
    if(args.camera){if(args.camera.view)canvas!.setView(args.camera.view);if(args.camera.zoom!==undefined)canvas!.setZoom(args.camera.zoom);if(args.camera.center)canvas!.centerOn(args.camera.center.x,args.camera.center.y);if(args.camera.frame)canvas!.frameMap();}
    // Navigation and all setters above are UI-only: proposal revision/history are unchanged.
    return getState();
  }
  const exportPreferences = (s: ExportSettings): EditorExportPreferences => ({target:s.target,pngScale:s.pngScale,unityTiles:s.unityTiles,unityCollision:s.unityCollision,copyTextures:s.copyTextures,autoUnity:s.autoUnity,excludedLayers:structuredClone(s.excludedLayers)});
  return {
    async getExportSettings(call) { const project=useEditorStore.getState().project;check(project,E.NO_WORLD,"No open world");const value=await loadExportSettings(project.name);call.signal.throwIfAborted();check(useEditorStore.getState().project?.name===project.name,E.STALE_WORLD,"World changed while reading export preferences");return exportPreferences(value); },
    async configureExport(args,call) { const project=useEditorStore.getState().project,ws=getLevelWorkspace();check(project&&ws,E.NO_WORLD,"No open world");const before=await loadExportSettings(project.name);call.signal.throwIfAborted();check(getLevelWorkspace()===ws,E.STALE_WORLD,"World changed while loading export preferences");if(args.preferences.autoUnity)check(before.unityDir||before.nativeFolders.unity,E.INVALID_ARGUMENT,"Choose a Unity export destination in the editor before enabling automatic export");return exportPreferences(await updateExportSettings(project.name,args.preferences)); },
    getState,configure,
    configureLayout(args){const dock=useDockStore.getState();check(dock.gestures===0,E.WRITER_BUSY,"Finish the current panel drag first");switch(args.action){
      case "reset":dock.reset();break;case "show":dock.reveal(args.panel);break;case "hide":dock.hidePanel(args.panel);break;
      case "zone":if(args.state)dock.setZoneState(args.zone,args.state);if(args.size!==undefined)dock.setSize(args.zone,args.size,true);break;
      case "move":{const groups=dock.layout.zones[args.zone].groups;if(args.group!==undefined&&!args.split)check(args.group<groups.length||groups.length===0&&args.group===0,E.OUT_OF_BOUNDS,"Unknown dock group");dock.move(args.panel,{zone:args.zone,...(args.group!==undefined?{group:args.group}:{}),...(args.index!==undefined?{index:args.index}:{}),...(args.split?{split:args.split}:{})});break;}}
      return getState();},
    async configureApplication(args,call){const ws=getLevelWorkspace();const assertCurrent=()=>{call.signal.throwIfAborted();check(getLevelWorkspace()===ws,E.STALE_WORLD,"World changed while updating application preferences");};assertCurrent();await updateAppPreferences({...(args.locale?{locale:args.locale}:{}),...(args.shortcuts?{shortcuts:args.shortcuts}:{})},assertCurrent);return getState();},
    listCommands(args){const query=args.query?.trim().toLocaleLowerCase()??"",all=commandInfo().filter(c=>!query||[c.id,c.title,c.category].some(v=>v.toLocaleLowerCase().includes(query))),offset=args.offset??0,items=all.slice(offset,offset+(args.limit??64));return{items,total:all.length,nextOffset:offset+items.length<all.length?offset+items.length:null};},
    runCommand(args){check(UI_COMMANDS.has(args.commandId),E.INVALID_ARGUMENT,"Command is not remotely executable; inspect list_editor_commands and use typed document tools");const command=getCommand(args.commandId as CommandId);check(command,E.UNKNOWN_ID,"Unknown command");check(isEnabled(command),E.WRITER_BUSY,"Command is currently disabled");check(runCommand(command.id),E.WRITER_BUSY,"Command could not execute");return{commandId:args.commandId,executed:true,state:getState()};},
  };
}
