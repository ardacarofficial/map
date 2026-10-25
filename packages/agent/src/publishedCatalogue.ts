/** The tools/list catalogue agents see: compact projections of the strict internal schemas.
 * Validation always uses the strict TOOL_DEFINITIONS; this file only decides what is advertised.
 * Shared rules (coordinates, tile refs, context, envelope) live in the server instructions. */
import type { AgentToolDefinition, JsonValue, ToolName } from "./contracts";
import { EDITOR_CONTROL_TOOLS } from "./editorControls";
import { TOOL_DEFINITIONS, canonicalJson } from "./toolSchemas";

/** editor_ui action → internal tool. All UI/settings/export controls stay reachable through it. */
export const EDITOR_UI_ACTIONS = {
  state: "get_editor_state",
  configure: "configure_editor",
  layout: "configure_layout",
  application: "configure_application",
  commands: "list_editor_commands",
  run_command: "run_editor_command",
  export_settings: "get_export_settings",
  configure_export: "configure_export",
} as const satisfies Record<string, (typeof EDITOR_CONTROL_TOOLS)[number]>;
export type EditorUiAction = keyof typeof EDITOR_UI_ACTIONS;

/** Still callable by name (old clients, tests); listed only through editor_ui. */
export const UNLISTED_TOOLS: ReadonlySet<string> = new Set<string>(EDITOR_CONTROL_TOOLS);

