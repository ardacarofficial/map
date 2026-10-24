# AI ile harita çizmek

Harita Tasarlayıcı, Claude Code veya Codex gibi bir AI aracının açık dünyayı görüp tile, stamp ve entity yerleştirmesine izin verir. AI, kendi uygulamasından MCP bağlantısıyla editöre komut gönderir. Kendi AI hesabını kullanırsın.

## Bağlantıyı aç

1. Masaüstü uygulamasında dünyanı aç, tileset’lerini içe aktar.
2. **Ayarlar → AI** bölümünde **AI bağlantısı** anahtarını aç. Varsayılan port **48765**. **Kaydet ve uygula** düğmesine bas.
3. İstemciyi **Claude Code** veya **Codex** seçip **Bağlantı ayarlarını kopyala** düğmesine bas. Kopyalanan metin erişim anahtarını içerir; paylaşma.

Port kullanımdaysa başka boş bir port seç. Örneklerdeki portu ve `<TOKEN>` alanını Ayarlar’daki değerlerle değiştir. Normal tarayıcı açılışında “Masaüstü uygulamasında kullanılabilir” görünür; geliştirme sunucusuna eşleştirilmiş sayfa dev adresini gösterir.

## Claude Code

Ayarlar’da istemci olarak **Claude Code**’u seçip **Bağlantı ayarlarını kopyala**’ya bas ve kopyalanan iki satırı PowerShell’de çalıştır. Sonra Claude Code’u yeniden aç. Harita uygulaması ve dünya açık kalsın:

```powershell
claude mcp remove harita -s user
claude mcp add -s user --transport http harita http://127.0.0.1:48765/mcp --header "Authorization: Bearer <TOKEN>"
```

`-s user` bağlantıyı bütün klasörlerde geçerli yapar. İlk satır eski kaydı siler; kayıt yoksa `No MCP server named "harita"` der, sorun değil. Anahtarı yenilediğinde aynı iki satırı yeniden çalıştırman yeter. Bağlantıyı `claude mcp list` ile kontrol edebilirsin; anahtar yanlışsa burada “Harita rejected the access token” görünür.

## Codex

Ayarlar’da istemci olarak **Codex**’i seçip **Bağlantı ayarlarını kopyala**’ya bas. Kopyalanan bloğu `%USERPROFILE%\.codex\config.toml` dosyasına yapıştır, sonra Codex’i yeniden başlat:

```toml
[mcp_servers.harita]
url = "http://127.0.0.1:48765/mcp"
http_headers = { Authorization = "Bearer <TOKEN>" }
default_tools_approval_mode = "approve"
tool_timeout_sec = 120
```

Dosyada daha önce `[mcp_servers.harita]` bölümü varsa onu bu blokla değiştir. Anahtarı yenilediğinde bloğu yeniden kopyala. Bağlantıyı `codex mcp get harita` ile kontrol edebilirsin; anahtar yıldızlı görünür.

**Gelişmiş: anahtarı dosyaya yazmadan.** `http_headers` satırı yerine `bearer_token_env_var = "HARITA_MCP_TOKEN"` yaz ve Codex’i başlatacağın PowerShell penceresinde anahtarı tanımla:

```powershell
$env:HARITA_MCP_TOKEN="<TOKEN>"
codex
```

