import { expect, it } from "vitest";
import { error, harness, stamp, success } from "./helpers";

it("stamp metadata operations replay once, preserve map cells and undo together with map/world edits", async()=>{
 const h=harness({stamps:[stamp]}),before=h.host.snapshot();await h.begin();
 const args={context:h.writeContext(),stampId:stamp.id,action:"duplicate",name:"Villa"};const duplicate=success(await h.run("edit_stamp",args));const replay=success(await h.run("edit_stamp",args));expect(replay).toMatchObject({replayed:true,created:duplicate.created});expect(duplicate.created?.stampId).toBeTruthy();expect(h.host.world.stamps()).toHaveLength(2);
 success(await h.edit("edit_stamp",{stampId:stamp.id,action:"update",props:{name:"Home",category:"Buildings",tags:["roof"],favorite:true}}));
 success(await h.edit("edit_map",{mapId:"map-1",name:"Village",world:{x:-64,y:32}}));success(await h.edit("configure_world",{settings:{tileWidth:16,newLevel:{width:20,height:20},background:"#abcdef"}}));
 expect(h.host.world.maps()[0]).toMatchObject({name:"Village",world:{x:-64,y:32}});expect(h.host.world.settings()).toMatchObject({tileWidth:16,background:"#abcdef"});
 await h.api.userAction("approve");expect(h.host.history.undoDepth).toBe(1);h.host.history.undo();const restored=h.host.snapshot() as Record<string,unknown>,original=before as Record<string,unknown>;expect(restored.project).toEqual(original.project);expect(restored.maps).toEqual(original.maps);expect(restored.stamps).toEqual(original.stamps);expect(restored.recipes).toEqual(original.recipes);h.host.history.redo();expect(h.host.world.maps()[0]!.name).toBe("Village");expect(h.host.world.stamps()).toHaveLength(2);
});
it("bad metadata preflight preserves the prior proposal and all counters", async()=>{
 const h=harness({stamps:[stamp]});await h.begin();success(await h.edit("edit_map",{mapId:"map-1",name:"Keep"}));const state=h.api.getState(),before=h.host.snapshot();
 error(await h.edit("edit_stamp",{stampId:"missing",action:"remove"}),"UNKNOWN_ID");error(await h.edit("edit_stamp",{stampId:stamp.id,action:"update",props:{name:"   "}}),"INVALID_ARGUMENT");error(await h.edit("configure_world",{settings:{layerTemplate:[{name:"Same",kind:"tile"},{name:"Same",kind:"entity"}]}}),"INVALID_ARGUMENT");error(await h.edit("configure_world",{settings:{newLevel:{width:4096,height:4096}}}),"LIMIT_EXCEEDED");
 expect(h.api.getState()).toEqual(state);expect(h.host.snapshot()).toEqual(before);await h.api.userAction("discard");expect(h.host.world.maps()[0]!.name).not.toBe("Keep");
});
it("stamp removal affects the library only and discard restores exact metadata", async()=>{
 const h=harness({stamps:[stamp]}),before=h.host.snapshot();await h.begin();success(await h.edit("edit_stamp",{stampId:stamp.id,action:"remove"}));expect(h.host.world.stamps()).toHaveLength(0);await h.api.userAction("discard");expect(h.host.snapshot()).toEqual(before);
});
it("independent renderer tools reject absent host ports without claiming an edit",async()=>{
 const h=harness();for(const name of ["get_editor_state","configure_editor","configure_layout","configure_application","list_editor_commands","run_editor_command","get_export_settings","configure_export"] as const){
  const args=name==="configure_editor"?{gridVisible:true}:name==="configure_layout"?{action:"reset"}:name==="configure_application"?{locale:"en"}:name==="run_editor_command"?{commandId:"view.toggleGrid"}:name==="configure_export"?{preferences:{target:"png"}}:{};
  error(await h.run(name,args),"EDITOR_UNAVAILABLE");expect(h.api.getState().phase).toBe("ready");
 }
});
