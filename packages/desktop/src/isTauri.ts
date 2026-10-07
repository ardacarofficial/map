/**
 * Bağımlılıksız Tauri algılama: editör bunu statik içe aktarabilir, tarayıcı
 * paketine `@tauri-apps/api` girmez. Gerisi (`desktopBridge`) yalnız
 * `isTauri()` doğruyken dinamik `import()` ile yüklenir.
 */
export function isTauri(): boolean {
  return typeof globalThis === "object" && "__TAURI_INTERNALS__" in globalThis;
}
