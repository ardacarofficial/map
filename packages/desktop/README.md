# @smap/desktop — Tauri kabuğu (v0.15)

Editörü (`packages/editor`) Windows uygulaması olarak paketler. Bağımlılık yönü
`desktop → editor → core`.

## Aynı anda birden fazla dünya

Masaüstünde bir dünya açıkken **Dosya → Yeni/Aç** veya son dünyalardan seçim,
ayrı bir çalışma penceresi açar. Mevcut dünyanın kaydedilmemiş çizimleri,
geri alma geçmişi ve bekleyen AI taslağı korunur. Aynı dünya tekrar açılırsa
mevcut pencereye odaklanılır. Her pencere kendi kapatma/kaydetme sorusunu yönetir.
Bu özellik masaüstüne aittir; tarayıcı sürümünün mevcut tek dünya akışı korunur.

Her pencerenin MCP bağlantısı, portu ve token'ı ayrıdır. Yeni pencerede
**Uygulama ayarları → AI** bölümünden bağlantıyı etkinleştirip o pencerenin
istemci ayarını kopyalayın. Ana pencerenin mevcut bağlantı ayarı korunur.

## Gerekenler (Windows)

- Rust (stable, `x86_64-pc-windows-msvc`) + Visual Studio Build Tools ("Desktop development with C++")
- WebView2 Runtime (Windows 10/11'de hazır gelir)
- Node 22, pnpm

## Komutlar (depo kökünden)

| Komut | İş |
|---|---|
| `pnpm desktop:dev` | Masaüstü Vite uygulamasını (5173) açar, Tauri penceresini ona bağlar |
| `pnpm desktop:build` | Masaüstü ön yüzünü (`packages/desktop/dist`) derler, sürüm exe'sini ve kurulumu üretir. Windows: NSIS (`src-tauri/target/release/bundle/nsis/Harita Tasarlayıcı_0.15.0_x64-setup.exe`); Linux: `.deb` + AppImage (`tauri.linux.conf.json`, yalnız hattı denemek için) |
| `pnpm --filter @smap/desktop build` | Yalnız ön yüz (`dist/`) |
| `pnpm --filter @smap/desktop test:rust` | Rust çekirdeğinin testleri (`crates/smap-host`, ekransız) |
| `pnpm --filter @smap/desktop test` | TS platformunun testleri |
| `pnpm --filter @smap/desktop typecheck` | TS tip denetimi (editörün kaynaklarıyla birlikte) |

Kurulum kullanıcı başına (`currentUser`): yönetici izni istemez. `.smap`
dosyaları programa bağlanır; çift tıklayınca proje açılır, program açıksa
mevcut pencere öne gelir (tek örnek) ve proje orada açılır (kaydedilmemiş
değişiklik varsa önce sorar).

## Windows'ta derleme (adım adım)

### GitHub'dan EXE indirme

`.github/workflows/windows-exe.yml`, `claude/adoring-bell-0jg3cm` dalındaki
uygulama değişikliklerini Windows x64 üzerinde derler. GitHub → Actions →
**Windows EXE** → başarılı çalıştırma → **Artifacts** bölümünden
`Harita-Tasarlayici-Windows-x64` arşivini indirin. Arşivde NSIS `*-setup.exe`
kurulumu, `harita-tasarlayici.exe`, SHA-256 sağlama toplamları ve kaynak commit
kimliği bulunur. Kurulum için `*-setup.exe` dosyasını çalıştırın; çıplak uygulama
EXE'si WebView2 Runtime gerektirir. Artifacts 30 gün saklanır.

İş akışı `workflow_dispatch` üzerinden de çalıştırılabilir (GitHub'ın manuel
çalıştırma düğmesi için iş akışının varsayılan dalda bulunması gerekir).
İlk Windows çalıştırması tamamlanmadan üretilmiş veya denenmiş EXE olduğu
varsayılmamalıdır.

### Yerel derleme

1. Visual Studio 2022 Build Tools → "Desktop development with C++" (MSVC + Windows SDK).
2. Rust: `rustup default stable-x86_64-pc-windows-msvc`.
3. WebView2 Runtime: Windows 10/11'de hazır (yoksa Evergreen Bootstrapper).
4. Node 22 ve pnpm (`corepack enable`), depo kökünde `pnpm install`.
5. `pnpm desktop:build`. NSIS'i Tauri ilk derlemede kendisi indirir
   (`%LOCALAPPDATA%\tauri\NSIS`); ağ yoksa NSIS 3'ü elle kurup PATH'e ekleyin.
6. Kurulum: `packages\desktop\src-tauri\target\release\bundle\nsis\Harita Tasarlayıcı_0.15.0_x64-setup.exe`.
7. Açılış süresini ölçmek: programı açıp kapatın, log'da
   `startup ms: script …, ready …` satırı ve `window shown (frontend ready)`
   zaman damgası. Bitti ölçütü: süreç başlangıcından pencere görünene < 1 sn.
   `.smap` ile açılışta pencere hemen editör iskeletiyle görünür, proje
   okununca dolar (log: `startup project ms`). Linux'ta (Xvfb) otomatik
   ölçüm: sürüm derlemesinden sonra `pnpm perf -g desktop` (bkz. `e2e/perf`).

İmzasız exe ilk açılışta SmartScreen uyarısı verebilir (kod imzalama
kapsam dışı, CLAUDE.md › Yapılmayacaklar).

## Yapı

```text
index.html, src/main.ts    masaüstü ön yüzü: editörün startEditor'ı + desktopPlatform
vite.config.ts             editörün Vite eklentileriyle (editor/vite.plugins.ts) derler
src/
  desktopPlatform.ts       editörün Platform arayüzü (diyalog, proje, izleyici, son projeler, ayar, log)
  desktopBridge.ts         Tauri komutlarının ince sarmalayıcıları
  tauriFileSystem.ts       editörün ProjectFileSystem arayüzü
  isTauri.ts               bağımlılıksız algılama
src-tauri/
  tauri.conf.json          pencere, NSIS, .smap ilişkilendirmesi
  tauri.linux.conf.json    Linux paket türleri (deb, AppImage)
  capabilities/            yalnız core:default (fs/dialog eklenti izni yok)
  src/lib.rs               ince Tauri komutları, eklentiler, pencere
  crates/smap-host/        Tauri'siz çekirdek: güvenli kayıt, kapsam, izleyici, son projeler, ayar dosyası, log
```

Vite bu pakete ayrıca kurulmaz: betikler editörün Vite'ını
`--config ../desktop/vite.config.ts` ile çalıştırır.

## Güvenlik modeli

Webview'e fs eklentisi verilmez. Dosya komutları mutlak yol alır ve Rust
tarafında doğrulanır: yol `..` içeremez, var olan atası kanonikleştirilir,
sonuç açık projenin klasöründe ya da kullanıcının seçtiği bir yolda olmalı.
Diyaloglar Rust'tan açılır; seçilen yol kapsama orada eklenir. Proje
kapanınca o klasöre erişim veren izinler düşer. Son projeler (`recent.json`,
uygulama ayar klasöründe) kalıcı izin yerine geçer: listedeki bir
`project.smap` yeniden başlattıktan sonra diyalogsuz açılabilir, açarken
varlığı yeniden doğrulanır.

## Dosyalar

- Log: `%LOCALAPPDATA%\com.smap.haritatasarlayici\logs\harita.log` (5 × 1 MB, dönen)
- Son projeler: `%APPDATA%\com.smap.haritatasarlayici\recent.json`
- Ayarlar: `%APPDATA%\com.smap.haritatasarlayici\settings.json` — ilk açılışta
  tüm komutların mevcut tuşlarıyla yazılır. Biçim:
  `{ "locale": "tr" | "en", "shortcuts": { "tool.brush": ["B"], … } }`.
  Listelenen komut tam olarak verilen tuşları alır (`[]` kısayolu kaldırır),
  listelenmeyen varsayılanını korur. Geçersiz kayıt log'a yazılır, bildirimle
  gösterilir ve yok sayılır. Dosya pencere odağa dönünce yeniden okunur;
  komut paletindeki "Kısayol ayarlarını aç…" aynı dosyayı düzenler.

## Editörle bağlantı

Editör masaüstünü tanımaz (`desktop → editor → core`, lint ile zorlanır).
`src/main.ts`:

```ts
import { startEditor } from "@smap/editor";
import { createDesktopPlatform } from "./desktopPlatform";

void startEditor(document.getElementById("root")!, { platform: createDesktopPlatform() });
```

`startEditor` ayarları (dil) yükler, arayüzü çizer, açılış argümanındaki
`.smap`'i açar, sonra `appReady()` ile gizli pencereyi gösterir. İzleyici
olayları editörün "diskte değişti" denetimini besler; `tilesets/*.png`
değişince tileset yeniden okunur (Aseprite'tan kaydetmek yeter).

Not: pencerenin `dragDropEnabled: false` ayarı, editörün HTML5 sürükle-bırak
(PNG tileset) akışının Windows'ta da çalışması içindir.
