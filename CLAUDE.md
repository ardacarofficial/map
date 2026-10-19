# Harita Tasarlayıcı

Tileset'lerdeki sprite'ları ızgaraya dizerek 2D harita çizen, kaydeden ve oyuna aktaran Windows masaüstü programı. Arda tek başına geliştiriyor; ilk kullanıcı kendisi, hedef motor Unity (top-down oyun).

## Nereden geldik

Proje, 97 bölümlük bir "master doküman" ile başladı. O doküman ticari bir ürün kurguluyordu: canlı Unity senkronu, lisans, fiyat, pazarlama, 700–970 saatlik yol haritası. Ekim 2026'da baştan değerlendirildi ve şu kararlar alındı:

- **Satış yok.** Fiyat, lisans, pazarlama, müşteri edinimi tamamen çıkarıldı.
- **Ağır kurgular basitleştirildi.** Eski doküman her özelliği "program her şeyi kendi takip etsin" diye kurmuştu. Yeni ilke: ya kullanıcı bir düğmeye basar ya da program sorar.
- **Teknik hatalar düzeltildi.** Beş ayrı inceleme güncel kaynaklarla yapıldı; bulgular aşağıdaki "Veri kararları" ve "Bilinen tuzaklar" bölümlerine işlendi.

Eski dokümana dönülmez. Bu dosya tek geçerli plandır.

## Neden yapıyoruz

Rakipler ücretsiz ve güçlü, ama arayüzleri eski:

| Rakip | Güçlü yanı | Zayıf yanı |
|---|---|---|
| Tiled | En olgun, her şeyi yapar | 2000'lerin masaüstü görünümü, iç içe menüler |
| LDtk | Entity, autotile, dünya görünümü | Kendine özgü, alışması zor düzen |
| Sprite Fusion | Temiz, güncel arayüz | Özelliği az |
| Unity'nin kendi Tilemap'i | Aktarma adımı yok | Çizim araçları kısıtlı |

Boşluk: güçlü özellikleri olan ama bugünün programı gibi hissettiren editör yok. Hedef rakiplerden fazla özellik değil, bu his. Figma, Linear ve VS Code referans.

## Öncelikler

1. **Kalite:** her özellik cilalı ve hatasız biter. Yarım özellik eklenmez.
2. **Hız:** anında açılır, fırça gecikmez, büyük haritada takılmaz.
3. **Akıcılık:** zoom, kaydırma ve çizim kesintisizdir; kullanıcı menü aramaz.
4. **Modern özellikler:** command palette, sürükle-bırak, canlı önizleme, karşılama ekranı.

Yeni özellik ile mevcut özelliğin cilası çakışırsa cila kazanır.

## Çalışma kuralları

- Sırayla tek sürüm üzerinde çalış. Sürümün "bitti" ölçütü sağlanmadan sonrakine geçme.
- Her sürümün sonunda programı çalıştırıp dene, sonucu göster, onay bekle.
- Aşağıdaki listede olmayan özellik ekleme. Fikir çıkarsa öner, karar Arda'nın.
- "Yapılmayacaklar" listesindekileri hiçbir biçimde geri getirme.
- Arda "başla" demeden kod yazma veya bir şey kurma.
- Arda ile Türkçe, samimi, kısa ve net konuş. Seçenek listesi yerine tek öneri ver; karşılaştırmaları tabloyla sun.
- Arda tasarımı sonradan baştan değiştirebilir. Bu, `core`'u etkilememeli (bkz. Mimari).

## Teknoloji

| Katman | Seçim | Neden |
|---|---|---|
| Dil | TypeScript (strict) | Her şey tek dilde |
| Çizim | PixiJS v8, yalnızca WebGL2 | Tuvali ekran kartı çizer. PixiJS üretimde WebGL öneriyor; WebGPU kullanılmaz |
| Arayüz | React + Zustand | Yalnızca paneller. `@pixi/react` kullanılmaz, Pixi doğrudan sürülür |
| Stil | Tailwind v4 + Base UI | Renk ve ölçüler tek yerden. Base UI stil dayatmaz; command palette, menü ve dialog gibi parçaları erişilebilir hazır verir, arayüz baştan tasarlanınca engel olmaz |
| Masaüstü | Tauri 2 | Electron'a göre küçük ve hızlı açılır. v0.5'e kadar tarayıcıda geliştirilir |
| Araçlar | Vite, pnpm workspaces | Turborepo yok; tek kişiye fazla |
| Test | Vitest + fast-check | `core` için özellik tabanlı test |
| Unity | C# paketi, `ScriptedImporter` | En düşük Unity 6.3 LTS |

