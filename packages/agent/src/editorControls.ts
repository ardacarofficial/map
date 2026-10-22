/** Renderer controls are independent of document proposals; none can approve an edit. */
import type { AgentCallContext, EditorContext, Id, Point, ReadContext, Rect, Tile } from "./contracts";
export type EditorTool = "line" | "brush" | "eraser" | "fill" | "rect" | "select" | "eyedropper" | "entity" | "hand";
export type EditorPanel = "tileset" | "stamps" | "project" | "recent" | "inspector" | "history" | "layers" | "entities" | "color" | "aiActivity";
export type EditorZone = "left" | "right" | "bottom";
export interface EditorControlContext { context?: ReadContext }
export interface ConfigureEditorArgs extends EditorControlContext {
  activeMapId?: Id; activeLayerId?: Id; tool?: EditorTool; mode?: "tile" | "pixel";
  gridVisible?: boolean; collisionOverlay?: boolean; minimapVisible?: boolean; rulersVisible?: boolean; panelsHidden?: boolean;
  majorGrid?: { interval: number; x: number; y: number };
  brush?: { size?: number; shape?: "square" | "circle"; collisionValue?: 0 | 1 | 2 };
  rectangle?: { mode?: "filled" | "outline"; thickness?: number };
  selection?: { scope?: "active" | "visible"; mode?: "rectangle" | "connected"; pickScope?: "active" | "all"; region?: Rect | null; tile?: Tile | null; stampId?: Id | null; entityId?: Id | null; entityTypeId?: Id };
  camera?: { view?: "level" | "world"; zoom?: number; center?: Point; frame?: boolean };
  tileset?: { activeId?: Id; view?: "single" | "all"; query?: string; zoom?: number | null };
  pixel?: { size?: number; shape?: "square" | "circle"; scope?: "cell" | "world"; fillMode?: "contiguous" | "global"; filled?: boolean; mirrorH?: boolean; mirrorV?: boolean; foreground?: string; background?: string };
}
export type ConfigureLayoutArgs = EditorControlContext & (
  { action: "reset" } | { action: "zone"; zone: EditorZone; state?: "expanded" | "collapsed" | "hidden"; size?: number } |
  { action: "show" | "hide"; panel: EditorPanel } | { action: "move"; panel: EditorPanel; zone: EditorZone; group?: number; index?: number; split?: "start" | "end" });
export interface ConfigureApplicationArgs extends EditorControlContext { locale?: string; shortcuts?: Record<string, string[] | null> }
export interface ListEditorCommandsArgs extends EditorControlContext { query?: string; offset?: number; limit?: number }
export interface RunEditorCommandArgs extends EditorControlContext { commandId: string }
export interface EditorCommandInfo { id: string; title: string; category: string; enabled: boolean; checked: boolean | null; keys: string[]; remoteExecutable: boolean; alternatives: string[]; reason: string | null }
export interface EditorControlState {
  context: EditorContext; mode: "tile" | "pixel";
  view: { gridVisible: boolean; collisionOverlay: boolean; minimapVisible: boolean | null; rulersVisible: boolean; panelsHidden: boolean; majorGrid: { interval: number; x: number; y: number } };
  brush: { size: number; shape: "square" | "circle"; collisionValue: number };
  rectangle: { mode: "filled" | "outline"; thickness: number };
  selection: { scope: "active" | "visible"; mode: "rectangle" | "connected"; pickScope: "active" | "all"; entityId: Id | null; entityTypeId: Id | null };
  tileset: { activeId: Id | null; view: "single" | "all"; query: string; zoom: number | null };
  pixel: { size: number; shape: "square" | "circle"; scope: "cell" | "world"; fillMode: "contiguous" | "global"; filled: boolean; mirrorH: boolean; mirrorV: boolean; foreground: string; background: string };
  layout: { version: 2; hiddenPanels: EditorPanel[]; rulersVisible: boolean; zones: Record<EditorZone, { state: "expanded" | "collapsed" | "hidden"; expandedPx: number; mode: "tabs" | "split"; groups: { id: string; tabs: EditorPanel[]; active: EditorPanel; weight: number; collapsed: boolean }[] }> };
  application: { locale: string; availableLocales: { id: string; name: string }[]; shortcuts: { command: string; keys: string[]; defaults: string[] }[] };
  capabilities: { documentEdits: "begin_edit → tools → finish_edit → user review"; uiControlsDuringReview: true; commandExecution: "explicit UI allowlist"; canApproveOwnEdits: false; filesystem: false; shell: false };
}
export interface EditorExportPreferences { target: "unity"|"png"|"json"|"tmj"|"zip"|"godot"|"defold"; pngScale: 1|2|4; unityTiles:boolean;unityCollision:boolean;copyTextures:boolean;autoUnity:boolean;excludedLayers:Record<string,string[]> }
export interface ConfigureExportArgs extends EditorControlContext { preferences: Partial<Pick<EditorExportPreferences,"target"|"pngScale"|"unityTiles"|"unityCollision"|"copyTextures"|"autoUnity">> }
export interface AgentEditorControlsPort {
  getExportSettings(call: AgentCallContext): Promise<EditorExportPreferences>;
  configureExport(args: ConfigureExportArgs, call: AgentCallContext): Promise<EditorExportPreferences>;
  getState(): EditorControlState;
  configure(args: ConfigureEditorArgs, call: AgentCallContext): Promise<EditorControlState>;
  configureLayout(args: ConfigureLayoutArgs): EditorControlState;
  configureApplication(args: ConfigureApplicationArgs, call: AgentCallContext): Promise<EditorControlState>;
  listCommands(args: ListEditorCommandsArgs): { items: EditorCommandInfo[]; total: number; nextOffset: number | null };
  runCommand(args: RunEditorCommandArgs): { commandId: string; executed: true; state: EditorControlState };
}
export const EDITOR_CONTROL_TOOLS = ["get_editor_state", "configure_editor", "configure_layout", "configure_application", "list_editor_commands", "run_editor_command", "get_export_settings", "configure_export"] as const;
export type EditorControlToolName = typeof EDITOR_CONTROL_TOOLS[number];
