# @smap/desktop — Tauri kabuğu (v0.5)

Editörü (`packages/editor`) Windows uygulaması olarak paketler. Bağımlılık yönü
`desktop → editor → core`.

## Gerekenler (Windows)

- Rust (stable, `x86_64-pc-windows-msvc`) + Visual Studio Build Tools ("Desktop development with C++")
- WebView2 Runtime (Windows 10/11'de hazır gelir)
- Node 22, pnpm

## Komutlar (depo kökünden)

| Komut | İş |
|---|---|
| `pnpm desktop:dev` | Editörün Vite sunucusunu (5173) açar, Tauri penceresini ona bağlar |
| `pnpm desktop:build` | Editörü derler, sürüm exe'sini ve NSIS kurulumunu üretir: `packages/desktop/src-tauri/target/release/bundle/nsis/Harita Tasarlayıcı_0.5.0_x64-setup.exe` |
| `pnpm --filter @smap/desktop test:rust` | Rust çekirdeğinin testleri (`crates/smap-host`, ekransız) |
| `pnpm --filter @smap/desktop test` | TS köprüsünün testleri |
| `pnpm --filter @smap/desktop typecheck` | TS köprüsünün tip denetimi |

Kurulum kullanıcı başına (`currentUser`): yönetici izni istemez. `.smap`
dosyaları programa bağlanır; çift tıklayınca proje açılır, program açıksa
mevcut pencere öne gelir (tek örnek).

## Yapı

```text
src/                       editörün içe aktaracağı TS köprüsü
  isTauri.ts               bağımlılıksız algılama (statik içe aktarılabilir)
  desktopBridge.ts         diyaloglar, proje açma, olaylar, son projeler, log, appReady
  tauriFileSystem.ts       editörün ProjectFileSystem arayüzü
src-tauri/
  tauri.conf.json          pencere, NSIS, .smap ilişkilendirmesi
  capabilities/            yalnız core:default (fs/dialog eklenti izni yok)
  src/lib.rs               ince Tauri komutları, eklentiler, pencere
  crates/smap-host/        Tauri'siz çekirdek: güvenli kayıt, kapsam, izleyici, son projeler, log
```

## Güvenlik modeli

Webview'e fs eklentisi verilmez. Dosya komutları mutlak yol alır ve Rust
tarafında doğrulanır: yol `..` içeremez, var olan atası kanonikleştirilir,
sonuç açık projenin klasöründe ya da kullanıcının seçtiği bir yolda olmalı.
Diyaloglar Rust'tan açılır; seçilen yol kapsama orada eklenir. Son projeler
(`recent.json`, uygulama ayar klasöründe) kalıcı izin yerine geçer: listedeki
bir `project.smap` yeniden başlattıktan sonra diyalogsuz açılabilir, açarken
varlığı yeniden doğrulanır.

## Dosyalar

- Log: `%LOCALAPPDATA%\com.smap.haritatasarlayici\logs\harita.log` (5 × 1 MB, dönen)
- Son projeler: `%APPDATA%\com.smap.haritatasarlayici\recent.json`

## Editörle bağlantı

```ts
import { isTauri } from "../../desktop/src/isTauri";

if (isTauri()) {
  const desktop = await import("../../desktop/src/desktopBridge");
  desktop.installErrorLogging();
  await desktop.onOpenFile(async (path) => {
    const { project, fs } = await desktop.openProject(path);
    // fs: ProjectFileSystem — mevcut loadProject(fs) akışına verilir
  });
  await desktop.onFileChanged(({ path, kind }) => {
    // desktop.toProjectPath(fs.root, path) → "tilesets/grass.png"
  });
  await desktop.appReady(); // ilk kare çizildikten sonra
}
```

Not: pencerenin `dragDropEnabled: false` ayarı, editörün HTML5 sürükle-bırak
(PNG tileset) akışının Windows'ta da çalışması içindir.
