# Harita Tasarlayıcı

Tileset'lerdeki sprite'ları ızgaraya dizerek 2D harita çizen, kaydeden ve oyuna aktaran bir tile map editörü. Tarayıcıda ve Tauri ile Windows masaüstü uygulaması olarak çalışır. Katmanlar, akıllı fırça/stamp, manuel çarpışma, entity'ler (spawn, portal…), piksel düzenleme, çoklu harita, dünya görünümü ve MCP üzerinden AI kumanda içerir. Unity (top-down), Tiled TMJ, Godot 4, Defold, PNG, JSON ve Zip dışa aktarma hedefleridir. Tek geliştirici Arda; plan ve kararlar [`CLAUDE.md`](CLAUDE.md) içinde.

## Durum

Güncel kapsam ve kararlar `CLAUDE.md` içindedir. Otomatik testler ve derleme, gerçek motor/masaüstü denemesinin yerini tutmaz; doğrulama gerektiren başlıklar:

- **Unity 6.3'te gerçek import.** C# kodu Unity referanslarıyla derlendi, testleri .NET'te geçti; ama Unity editöründe uçtan uca denenmedi.
- **Windows'ta NSIS kurulumu, `.smap` çift tıklama ve < 1 sn açılış.** Linux'ta doğrulandı; Windows'ta ölçülmedi.

## Hızlı başlangıç

Gerekenler:

- Node 22 ve pnpm 10+ (`corepack enable`)
- Yalnız masaüstü için: Rust (stable) ve Windows'ta WebView2 Runtime (ayrıntı: [`packages/desktop/README.md`](packages/desktop/README.md))

```bash
pnpm install
pnpm dev            # editör tarayıcıda (Vite, 5173)
pnpm desktop:dev    # Tauri penceresinde
pnpm desktop:build  # sürüm exe'si + kurulum (Windows: NSIS)
```

## Komutlar

Hepsi depo kökünden çalışır.

| Komut | İş |
|---|---|
| `pnpm dev` | Editörü tarayıcıda açar |
| `pnpm build` | Tüm paketleri derler (`tsc` + Vite) |
| `pnpm test` | Vitest, tüm birim testleri (`core`, `editor`, `desktop`) |
| `pnpm test:watch` | Vitest izleme modu |
| `pnpm test:e2e` | Playwright uçtan uca testleri (`e2e/`) |
| `pnpm perf` | Playwright performans ölçümleri (`e2e/perf`) |
| `pnpm typecheck` | Tüm paketlerde TypeScript denetimi |
| `pnpm lint` | ESLint (bağımlılık yönü kuralları dahil) |
| `pnpm desktop:dev` | Tauri geliştirme penceresi |
| `pnpm desktop:build` | Masaüstü sürümü ve kurulum paketi |
| `pnpm --filter @smap/desktop test:rust` | Rust çekirdeğinin (`smap-host`) testleri |

## AI ile harita tasarlama

MCP bağlantısında AI, açık editördeki gerçek haritaları ve görselleri inceler; değişiklikler kullanıcı onayını bekleyen ortak bir taslakta görünür. [Harita tasarlama rehberi](packages/agent/guide/overview.md), niyeti planlamayı, az ve anlamlı katman rolleriyle çalışmayı, art keşfini, bölge paylaşımını ve görsel doğrulamayı açıklar. Bunlar sabit katman sayısı veya tasarım şablonu dayatmaz; sonuç sonradan kolay düzenlenebilsin diye yol gösterir.