/** One or two sentences each; shared conventions are in the server instructions. */
const DESCRIPTIONS: Partial<Record<ToolName, string>> = {
  get_session: "Start here: open world, maps, active map/layer, your pending edit, references (pictures), smart sources (smart) and essential limits. Pass transactionId to poll an edit's outcome.",
  get_map_info: "Map size, tile size and layers (id, name, kind, visible, locked).",
  read_region: "Read cells as paint_grid-shaped rows+legend per layer ('.' = empty); default whole map, visible tile+collision layers. format:'cells' gives flat arrays.",
  list_tilesets: "Tilesets with tile size, grid and detected smart sources. includeDetails:false skips fingerprints (faster).",
  get_tile_catalog: "PNG of a tileset with every tileId printed under its tile (image:'tiles', default), or a sheet crop (image:'sheet', sheetRegion). details:true adds fingerprints for set_tags.",
  list_stamps: "Saved stamps (multi-layer objects: houses, bridges, trees) with size and source layers. includeSheet:true returns one PNG of all stamps with names and sizes; query searches names/tags.",
  begin_edit: "Open your draft on mapIds (requestLabel = the user's request). Returns transactionId and resumeToken (keep it). unlockLayerIds lets you paint locked/hidden layers. collaboration:{mode:'regions'} starts a shared draft.",
  finish_edit: "Submit the draft for the human's review (Onayla/Vazgeç). resume_edit reopens it if you must amend.",
  cancel_edit: "Discard your draft and restore everything. After a reconnect pass resumeToken.",
  resume_edit: "Take your draft back after a reconnect, restart, Durdur or finish_edit (transactionId + resumeToken). Earlier work is kept.",
  paint_grid: "Paint any area of varied tiles in one call: rows (equal-length strings, one char per cell from origin, default 0,0) + legend char → tile | null (erase) | 'keep' | {random:[{tilesetId,tileId,weight?}],seed?} | {collision:n}. Space keeps a cell. layers:[{layerName|layerId,origin?,rows,legend?}] paints several layers at once. ≤16384 cells per layer.",
  paint_cells: "Sparse cells: points:[[x,y],...] with one value (cheapest scatter), or cells:[{x,y,value}]. value = tile, null (erase) or {collision:n}.",
  paint_rect: "Fill a region with one value (outline:n for a frame). Any size.",
  paint_line: "Straight line from→to with one value; width 1–16.",
  fill: "Flood fill from start (4-neighbour, same original value), optionally inside region.",
  replace_tiles: "Replace one tile with another (to:null erases) keeping flips; scope region|layer|map|world. Returns the count.",
  clear_region: "Erase cells in region (default whole map) on layerIds or all visible unlocked tile/collision layers.",
  prepare_smart_source: "Optional: prepare smart art once and get a sourceId. draw_path/smart_brush accept source directly.",
  smart_brush: "Smart bordered shapes with correct edges/corners. mode:'area' + region (lakes, ponds, fields; overlapping areas merge); mode:'road' + cells. source = {tilesetId,region} from get_session.smart, or {stampId}. openEdges (default true) keeps shapes open at the map border.",
  draw_path: "Roads, paths and rivers with smart edges: points are the bends (orthogonal runs join them), width in macro cells (3 suits a river). source = {tilesetId,region} from get_session.smart (kind road). Joins/crossings get matching corners; reaching the border runs off-map.",
  place_stamp: "Place a stamp (all its layers) with top-left at, or at every positions:[[x,y],...] in one call. rotation 0–3, flipX/flipY; layerMapping when layers are ambiguous.",
  edit_layer: "Layers: action create {name,kind tile|collision|entity,index?}, update {layerId,props:{name,visible,locked,opacity}} or reorder {layerId,index}.",
  list_entity_types: "Entity types (spawn, portal, user types) with fields and defaults.",
  place_entity: "Place an entity of typeId at a cell on an entity layer. Point fields are pixels.",
  edit_entity: "Move (at), update fields or remove an entity.",
  create_map: "Create a new map inside your edit (width/height in cells, tile size in pixels); returns its id and layer ids.",
  resize_map: "Resize a map from its top-left; allowCrop:true to drop content outside.",
  render_preview: "PNG of the live map (your draft included). grid/coordinates for labelled cells, region+zoom (1–8) for close-ups, highlight:'draft' outlines your changes.",
  validate_map: "Structural check of the whole map in one call: summary by code plus the first issues.",
  get_tags: "AI tags (free words like 'su', 'çatı-sol') of tiles/stamps; query searches them.",
  set_tags: "Set AI tags for tiles/stamps (expectedFingerprint from get_tags or get_tile_catalog details). Saved immediately, outside the draft.",
  visual_ingest_reference: "Keep a base64 PNG for exact atlas matching with visual_match_reference (for pictures use reference_add).",
  visual_match_reference: "Find where an ingested PNG appears exactly in tilesets (D4 flips, integer scales).",
  create_stamp: "Save a stamp from a map region (layerIds) or a tileset region.",
  get_editor_context: "What the user has selected in the editor (map, layer, tool, tileset selection, shared reference token).",
  apply_operations: "Run up to 32 paint_cells/paint_grid/paint_rect/paint_line/place_stamp/place_entity/edit_entity calls as one action: operations:[{tool,args}]. All-or-nothing; place_stamp children need layerMapping.",
  validate_goals: "Check goals: reachability over collision layers, region_unchanged digests, entity_count.",
  edit_map: "Rename a map or move it in the world view (world pixels).",
  edit_stamp: "Stamp library: action update {props}, duplicate {name} or remove.",
  get_world_settings: "World defaults for new maps (tile size, size, layer template, background).",
  configure_world: "Change world defaults for new maps inside your edit.",
  join_edit: "Join a shared (collaborative) draft claiming map/layer rectangles; then write with context.expectedMemberRevision.",
  reference_add: "Load a reference picture: path (absolute .png/.jpg/.webp), imageBase64, or selectedReferenceToken. Pictures the user dropped are already in get_session.references.",
  reference_view: "Show a reference picture resampled onto the map grid with coordinates, to read features as cells.",
  reference_quantize: "Turn a reference picture into paint_grid layers (nearest tiles per cell) plus confidence and a preview. mode render|sketch|auto; colorLegend {'#rrggbb': tile | tag word | {stampId} | null} for sketches. Writes nothing.",
  render_compare: "Compare the map with a reference (referenceId) or with the draft start (baseline:'draftStart'); mode side|overlay|diff; returns mismatching cells.",
  editor_ui: "Editor UI, not the map (no begin_edit): action state | configure {activeMapId, activeLayerId, tool, camera:{zoom,center,frame}, gridVisible, …} | layout {action reset|zone|show|hide|move, panel, zone} | application {locale, shortcuts} | commands {query} | run_command {commandId} | export_settings | configure_export {preferences}. args holds the action's arguments.",
};