Kalıcı yapmak için `setx HARITA_MCP_TOKEN "<TOKEN>"` kullan; `setx` açık pencereyi değiştirmez, yeni terminal aç. Değişken tanımlı değilse Codex Harita sunucusunu sessizce atlar; araçlar görünmüyorsa önce bunu kontrol et. Ayrıntılar [resmî OpenAI MCP belgesinde](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## İzinler

AI’ın çizdiği her şey sen **Onayla** diyene kadar taslaktır; **Vazgeç** hepsini birebir geri alır. Bu yüzden Harita araçlarına her çağrıda ayrıca izin vermek gerekmez. İzin ayarlanmazsa Claude Code salt okunur araçlar dahil her araç için sorar, Codex de çizim araçlarını “onay gerekiyor” diyerek reddedebilir.

**Claude Code:** Ayarlar’daki **İzin kuralını kopyala** düğmesi `mcp__harita` kuralını kopyalar. Claude Code içinde `/permissions` komutunu aç ve bu kuralı **Allow** listesine ekle. Ya da `%USERPROFILE%\.claude\settings.json` dosyasına ekle (dosyada başka ayarlar varsa yalnız `allow` listesine `"mcp__harita"` satırını ekle):

```json
{
  "permissions": {
    "allow": ["mcp__harita"]
  }
}
```

`mcp__harita` kuralı Harita’nın bütün araçlarını kapsar; başka MCP sunucularına veya dosya/kabuk araçlarına izin vermez. Komut satırında tek seferlik çalıştırmada `claude -p "…" --allowedTools "mcp__harita"` aynı işi görür.

**Codex:** Yukarıdaki bloktaki `default_tools_approval_mode = "approve"` satırı Harita araçlarını onay sormadan çalıştırır. Yalnız bu sunucuyu etkiler. `tool_timeout_sec = 120` uzun önizleme ve büyük çizim çağrılarının yarıda kesilmesini önler.

Harita’da kalıcı etkisi olan, taslağa girmeyen araçlar (etiket yazma, dışa aktarma, panel düzeni ve uygulama ayarları) MCP’de “yıkıcı” olarak işaretlidir; istemci bunlar için ayrıca sorabilir. Hiçbir araç PNG yazamaz, dosya veya kabuk çalıştıramaz ve AI kendi işini onaylayamaz.

## Örnek istekler

- “Önce tileset kataloğunu incele. Mevcut görsellerle üç evli küçük bir köy, evleri bağlayan yollar ve birkaç ağaç yap. Kilitli katmanları koru. Önizlemeyi kontrol edip onayıma sun.”
- “Haritanın ortasına dikey bir nehir ve üstüne köprü yerleştir; iki kıyıdaki yolları bağla. Uygun akıllı kaynak yoksa mevcut tile ve stamp’leri kullan. Bitince onay bekle.”
- “Tileset görsellerini inceleyip çimen, su, çatı, kapı ve köprü parçalarını Türkçe etiketle. Emin olmadıklarını atla.”

AI önce `get_session` ile açık dünyayı, katalog görselleriyle gerçek tile’ları öğrenir. `begin_edit` ile işe başlar; çizim canlı görünür. `render_preview` ile bakar, `finish_edit` ile sana sunar. Uygun görsel yoksa söylemesini iste; “nehir” sözcüğü otomatik su görseli seçmez.

## Onayla, Vazgeç, Durdur

- **Onayla:** İstekteki bütün harita değişikliklerini kabul eder. Bir normal **Geri al** hepsini birlikte geri alır. Yeni harita listede kalır, içeriği geri alınır. Ardından normal kayıt/otomatik kayıt çalışır.
- **Vazgeç:** Geçici değişiklikleri geri alır. AI’ın yeni oluşturduğu, henüz onaylanmamış haritalar kaldırılır.
- **Durdur:** Yeni komutları ve sürmekte olan hazırlığı keser; tamamlanan çizimi incelemek için tutar. Sonra Onayla veya Vazgeç seçersin. AI işine devam etmek isterse kendi taslağını `resume_edit` ile yeniden açabilir; çubuk yine “AI çalışıyor” gösterir.

İş beklerken elle çizim ve harita kaydı kapalıdır. Kaydırma, yakınlaştırma ve harita sekmeleri çalışır. Ctrl+S onay vermez. AI çubuğu Tab ile paneller gizlenince de görünür. **Etkinlik** paneli hangi araçların ne yaptığını gösterir; diğer paneller gibi taşınabilir.

AI oturumu kapanırsa, bağlantı boşta kalıp sona ererse, AI bağlantısını kapatırsan veya anahtarı yenilersen yapılmış çizim **geri alınmaz**. Çubuk “AI bağlantısı kapandı; değişiklikler onay bekliyor” der; Onayla veya Vazgeç seçersin. Yalnız henüz hiçbir şey çizmemiş, hazırlanmakta olan iş iptal edilir. Aynı AI yeniden bağlanınca `begin_edit`’in ona verdiği gizli `resumeToken` ile `resume_edit` diyerek taslağına döner ve devam eder; bu, `finish_edit` ile sunduğu veya senin Durdur’a bastığın işler için de geçerlidir. Anahtarı olmayan başka istemciler bu işi görebilir ama değiştiremez, iptal edemez veya sen karar vermeden başka iş başlatamaz.

Çalışan işin 30 dakikalık süresi hareketsizlik süresidir: AI’ın her komutu süreyi uzatır. Süre dolarsa iş geri alınmaz, bağlantısı kapanmış gibi onayına bekler. Zaman aşımına uğrayan veya hata veren tek bir komut yalnız kendi değişikliğini geri alır; önceki çizim ve taslak sürer. Bekleyen işin süresi dolsa da otomatik onay veya geri alma yapılmaz. Dünyayı kapatmak/değiştirmek bekleyen işi geri alır. Editörü kapatınca onaylanmamış çizim diske kaydedilmez.

**Etiketler ayrı kaydedilir:** `ai-tags.json` içindeki tile/stamp etiketleri Onayla/Vazgeç ve Geri al dışında kalır. Denetçi’de seçtiğin tile veya stamp’in etiketlerini düzenleyebilirsin. Kaynak pikseller değişirse eski etiketler “eski” görünür; kontrol edip yeniden etiketle.

## Güvenlik

Bağlantı yalnız bilgisayarındaki `127.0.0.1` adresini dinler (`localhost` adıyla gelen yerel istekler de kabul edilir); erişim anahtarı gerekir. Anahtar yanlışsa istemci ne yapılacağını söyleyen bir hata alır. Başlangıçta kapalıdır. Anahtar projeye veya normal ayarlar metnine yazılmaz. AI kendi işini onaylayamaz, kaydetme aracı yoktur ve kullanıcı PNG’lerini değiştiremez.

Katalog ve harita önizlemeleri bağlı AI uygulamasına gönderilir; oradan AI sağlayıcısına ulaşabilir. Paylaşmak istemediğin görselleri kullanma. Erişimi bitirmek için bağlantıyı kapat veya anahtarı yenile.

## Geliştirici için stdio köprüsü

`harita-mcp`, stdio konuşan MCP istemcisini çalışan editörün HTTP bağlantısına bağlar. Doğrudan proje klasörü düzenlemez. Editör henüz açık değilse de başlar: araç listesini paketten verir, ilk çağrıda bağlanır; editör kapalıysa çağrı `EDITOR_UNAVAILABLE` ve ne yapılacağını döndürür. Editör oturumu sona ererse bir kez kendiliğinden yeniden bağlanır; `--token-file` kullanıyorsan yenilenen anahtarı da dosyadan okur.

Depo kökünde PowerShell örneği:

```powershell
pnpm --filter @smap/agent-cli build
$env:HARITA_DEV_MCP="1"
$env:HARITA_DEV_MCP_PORT="48766"
$env:HARITA_MCP_TOKEN="<yerel-dev-anahtarin>"
pnpm dev
```

Tarayıcıda Vite adresini `?agent=arda` ile aç. İstemcinin stdio yapılandırmasında aşağıdaki programı kullan; aynı anahtarı ortam değişkeni olarak ver:

```powershell
$env:HARITA_MCP_TOKEN="<yerel-dev-anahtarin>"
node packages/agent-cli/dist/main.js --url "http://127.0.0.1:48766/mcp?pair=arda" --token-env HARITA_MCP_TOKEN
```

Paketin çalıştırılabilir adı PATH üzerinde `harita-mcp` olduğunda eşdeğeri:

```powershell
harita-mcp --url "http://127.0.0.1:48766/mcp?pair=arda" --token-env HARITA_MCP_TOKEN
```

Dev portunu `HARITA_DEV_MCP_PORT` belirler; Ayarlar bunu yeniden başlatmaz. Anahtar verilmezse dev sunucusu bir tane oluşturup dosya yolunu ve anahtarı kendi terminaline yazar. Her sayfa/istemciye ayrı eşleştirme kimliği ver. Üretim paketinde dev MCP sunucusu yoktur.