[Depodaki Harita skill'i](.agents/skills/harita-map-authoring/SKILL.md) aynı rehbere kısa bir giriş sunar. Bağlanan istemci MCP kaynaklarını ihtiyaç oldukça okuyabilir; bütün rehberi her isteme eklemek gerekmez. Araçların kesin argümanları ve örnekleri [Agent API rehberindedir](packages/agent/README.md).

## Klasör yapısı

```text
packages/
├── core/       harita verisi, işlemler, undo, kaydet/aç, akıllı stamp, dışa aktarma (React/Pixi/DOM/Tauri bilmez)
├── editor/     editör: src/canvas (PixiJS tuval), ui (React paneller), io (proje dosyaları),
│               commands, state, shortcuts, i18n, theme, platform (tarayıcı/masaüstü arayüzü), export
└── desktop/    Tauri kabuğu
    ├── src/                       masaüstü ön yüzü ve Platform uygulaması
    └── src-tauri/                 Tauri yapılandırması, lib.rs
        └── crates/smap-host/      Tauri'siz Rust çekirdeği (güvenli kayıt, izleyici, son projeler, log)
unity/com.smap.mapimporter/        Unity 6.3+ paketi (ScriptedImporter, çalışma zamanı bileşenleri, testler)
e2e/                               Playwright testleri (tests/) ve performans ölçümleri (perf/)
samples/tilesets/                  örnek tileset PNG'leri ve şablon notları
```

Bağımlılık yönü: `desktop → editor → core`. Lint ile zorlanır.

## Proje dosya düzeni

Bir proje, içinde `project.smap` bulunan bir klasördür (çift tıklanan dosya bu):

```text
Proje/
├── project.smap     proje dosyası
├── levels/          level başına tek JSON
├── tilesets/        tileset PNG'leri (Aseprite'tan kaydedince editör yeniden okur)
├── stamps/          kayıtlı stamp'ler
└── backups/         son 10 otomatik kayıt
```

## Kısayollar

"Ctrl" macOS'ta Cmd'dir. Kaynak: [`packages/editor/src/shortcuts/shortcuts.ts`](packages/editor/src/shortcuts/shortcuts.ts). Komut paleti (`Ctrl+K`) tüm komutlara, tuşu olmayanlara da ulaştırır.

| Komut | Tuş |
|---|---|
| Fırça | `B` |
| Silgi | `E` |
| Doldur | `F` |
| Dikdörtgen | `R` |
| Seç | `S` |
| Damlalık | `I` |
| Entity aracı | `O` |
| Geri al | `Ctrl+Z` |
| Yinele | `Ctrl+Y`, `Ctrl+Shift+Z` |
| Kes / Kopyala / Yapıştır | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` |
| Sil | `Delete`, `Backspace` |
| Tümünü seç | `Ctrl+A` |
| Seçimi kaldır | `Esc` |
| Yatay / dikey çevir (seçili tile veya stamp) | `X` / `Y` |
| Izgarayı aç/kapat | `Ctrl+G` |
| Çarpışma görünümünü aç/kapat | `Ctrl+Shift+C` |
| Panelleri gizle/göster | `Tab` |
| Yakınlaştır / uzaklaştır / sıfırla | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Haritaya sığdır | `Shift+1` |
| Kaydır | `Space` basılıyken sürükle |
| Dünya görünümü (level görünümüne dönüş: `Esc`) | `W` |
| Komut paleti | `Ctrl+K`, `Ctrl+Shift+P` |
| Yeni / Aç / Kaydet / Farklı kaydet | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| Dışa aktar | `Ctrl+E` |
| Yeni katman | `Ctrl+Shift+N` |

Tuşu olmayan komutlar (palet): projeyi kapat, yedekten aç, tileset ekle, katman sil, harita boyutu, çarpışma/entity katmanı ekle, entity tipleri, stamp kaydet ve uygulama ayarları. Dil ve kısayollar Uygulama Ayarları'ndan düzenlenir; masaüstünde `settings.json` dosyasına kaydedilir (biçim: [`packages/desktop/README.md`](packages/desktop/README.md)).

## Unity'ye aktarma

1. Unity projesine paketi ekle: Package Manager › Add package from disk › `unity/com.smap.mapimporter/package.json` (Unity 6.3 LTS+).
2. Editörde `Ctrl+E` ile dışa aktar, hedef klasör Unity projesinin `Assets/` altında olsun (örn. `Assets/Maps/`). Klasöre `<level>.smapmap` ve kullanılan tileset PNG'leri yazılır.
3. Unity `.smapmap` dosyasını prefab olarak içe aktarır (Ground/Deco Tilemap'leri, çarpışma, entity'ler, spawn). Sahneye sürükle.
4. Değişiklik sonrası yeniden dışa aktar; prefab yerinde güncellenir.

Bağlantı yalnızca dosyalarla çalışır, canlı senkron yok. Ayrıntılar (koordinatlar, çarpışma, `SmapEntity`/`SmapSpawn`, portal): [`unity/com.smap.mapimporter/README.md`](unity/com.smap.mapimporter/README.md). Dosya biçimi: [`packages/core/src/export/FORMAT.md`](packages/core/src/export/FORMAT.md).

## Diğer motorlar

Editör Tiled uyumlu **TMJ** (`<level>.tmj` + tileset PNG'leri) yanında Godot 4 ve Defold hedeflerine doğrudan aktarır. Phaser için TMJ kullanılabilir. Ayrıca PNG, Zip ve motordan bağımsız oyun JSON'u (`smapExport 1`) dışa aktarılabilir. Biçimlerin ayrıntısı [`FORMAT.md`](packages/core/src/export/FORMAT.md) içinde.

## Testler

| Tür | Nerede | Çalıştırma |
|---|---|---|
| Birim (Vitest; `core` için fast-check ile özellik tabanlı) | `packages/core/test`, `packages/editor/src/**`, `packages/desktop/src` | `pnpm test` |
| Uçtan uca (Playwright) | `e2e/tests` | `pnpm test:e2e` |
| Performans (Playwright) | `e2e/perf` | `pnpm perf` |
| Rust | `packages/desktop/src-tauri/crates/smap-host` | `pnpm --filter @smap/desktop test:rust` |
| C# (Unity EditMode) | `unity/com.smap.mapimporter/Tests/Editor` | Unity Test Runner (paketi `testables`'a ekle, bkz. paket README'si) |
