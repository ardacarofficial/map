/**
 * Public surface of `@smap/editor` for hosts (the desktop shell). The
 * browser build uses `main.tsx`; both call `startEditor`.
 */
export { startEditor, type StartEditorOptions } from "./bootstrap";
export {
  browserPlatform,
  FolderTakenError,
  folderNameFor,
  getPlatform,
  RecentGoneError,
  setPlatform,
  type FileChangeKind,
  type LogLevel,
  type Platform,
  type ProjectFileChange,
  type ProjectLocation,
  type RecentEntry,
  type SaveFileFilter,
} from "./platform";
export { FileNotFoundError, type ProjectFileSystem } from "./io/fs";