/** Short property notes where the name alone is not enough. */
const PROPERTY_NOTES: Partial<Record<ToolName, Record<string, string>>> = {
  get_tile_catalog: { scale: "1, 2 or 4" },
  paint_grid: { rows: "One string per map row; all the same length.", origin: "Top-left cell of rows (default 0,0)." },
  smart_brush: { region: "Map cells (area mode)." },
  draw_path: { points: "Bends in map cells, e.g. [{x:0,y:5},{x:12,y:5},{x:12,y:31}]", width: "Macro cells (tiles = width × band)." },
  place_stamp: { positions: "[[x,y],...] top-left cells; places the stamp at each." },
  reference_quantize: { candidates: "Limit to tilesetIds / tiles / stamps." },
  editor_ui: { args: "Arguments of the chosen action." },
  begin_edit: { mapIds: "Map ids this edit may change (create_map adds more)." },
};

/** Validation-only keywords; the server re-validates every call against the strict schema. */
const STRIP = new Set(["minLength", "maxLength", "pattern", "maximum", "minimum", "exclusiveMinimum", "exclusiveMaximum", "maxItems", "minItems",
  "uniqueItems", "maxProperties", "minProperties", "propertyNames", "$schema", "$defs", "not", "if", "then", "allOf", "title", "default", "description"]);
type Schema = Record<string, JsonValue>;
const isObject = (value: unknown): value is Schema => value !== null && typeof value === "object" && !Array.isArray(value);
/** A branch that only states which keys are required (cross-key rules). */
const onlyRequires = (branch: unknown) => isObject(branch) && !("type" in branch) && !("const" in branch) && !("$ref" in branch)
  && Object.keys(branch).every(key => key === "required" || key === "properties" || key === "not" || key === "anyOf")
  && Object.values((branch.properties ?? {}) as Schema).every(value => isObject(value) && Object.keys(value).length === 0);

function resolve(schema: JsonValue, defs: Schema, depth = 0): JsonValue {
  if (Array.isArray(schema)) return schema.map(item => resolve(item, defs, depth));
  if (!isObject(schema)) return schema;
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.slice("#/$defs/".length);
    if (depth > 16 || !isObject(defs[name])) throw new Error(`Unresolvable ${schema.$ref}`);
    return resolve(defs[name]!, defs, depth + 1);
  }
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, resolve(value, defs, depth)]));
}

/** Union of object alternatives: properties merged, discriminator consts become one enum. */
function mergeBranches(branches: Schema[]): Schema | undefined {
  if (branches.length < 2 || !branches.every(b => b.type === "object" && isObject(b.properties))) return undefined;
  const properties: Schema = {};
  for (const branch of branches)
    for (const [key, value] of Object.entries(branch.properties as Schema)) {
      if (isObject(value) && "const" in value) {
        const existing = properties[key];
        const values = isObject(existing) && Array.isArray(existing.enum) ? existing.enum : isObject(existing) && "const" in existing ? [existing.const!] : [];
        if (!values.some(v => canonicalJson(v, false) === canonicalJson(value.const!, false))) values.push(value.const!);
        properties[key] = values.length === 1 ? { const: values[0]! } : { enum: values };
      } else if (isObject(value) && Array.isArray(value.enum) && isObject(properties[key]) && Array.isArray((properties[key] as Schema).enum)) {
        properties[key] = { ...value, enum: [...new Set([...(properties[key] as { enum: JsonValue[] }).enum, ...value.enum])] };
      } else if (!(key in properties)) properties[key] = value;
    }
  const required = branches.map(b => new Set((b.required ?? []) as string[]))
    .reduce((acc, set) => new Set([...acc].filter(key => set.has(key))));
  return { type: "object", properties, ...(required.size ? { required: [...required] } : {}) };
}

