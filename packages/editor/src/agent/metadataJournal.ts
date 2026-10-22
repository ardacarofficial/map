import { createDocument } from "@smap/core";
import { AgentError, AgentErrorCode, type AgentMetadataOperation, type AgentMetadataPort, type MetadataSnapshot, type ProjectHistoryPatch } from "@smap/agent";
import { useEditorStore } from "../state/editorStore";
import { getLevelWorkspace, publishLevelState } from "../io/session";
import { useProjectLibrary } from "../io/projectLibrary";
import { sortStamps } from "../io/stampsIo";

export function createMetadataJournal(): AgentMetadataPort {
  let operations: AgentMetadataOperation[] = [];
  const ws = () => {
    const value = getLevelWorkspace();
    if (!value) throw new AgentError(AgentErrorCode.NO_WORLD, "No open world");
    return value;
  };
  const apply = (operation: AgentMetadataOperation, side: "before" | "after") => {
    if (operation.kind === "worldSettings") useProjectLibrary.getState().setSettings(operation[side]);
    else if (operation.kind === "mapName") ws().rename(operation.mapId, operation[side]);
    else if (operation.kind === "mapPosition") ws().setWorldPosition(operation.mapId, operation[side]);
    else if (operation.kind === "recipes") useProjectLibrary.setState(s => ({ generatedRecipes: operation[side], revision: s.revision + 1 }));
    else if (operation.kind === "stamps") {
      // Manual library additions/renames are independent of world history. Replay
      // only the ids this action changed, retaining later edits to other stamps.
      const before = new Map(operation.before.map(stamp => [stamp.id, stamp])),
        after = new Map(operation.after.map(stamp => [stamp.id, stamp])),
        changed = new Set([...before.keys(), ...after.keys()].filter(id => before.get(id) !== after.get(id)));
      useProjectLibrary.setState(s => ({ stamps: sortStamps([
        ...s.stamps.filter(stamp => !changed.has(stamp.id)),
        ...operation[side].filter(stamp => changed.has(stamp.id)),
      ]), revision: s.revision + 1 }));
    }
    else if (operation.kind === "projectData") {
      // MapStore project metadata operations are owned by the coordinator's lease.
      const store = ws().entry(operation.mapId)?.store;
      if (!store) throw new AgentError(AgentErrorCode.UNKNOWN_ID, "Metadata map is not loaded");
      const project = operation[side];
      if (!store.inTransaction) {
        const source = createDocument({ ...store.document.map, tilesets: project.tilesets,
          entityTypes: project.entityTypes ?? [], randomSets: project.randomSets ?? [], collections: project.collections ?? [] });
        store.syncProjectData(source);
      } else {
        // Pending followers add generated metadata through ordinary undoable ops.
        for (const tileset of project.tilesets) if (!store.document.getTileset(tileset.id)) store.dispatch({ type: "addTileset", tileset });
      }
    }
  };
  return {
    snapshot(): MetadataSnapshot {
      const workspace = ws(), doc = workspace.active.store.document, lib = useProjectLibrary.getState();
      return {
        project: { name: workspace.name, levels: [...workspace.levels], retiredLevelIds: [...workspace.retiredLevelIds], tilesets: doc.tilesets,
          entityTypes: doc.entityTypes, randomSets: doc.randomSets, collections: doc.collections, colorPalettes: lib.colorPalettes, settings: lib.settings },
        recipes: lib.generatedRecipes, stamps: lib.stamps, brokenStampFiles: lib.brokenStampFiles,
        dirty: useEditorStore.getState().dirty, libraryRevision: lib.revision,
        knownText: workspace.cachedIds().map(id => ({ path: workspace.level(id)!.path, text: workspace.entry(id)!.knownText })),
        pendingRemovals: workspace.removedFiles,
      };
    },
    stage(operation) { apply(operation, "after"); operations.push(operation); },
    restore(snapshot) {
      // Provisional membership is removed by AgentWorldPort before restoring this journal.
      for (const level of snapshot.project.levels) if (ws().level(level.id)) { ws().setWorldPosition(level.id, level.world); if (ws().level(level.id)!.name !== level.name) ws().rename(level.id, level.name); }
      useProjectLibrary.setState({ generatedRecipes: snapshot.recipes, stamps: [...snapshot.stamps], brokenStampFiles: [...snapshot.brokenStampFiles],
        settings: snapshot.project.settings, colorPalettes: snapshot.project.colorPalettes ?? [], levels: [...ws().levels], revision: snapshot.libraryRevision });
      operations = [];
    },
    patch(): ProjectHistoryPatch | undefined {
      if (!operations.length) return undefined;
      const captured = [...operations]; operations = [];
      return { apply(side) { for (const op of side === "before" ? [...captured].reverse() : captured) apply(op, side); publishLevelState({ listChanged: true }); } };
    },
    publish() { publishLevelState({ listChanged: true }); },
  };
}
