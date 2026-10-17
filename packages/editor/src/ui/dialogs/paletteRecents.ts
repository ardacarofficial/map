const KEY = "smap.palette.recent";
let memory: string[] = [];
let storageUnavailable = false;

export function readPaletteRecents(): string[] {
  if (!storageUnavailable) {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(stored)) memory = [...new Set(stored.filter((id): id is string => typeof id === "string"))].slice(0, 5);
    } catch { storageUnavailable = true; }
  }
  return [...memory];
}

export function rememberPaletteCommand(id: string): void {
  memory = [id, ...readPaletteRecents().filter(previous => previous !== id)].slice(0, 5);
  if (!storageUnavailable) {
    try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { storageUnavailable = true; }
  }
}