function compact(schema: JsonValue): JsonValue {
  if (Array.isArray(schema)) return schema.map(compact);
  if (!isObject(schema)) return schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (STRIP.has(key)) continue;
    if (key === "additionalProperties") { if (isObject(value)) out[key] = compact(value); continue; }
    if (key === "required" && Array.isArray(value) && value.length === 0) continue;
    if (key === "oneOf" || key === "anyOf") {
      const branches = (value as JsonValue[]).filter(branch => !onlyRequires(branch)).map(compact) as Schema[];
      const unique = branches.filter((branch, i) => branches.findIndex(other => canonicalJson(other, false) === canonicalJson(branch, false)) === i);
      if (!unique.length) continue;
      const merged = mergeBranches(unique);
      if (merged) {
        out.type = "object";
        out.properties = { ...((out.properties as Schema | undefined) ?? {}), ...(merged.properties as Schema) };
        if (merged.required) out.required = merged.required;
      } else if (unique.length === 1) Object.assign(out, unique[0]);
      else out.anyOf = unique;
      continue;
    }
    if (key === "properties" && isObject(value)) {
      out.properties = { ...((out.properties as Schema | undefined) ?? {}), ...Object.fromEntries(Object.entries(value).map(([name, child]) => [name, compact(child)])) };
      continue;
    }
    out[key] = compact(value);
  }
  return out;
}

const LAYER_TOOLS_WITH_NAME = new Set(["paint_cells", "paint_rect", "paint_line", "fill", "smart_brush", "draw_path", "place_entity", "edit_layer"]);
function publish(tool: AgentToolDefinition): AgentToolDefinition {
  const strict = tool.inputSchema as Schema;
  const defs = (strict.$defs ?? {}) as Schema;
  const schema = compact(resolve(strict, defs)) as Schema;
  const properties = { ...((schema.properties as Schema | undefined) ?? {}) };
  let required = ((schema.required ?? []) as string[]).slice();
  // Context is optional everywhere except join_edit; its fields are explained in the instructions.
  if (!required.includes("context")) delete properties.context;
  else properties.context = { type: "object" };
  // mapId defaults to the edit's (or world's) only map; layers can be named.
  required = required.filter(key => key !== "mapId");
  if (LAYER_TOOLS_WITH_NAME.has(tool.name) && "layerId" in properties) {
    properties.layerName = { type: "string" };
    required = required.filter(key => key !== "layerId");
  }
  if (tool.name === "apply_operations")
    properties.operations = { type: "array", items: { type: "object", properties: { tool: { enum: ["paint_cells", "paint_grid", "paint_rect", "paint_line", "place_stamp", "place_entity", "edit_entity"] }, args: { type: "object" } }, required: ["tool", "args"] } };
  if (tool.name === "place_stamp") required = required.filter(key => key !== "at");
  if (tool.name === "validate_map") delete properties.cursor;
  // Repeated value unions are described once (legend values in the tool description).
  if (tool.name === "paint_grid" && isObject(properties.layers) && isObject(properties.layers.items) && isObject(properties.layers.items.properties))
    properties.layers = { ...properties.layers, items: { ...properties.layers.items, properties: { ...properties.layers.items.properties, legend: { type: "object", description: "Same values as legend; merged over it." } } } };
  if (tool.name === "reference_quantize") properties.colorLegend = { type: "object", description: "'#rrggbb' → tile | tag word | {stampId,ground?} | {overlay,ground?} | null | 'keep'" };
  for (const [name, note] of Object.entries(PROPERTY_NOTES[tool.name] ?? {}))
    if (isObject(properties[name])) properties[name] = { ...(properties[name] as Schema), description: note };
  const description = DESCRIPTIONS[tool.name];
  if (!description) throw new Error(`Missing published description for ${tool.name}`);
  return {
    name: tool.name, description, annotations: tool.annotations,
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) } as unknown as AgentToolDefinition["inputSchema"],
  } as AgentToolDefinition;
}

export const PUBLISHED_TOOLS: readonly AgentToolDefinition[] = TOOL_DEFINITIONS.filter(tool => !UNLISTED_TOOLS.has(tool.name)).map(publish);

/** The root is an MCP tools/list result, embedded by Rust and served by the dev bridge. */
export function generateToolsJson(): string {
  return canonicalJson({ tools: PUBLISHED_TOOLS });
}