Kurulu: Node 22, pnpm 11, git. Rust kurulu değil; v0.5'te gerekecek. Klasör henüz git deposu değil; başlarken depo yapılacak.

## Mimari

```text
packages/
├── core      harita verisi, işlemler, undo, kaydet/aç, akıllı stamp
├── editor    tuval çizimi (PixiJS) + paneller (React), ayrı klasörlerde
└── desktop   Tauri kabuğu
```

Bağımlılık yönü: `desktop → editor → core`.

- `core` React, PixiJS, DOM ve Tauri'yi tanımaz. Lint ile zorlanır. Böylece testler ekransız çalışır.
- Arayüz `core`'a yalnızca komut yollar ("şu hücreleri boya", "geri al") ve değişiklikleri dinler. Tile verisi React state'inde durmaz.
- Haritayı değiştiren her şey bir işlemdir; doğrudan `map.tiles[x][y] = ...` yazılmaz. Undo, otomatik kayıt ve dışa aktarma aynı işlem akışından beslenir.
- Renk, boşluk ve yazı ölçüleri tek dosyadaki tasarım değişkenlerindedir. Arayüz baştan tasarlansa bile `core`, dosya formatı ve Unity tarafı değişmez.
- Arayüzdeki her metin çeviri dosyasından, her kısayol tek listeden gelir. İkisi de v0.1'de kurulur; sonradan eklemek tüm kodu elden geçirmek demek.

## Veri kararları

| Konu | Karar | Neden |
|---|---|---|
| Hücre | `Uint32`: alt bitler palet indeksi, üst 3 bit çevirme bayrağı, 0 boş | `Int32`'de üst bit sayıyı eksiye düşürür. Çevirme bitleri baştan olmazsa stamp çevirme sonradan formatı bozar |
| Palet | Belge başına tablo: indeks → `{tilesetId, tileId}` | Hücre sayı, tile kimliği metin; aradaki bağ bu tablo |
| Tile kimliği | Tileset ızgarasındaki sıra numarası | Tiled ve Godot da böyle. Kural: tileset'e ekleme sona yapılır, mevcut tile'lar yerinde kalır |
| Depolama | Katman başına 32×32'lik seyrek chunk; boş chunk oluşturulmaz | Büyük haritada bellek ve hız |
| Chunk adresi | `x >> 5` ve `x & 31` | JS'te `/` ve `%` eksi sayılarda yanlış sonuç verir |
| Harita sınırı | Genişlik ve yükseklik var, sonradan büyütülebilir | Sonsuz tuval fill, dışa aktarma ve minimap'i "sınır nerede" sorusuyla uğraştırır |
| Koordinat | Editörde y aşağı doğru | Unity y yukarı; çevirme yalnızca dışa aktarıcıda ve testle |
| Katman türleri | Tile, Izgara (manuel Collision), Entity | Arazi katmanı/seti yoktur |
| Autotile / akıllı stamp | Kullanıcıya dönük arazi seti ve tile etiketi yoktur; akıllı stamp açıkça seçilen kaynağın sınırlarını çözer ve sıradan tile hücreleri yazar | Ekim 2026 kararı, Arda: Katı/Arazi kaldırıldı; yol bağlantı çözücüsü smart-stamp modülündedir |
| Collision | Yalnız manuel Collision ızgara katmanları; üstteki dolu karar kazanır | Tileset solid flag ve otomatik collision kaldırıldı (Ekim 2026, Arda) |
| Varyant seçimi | `hash(seed, x, y)` | Sıralı rastgele sayı kullanılırsa undo ve yeniden açmada tile'lar değişir |
| Undo | Fareye basıştan bırakışa tek işlem; değişen hücrelerin `{önce, sonra}` yaması | Geri alma ikisini yer değiştirir, ayrı "ters işlem" tutulmaz |
| Sürüm numarası | Tek `documentFormatVersion` | |

### Dosya düzeni

```text
benim-dunyam/
├── project.smap        proje dosyası; çift tıklanan bu
├── levels/             level başına tek JSON
├── tilesets/
├── stamps/
└── backups/            son 10 otomatik kayıt
```

- Windows'ta klasör bir programa bağlanamaz; o yüzden proje bir dosyadır, klasör değil.
- Chunk başına ayrı dosya yok: büyük haritada binlerce küçük dosya çıkar.
- JSON çıktısı her seferinde aynı bayttır: sabit anahtar sırası, nesne anahtarı yerine sıralı dizi, `\n` satır sonu.

## Arayüz

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Uygulama çubuğu · menüler · proje / belge sekmeleri · dışa aktar                │
├────┬─────────────────────────────┬───────────────────────┬──────────────────────┤
│Araç│ Tileset | Stamp’ler | Proje │ Araç seçenekleri      │ Denetçi | Geçmiş     │
│rayı├─────────────────────────────┼───────────────────────┼──────────────────────┤
│    │ Tileset ızgarası            │                       │ Özellikler           │
│    │                             │       Tuval           ├──────────────────────┤
│    │                             │                       │ Katmanlar            │
│    │                             ├───────────────────────┤                      │
│    │                             │ Son kullanılanlar     │                      │
├────┴─────────────────────────────┴───────────────────────┴──────────────────────┤
│ Durum çubuğu                                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Mavi-gri koyu tema (zemin `#11171c`, panel `#1b212a`, vurgu `#69c9ae`; konsept görsellerinden alındı), tek vurgu rengi, Inter + JetBrains Mono, 12–13 piksel yazı. Arda değiştirebilir.
- Üç dock bölgesi vardır: Sol, Sağ, Alt. Tileset solda; alt bölgede varsayılan yalnız Son kullanılanlar bulunur. Stamp'ler, Proje, Denetçi, Geçmiş, Katmanlar ve gerektiğinde görünen Entity paleti bu bölgeler arasında sekmeleri sürükleyerek veya Taşı menüsüyle taşınır; sekmeler sıralanır ve bölümler halinde bölünebilir. Yüzen pencere yoktur.
- Her bölge kenarından boyutlandırılır; başlık chevron'u, ayırıcıya çift tıklama ve kendi kısayolu ile açılır/daralır; Görünüm menüsünden tamamen gizlenebilir. Boyut ve yerleşim hatırlanır; Düzeni sıfırla varsayılanları getirir. Ctrl+B Sol, Ctrl+Alt+B Sağ, Ctrl+Shift+B Alt. Tab yalnız tuval odaktayken tüm bölgeleri, araç rayını ve minimap'i geçici gizler; tekrar basınca önceki düzeni getirir.
- Dolu 3×3 tileset seçimi doğrudan akıllı fırçadır. 1 hücrelik kenar bantlı daha büyük n×m bloklar kenar ve merkez tekrarlarıyla köşe/kenar/dolgu yapısı doğrulanırsa otomatik algılanır. Kaydedilen stamp aynı akıllı kaynağı korur. B ve Shift çizgisi Yol, R Alan varsayılanıdır; Alan | Yol ile araç başına değiştirilir, yeni fırçada sıfırlanır. İki hücre veya daha kalın kenar bantları (b≥2) algılanmaz. Akıllı davranış araç seçeneklerindeki tek Akıllı anahtarından kapatılır; F mevcut desen doldurmayı sürdürür.
- Boş ekran gösterilmez; program karşılama ekranıyla açılır.
- Kısayollar Tiled alışkanlığına uyar:

| Tuş | İş |
|---|---|
| B / E / F / R | Fırça / silgi / fill / dikdörtgen |
| X / Y | Seçili tile veya stamp'i çevir |
| Sağ tık | Haritadan tile al (sürükleyince alan alır) |
| Boşluk veya orta tuş | Kaydır |
| Tekerlek | Zoom |
| Ctrl+G | Izgarayı aç/kapa |
| Ctrl+B / Ctrl+Alt+B / Ctrl+Shift+B | Sol / Sağ / Alt bölgeyi aç/daralt |
| Tab | Yalnız tuval odaktayken bölgeleri, araç rayını ve minimap’i geçici gizle/geri getir |
| F6 / Shift+F6 | Tuval → sol gruplar → sağ gruplar → alt gruplar; ters yönde dolaş |
| Ctrl+K, Ctrl+Shift+P | Command palette |

## Sürümler

### v0.1 — Çizilebilir
- Tuval: kaydırma, imlece doğru akıcı zoom, ızgara
- PNG tileset'i sürükle-bırak ile yükleme, tile seçme
- Kalem ve silgi; fırçanın altında seçili tile'ın yarı saydam önizlemesi
- Kaydet / aç
- Karşılama ekranı: yeni proje, aç, tileset bırak
- Command palette
- Altyapı: hücre formatı, palet, chunk'lar, işlem akışı, çeviri dosyası, kısayol listesi, tasarım değişkenleri

**Bitti:** tileset bırakılıp harita çizilir, kaydedilir, program kapatılıp açılınca aynı harita gelir.

### v0.2 — Kullanılabilir
- Katmanlar: ekle, sil, gizle, kilitle, sırala, opaklık
- Undo / redo
- Fill, dikdörtgen, seçim, kes / kopyala / yapıştır
- Damlalık ve sağ tıkla haritadan tile alma
- Haritayı yeniden boyutlandırma
- Otomatik kayıt, son 10 kaydın yedek klasörü. Eski sürüme dönmek, yedeği açmaktır
- Dosya diskte değişmişse pencereye dönünce sor: diskten yükle / benimkini koru

**Bitti:** rastgele işlem dizisi uygulanıp tümü geri alınınca harita başlangıçla birebir aynıdır (otomatik test).

### v0.3 — Arazi
- ~~Tileset'te tile'a "katı" işareti; otomatik collision~~ — **Kaldırıldı (Ekim 2026 kararı, Arda).**
- Manuel Collision katmanı (korunur)
- ~~Autotile: tileset'te bir blok "bu arazi" diye işaretlenir, program standart şablona göre hangi tile'ın nereye gideceğini bilir. Kullanıcı kural yazmaz~~ — **Kaldırıldı (Ekim 2026 kararı, Arda).**
- ~~İki şablon: 16-köşe ve 47-blob (hazır tileset'lerin çoğu blob düzeninde)~~ — **Kaldırıldı (Ekim 2026 kararı, Arda).**

**Bitti:** arazi fırçasıyla çizilen şeklin kenarları ve köşeleri kendiliğinden doğru tile'ı alır; geri alınca eski hali birebir döner. Tarihsel ölçüt; arazi kısmı kaldırıldı (Ekim 2026 kararı, Arda).

### v0.4 — Oyuna aktarma
- PNG ve JSON dışa aktarma
- Unity içe aktarıcı: editör dosyayı Unity proje klasörüne yazar, `ScriptedImporter` prefab'a çevirir (Grid + katman başına Tilemap). Canlı bağlantı yok
- Tiled (TMJ) dışa aktarma; böylece Godot ve Phaser gibi motorlarda da açılır

**Bitti:** çizilen harita Unity'de collision'ıyla birlikte doğru yönde görünür; editörde kaydedince Unity'de güncellenir.

**Karar noktası:** burada gerçek bir oyun haritası çizilir. Çizerken başka editör aranıyorsa durulur ve neyin eksik olduğu konuşulur.

### v0.5 — Masaüstü
- Tauri ile Windows uygulaması, güvenli kayıt
- Minimap; uzak zoom'da aynı küçük resim kullanılır
- Türkçe ve İngilizce arayüz
- PNG tileset kaydedilince kendiliğinden yenilenir. Aseprite'tan PNG olarak kaydetmek yeter
- Zip olarak dışa aktarma
- Kısayollar ayar dosyasından değiştirilebilir; ayrı ekran yok
- Log dosyası

**Bitti:** kurulan `.exe` bir saniyenin altında açılır ve `.smap` dosyasına çift tıklayınca proje gelir.

### v0.6 — Hazır parçalar
- Çok katmanlı stamp: bir seçim tüm katmanlarıyla kaydedilir (örneğin ev: zemin, duvar, çatı, collision), tek tıkla yerleşir, X/Y çevrilir. Haritaya düz kopyalanır
- Rastgele fırça: birkaç tile seçilir, fırça aralarından rastgele koyar
- Entity katmanı: NPC, kapı, sandık gibi nesneler. Türler ve alanları editörde tanımlanır, dışa aktarırken JSON'a yazılır
- Başlangıç noktası işareti: oyun bunu okuyup oyuncuyu oradan başlatır

**Bitti:** kayıtlı bir ev stamp'i tek tıkla tüm katmanlarıyla yerleşir.

### v1.0 — Çoklu harita
- Bir projede birden fazla level, yan panelde level listesi
- Her level'ın sabit kimliği ve dünya konumu olur. Sonraki iki sürüm bunlara dayanır

### v1.1 — Portal
Oyunda çalışan bir ışınlanma değil; editörde "bu kapı şuraya çıkıyor" diyen işaret.
- Entity katmanında, iki alanı olan işaret: hedef level (listeden seçilir) ve hedef nokta
- Üstünde etiket görünür ("→ Zindan"); çift tıklayınca hedef level'ı açıp o noktaya gider
- Hedef silinmişse işaret kırmızı olur. Otomatik onarım yok
- Bağlantı level'ın adına değil sabit kimliğine bakar; ad değişince kopmaz

### v1.2 — Dünya haritası
Ayrı bir editör değil; mevcut tuvalin ikinci görünümü.
- Level'lar küçük resim olarak tek tuvalde durur; sürüklenir, ızgaraya oturur, tıklayınca açılır
- Portal bağlantıları iki level arasında çizgi olarak görünür
- Komşu level'ın kenarını çizerken görme, otomatik yapışma, üst üste binme kontrolü yok

### v1.3 — Rahat kullanım (Ekim 2026, Arda'nın denemelerinden)
Arda'nın Windows'ta denediği sürümlerden gelen geri bildirimle eklendi; hepsi onaylı.
- Konsept görsellerine göre arayüz: belge sekmeleri, üstte araç çubuğu, cetveller, sol kütüphane (Stamp'ler/Tileset'ler, Proje ağacı), alt dock (Tileset / Son kullanılanlar; v1.5 ile değiştirildi), sağda bağlama göre değişen Denetçi + Geçmiş sekmesi (undo listesi; dal ve checkpoint yok) + Katmanlar
- Tileset: sürükleyerek çoklu seçim, toplu ekleme kartı, gruplar, "Tümü" görünümü, arama, silme, ayarları sonradan düzenleme
- Kullanıcı paletleri: farklı tileset'lerden tile'lar referans olarak kopyalanır/taşınır (piksel kopyalanmaz)
- Rastgele fırça: blok seçip rastgele set yapma, kayıtlı setler, stamp'ler arasından rastgele
- Araçlar: el (H), fırça boyutu, Shift ile çizgi, Alt ile geçici damlalık, seçimi taşıma, Z/Shift+Z döndürme, silgide sağ sürükle = alan sil
- ~~Arazi fırçası (normal katmanda), otomatik şablon bulma, araziden araziye geçişler~~ — **Kaldırıldı (Ekim 2026 kararı, Arda).**
- Ayrıntılı yeni proje dialogu ve proje ayarları; stamp kütüphanesi (kategori, etiket, favori) ve düz stamp düzenleyici
- Sağ tık menüleri yalnızca anlamlı yerlerde; tarayıcı menüsü ve F5 kapalı; kapatırken kaydedilmemiş değişiklik sorulur

### v1.4 — Akıllı stamp ve hız (Ekim 2026, Arda onayladı)
Arda'nın isteği: 3×3 yol stamp'i kalıp gibi yan yana basılmasın; tek fırçayla yol çizilsin, uçlar ve köşeler kendiliğinden tamamlansın.
- **9 dilim stamp:** ~~stamp Denetçi'deki FIRÇA İÇERİĞİ bölümünde elle "9 dilim" olarak işaretlenir; 3×3 için önerilir ama kendiliğinden açılmaz~~ (v1.5 ile değiştirildi). Artık uygun tileset seçimi otomatik algılanır; tek Akıllı anahtarı araç seçeneklerindedir
- **Alan kullanımı:** ~~dikdörtgen (R) ve fırçayla sürükleme varsayılan olarak tek dikdörtgen çizer~~ (v1.5 ile değiştirildi). R Alan, B Yol varsayılanıdır. Alan'da köşeler korunur, kenarlar ve merkez döşenir; 1×1, 1×n, 2×2 gibi dar boyutlar tanımlı
- **Yol kullanımı:** serbest çizim ve Shift çizgisi yol olur; uçlar, L dönüşleri, T ve dört yol ağzı kendiliğinden doğru tile'ı alır, var olan yola bağlanınca komşular düzelir. ~~Mevcut arazi (blob47) çözücüsü kullanılır~~ (v1.5 ile değiştirildi); bağlantı çözücüsü smart-stamp modülündedir
- Eksik parçalar (ince yol ucu, iç köşe, kavşak) kullanıcının kaynak tile'larının çeyreklerinden belirlenimli olarak birleştirilip sıradan bir tileset'e yazılır. ~~Kabul etmeden önce önizlemesi gösterilir; harita hücreleri, tileset ve arazi formatı değişmez, yalnızca stamp'e `nineSlice` bilgisi eklenir (`documentFormatVersion` 3)~~ (v1.5 ile değiştirildi). Otomatik hazırlık onay dialogu açmaz; çizim önizlemesi yerleşecek sonucu gösterir. Format 4'e geçiş aşağıdadır; eski düz stamp'ler düz kalır
- Üretilen tileset kuralları: kullanıcının kendi PNG'sine asla dokunulmaz. Birleştirilen parçalar `tilesets/` altında ayrı bir dosyaya yazılır, adı üretildiğini belli eder ("<stamp> (yol)"), Tileset panelinde varsayılan olarak "Üretilen" grubunda durur. Tile sırası yalnızca sona eklenerek büyür; kaynak PNG değişince (PNG izleme dahil) aynı sırayla yeniden üretilir. Diğer tileset'ler gibi Unity, TMJ ve PNG'ye aktarılır. Akıllı kapatılınca (v1.5 ile değiştirildi) haritada kullanılan üretilmiş tileset ortada kalmaz: kullanılıyorsa tutulur, silinmek istenirse tileset kaldırmadaki gibi kullanım sayısıyla sorulur
- Önizleme tam olarak yerleşecek olanı gösterir; tek hareket tek geri alma; X/Y/Z çevirme ve döndürme uyulur; kilitli ve gizli katmanlara yazılmaz
- ~~"Stamp'ten arazi yap": hazır 16-köşe veya 47-blob düzenindeki stamp, mevcut şablon bulma ile arazi setine çevrilir~~ — **Kaldırıldı (Ekim 2026 kararı, Arda).** (v1.5 ile değiştirildi)
- Çok katmanlı seçim: seçim aracında "Katmanlar" kapsamı (etkin katman veya görünür ve kilitsiz tüm tile + collision katmanları); taşı, kes, kopyala, sil, döndür aynı katman listesini kullanır. Entity'ler dahil değil
- Tile değiştir: seçili alanda, etkin katmanda veya görünür tüm katmanlarda bir tile'ı başkasıyla değiştirir; çevirme bitleri korunur, önce kaç hücre değişeceği gösterilir, tek geri alma
- Dikdörtgen aracında Dolu / Çerçeve seçeneği ve çerçeve kalınlığı
- Hız: performans ölçümü onarılır (fırça gecikmesi gerçek örneklerle ölçülür); son projeler küçük resmi açma ve kaydetmeyi bekletmez; fill ve fill önizlemesi satır aralıklarıyla çalışır. Her hız işi önce/sonra ölçümüyle gelir

### v1.5 — Yerleşim, akıllı stamp düzeltmesi, sadeleşme (Ekim 2026, Arda onayladı)

- Dolu 3×3 tileset seçimi her zaman akıllı fırça olur; daha büyük n×m bloklar yalnız 1 hücrelik kenar bantları (b=1), kenar/merkez tekrarları ve birleşimleri doğrulanırsa akıllıdır. b≥2 desteklenmez; 2×2 köşeli 6×6 bloklar düz kalır. Doğrudan seçim ve kaydedilen stamp aynı akıllı kaynağı kullanır. Ek 9 dilim/Hazırla/Yol tıklaması gerekmez. B serbest çizim ve Shift çizgisi Yol, R Alan; Alan | Yol araç başına değiştirilir, yeni fırçada sıfırlanır. Tek Akıllı anahtarı davranışı kapatır; kayıtlı stamp bu tercihi korur. F mevcut desen doldurmadır
- Denetçi, kayıtlı akıllı stamp için "Kaynak" bilgisini düz metin gösterir; ikinci anahtar yoktur. Doğrudan seçimde üretilen tileset adı kaynak ve sıfır tabanlı konumunu taşır: örneğin `<tileset> 3×3 @ col,row (yol)`
- Sol/Sağ/Alt bölgeler boyutlandırılır, daraltılır, tamamen gizlenir. Tüm paneller üç bölgeye taşınır; sekme sıralama, bölünmüş bölümler, drop göstergesi ve erişilebilir Taşı menüsü vardır. Yerleşim ayarlarda saklanır; Düzeni sıfırla varsayılanı getirir. Yüzen pencere yoktur. Dünya görünümü Proje'yi bulunduğu yerde açar; Denetçi dünya bağlamını gösterir, Katmanlar hangi bölgede olursa olsun gizlenir; Tileset ve Son kullanılanlar kullanılabilir
- Dar paneller: 560 px altındaki Tileset başlığı iki 32 px satır ve 1 px alt çizgidir; palet sütunları üçüncü satır ekler. Taşan sekmeler tam etiketleri, 24 px kaydırma okları ve odaktaki sekmeyi gösterme davranışını korur. Alt bölgedeki Tileset en az 190 px, palet kontrolleriyle 222 px yer ayırır; kayıtlı ölçü değişmez. Menüler pencereye sığar ve dikey kayar; Son kullanılanlar komutunun adı panelle aynıdır
- Katı tile işareti ve kullanıcıya dönük Arazi bütünüyle kaldırıldı. Manuel Collision katmanı ve Unity'ye aktarımı kalır. Akıllı yolun bağlantı çözücüsü yalnız smart-stamp modülüne aittir; arazi seti/etiketi/komutu yoktur
- `documentFormatVersion` 4: eski arazi setleri, terrain grid'leri ve solid flag'leri atılır; kaydedilmiş tile hücreleri, çevirme bitleri ve görünüş değişmeden açılır. Eski `nineSlice` stamp'ler ve kullanılan üretilmiş atlaslar korunur. Collision yalnız manuel katmanlardan gelir; TMJ'ye görünmez Collision `objectgroup` dikdörtgenleri olarak aktarılır. Oyun/Unity dışa aktarma formatı değişmez
- **Tile al → katmanını etkinleştir:** Sağ tık, Alt ve I için Katman kapsamı varsayılan Tümü'dür; en üst görünür dolu tile alınır ve kaynak katmanı etkinleşir. Etkin yalnız etkin katmanı okur; alan alma etkin katmanda kalır. Kilitli kaynaktan alınabilir, boyama kilidi korunur; undo oluşturmaz
- **Harita kenarı:** Harita → Kenar… dialogunda Kalınlık, İç boşluk, dört kenar anahtarı ve kenar/başlangıç/uzunluk ile kapı boşlukları canlı önizlenir. Başlangıç iç sınırdan sıfır tabanlıdır; boşluk tüm kalınlığı keser, mevcut hücreleri silmez. Etkin, görünür ve kilitsiz tile katmanına mevcut tile/desen/rastgele/akıllı fırçayla yazar; dar haritada ölçüler sınırlanır. Uygula tek geri almadır; Esc/Vazgeç belgeyi değiştirmez
- **Bağlı alan seçimi:** Seç aracında Dikdörtgen | Bağlı alan; etkin katmanda aynı tile ve tüm çevirme bitleri eşit olan dört yönden bağlı hücreler seçilir. Shift ekler, Ctrl/Alt çıkarır; taşı/kopyala/kes/sil/yapıştır, X/Y ve Z/Shift+Z, Tile değiştir ve Stamp olarak kaydet aynı maskeyi kullanır. Sınır çizgisi delikler dahil gerçek maskeyi izler
- **Kılavuz ızgara:** Izgara düğmesinin popover'ında Kapalı veya 2–64 tile aralığı ve X/Y başlangıcı seçilir. Çizgiler `grid-major` token'ıyla bir fiziksel pikseldir; aralık 6 CSS px altındaysa görünmez. Ctrl+G temel ızgarayla birlikte gizler. Proje başına localStorage'da saklanır; harita formatına girmez

**Bitti:** Arda'nın tileset→çiz ve tileset→stamp kaydet→çiz akışları 16/32 px, sheet ofseti ve flip'lerle e2e'de geçer; 1366×768'de paneller daraltıldığında tuval pencerenin çoğunu kullanır; eski dosyalarda görsel kimlik ve dışa aktarma korunur, Unity manuel Collision testleri geçer. Dört yeni çizim özelliği tüm işlemleriyle tamamlanır.

### Sonra

- Katı işareti ve arazi fırçası: gerekirse yeniden düşünülür
- "Bu stamp'ten gelenleri yenile" düğmesi (elle değiştirilmiş olanları atlar veya sorar)
- Tileset düzeni bozulunca "eski → yeni" eşleştirme ekranı
- `.aseprite` dosyasını doğrudan okuma (format açık; Aseprite'ı komut satırından çağırmak yok)
- Basit Tiled içe aktarma: yalnızca tile katmanları, alınamayanlar tek listede

## Bilinen tuzaklar

Kaynaklardan doğrulanmış; ilgili sürüme gelince uygulanır.

**Tuval**
- Tile'lar arasında zoom ve kaydırmada çizgi çıkar; nearest filtre tek başına önlemez. Atlasta tile başına 1–2 piksel taşırma payı gerekir.
- Keskin piksel için `texture.source.scaleMode = 'nearest'` ve kameranın tam piksele oturması.
- Windows ölçeği %125 ve %150 iken tile'lar eşit olmayan genişlikte çizilir. Tuval cihaz pikseline göre boyutlanmalı (`ResizeObserver`, `devicePixelContentBoxSize`).
- Çizim birimi chunk + katman başına bir mesh; yalnızca değişince yeniden kurulur. 2560×1440 ekranda %100 zoom'da en fazla 12 chunk görünür, o yüzden chunk'ları birleştirmeye gerek yok.
- Hızlı sürüklemede fırça hücre atlar: `getCoalescedEvents()` kullan, noktalar arasını Bresenham ile doldur.
- Fırça gecikmesi hedefi: değişiklik bir sonraki karede görünür, kare süresi 16,7 ms altı.
- Atlas sayfası en fazla 4096 veya 8192 piksel.

**Tauri (v0.5)**
- Dosya eklentisinde atomik yazma ve `fsync` yok. Güvenli kayıt özel Rust komutu ister: geçici dosyaya yaz, diske işle, yeniden adlandır, antivirüs kilitlerse tekrar dene.
- Dosya izleyici aynı kayıt için birden çok olay yollar. Olaylar ipucu sayılır: beklet, içeriği karşılaştır, kendi yazdığını yok say.
- Kullanıcının seçtiği klasör izni yeniden başlatınca kaybolur; "son projeler" için kalıcı izin gerekir.
- Windows kendi zoom'unu (Ctrl+tekerlek) uygular; kapatılmalı.

**Unity (v0.4)**
- Unity arka plandayken dosya değişikliğini kendiliğinden almaz. Küçük bir dosya izleyici `AssetDatabase.ImportAsset` çağırmalı.
- Sprite ve Tile'lar içe aktarıcının alt varlıkları olarak üretilir (`ctx.AddObjectToAsset`); PNG'nin kendi ayarlarına dokunulmaz. `TextureImporter.spritesheet` eskidi.
- Sprite ayarları: Point filtre, sıkıştırma yok, PPU = tile boyutu.
- Y ekseni ters: hem hücre konumu hem sprite dikdörtgeni çevrilir.
- Collision: `TilemapCollider2D` + `CompositeCollider2D`. Poligon birleştirmeyi Unity yapar. Güncel API `compositeOperation`.
- Unity'de katman (layer) nesne başınadır; her collision türü ayrı Tilemap nesnesi ister.
- Toplu yazma için `SetTilesBlock`; hücre hücre `SetTile` döngüsü yavaştır.

**Genel**
- 90° stamp döndürme yönlü gölgeyi ve collision'ı bozar; varsayılan yalnızca X/Y çevirme. Döndürme yalnızca Z / Shift+Z ile, isteğe bağlı (çapraz çevirme biti).
- Git satır sonlarını değiştirebilir; yeni projeye `.gitattributes` (`*.json text eol=lf`) konur.

## Yapılmayacaklar

| Konu | Neden |
|---|---|
| Canlı Unity senkronu, onaylı mesaj protokolü | Unity tarafında binlerce satır; dosya yazmak aynı sonucu veriyor |
| Unity'den editöre şema çekme (Engine Contract) | Bilgiyi zor yönden alıyor; türler editörde tanımlanıyor |
| Canlı bağlantılı prefab, iç içe prefab | Haritanın bütün okuma mantığını değiştirir; düz stamp yeterli |
| Checkpoint, dallanan geçmiş, crash journal | Undo + otomatik kayıt + yedek klasörü aynı ihtiyacı karşılıyor |
| Sonsuz tuval | Fill, dışa aktarma ve minimap'i sınır sorusuyla uğraştırır |
| Görsel kural editörlü autotile, otomatik harita üretimi | Kullanıcıya programlama yaptırır |
| Altı aşamalı tile kimlik eşleme | Nadir durum için haftalarca iş |
| Aseprite'ı komut satırından çalıştırma | Çıktısı güvenilmez; PNG izleme yetiyor |
| WebGPU, chunk'lar arası birleşik GPU buffer | Gereksiz karmaşıklık |
| Kısayol düzenleme ekranı | Ayar dosyası yetiyor |
| Layer mask, efektler, blend mode, parallax | Harita çizmek için şart değil |
| İzometrik ve hex ızgara | Tuvalin tamamını etkiler |
| Godot ve LDtk desteği, web sürümü, plugin API | Kapsam dışı; Tiled dışa aktarma Godot'ta da açılır |
| Lisans, ödeme, updater, kod imzalama, telemetri | Satış ve dağıtım yok |

## Açık sorular

- Editör hangi oyun için kullanılacak: tile boyutu, harita büyüklüğü, tek açık dünya mı ayrı bölgeler mi? Varsayılan 32 piksel tile ve ayrı bölgeler kabul edildi.
