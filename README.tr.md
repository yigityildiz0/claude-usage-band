# Kota Bandı (claude-usage-band)

Claude Code'da istem kutusunun hemen üstünde duran kullanım kotası bandı. 5 saatlik ve
haftalık limitleri, bu hızla ne zaman biteceğini ve bağlam penceresinin ne kadar dolduğunu
gösterir; bağlam taşmadan önce sohbeti sizin yerinize sıkıştırır.

[English](README.md) | Türkçe

**Arayüz metinlerinin hepsi Türkçedir** (etiketler, bildirimler, `/kota` argümanları).

Anant Raghunath'ın
[usage-quota](https://github.com/anantraghunath/claude-code-usage-quota-mod) modunun
(MIT, sürüm 0.1.6) çatalıdır. Özgün lisans `LICENSE` dosyasında korunur.

## Kurulum

```
/plugin install kota-bandi --marketplace yigityildiz0/claude-usage-band
```

Bu tek adımlık kurulum satırı Claude Code 2.1.275 ve sonrasında çalışır. Kurduktan sonra açık
sohbetlerde `/reload-plugins` yapın.

## Ne gösterir

- **5 Saat** ve **Haftalık** limitler: kullanılan yüzde, sıfırlanmaya kalan süre ve çubukta
  gri bir çentikle "bu hızla sıfırlanmaya kadar en çok %X". Limit sıfırlanmadan dolacaksa
  dolacağı gün ve saat ("bugün 14:20 (2sa 3dk sonra)").
- **Etkin kalan:** iki pencere birlikte okunur. Önce bağlayan (dolu olan, önce dolacak olan ya
  da en az kalan) satırda adıyla yazılır ve altı çizilir. İkisi de doluysa kullanımın açılacağı
  saat verilir.
- **Erken bitiş uyarısı:** yeterli veri varsa ve bir pencere sıfırlanmadan en az 15 dk önce
  dolacak görünüyorsa, her pencere döneminde bir kez, bütün sohbetlerde ortak tek bildirim.
  Pencerenin başında tahmin "(tahmini)" diye işaretlenir.
- **Bağlam:** doluluk yüzdesi; Mesajlar, Araçlar ve Diğer olarak dökümü.
- **Sıkıştır düğmesi ve otomatik sıkıştırma:** sohbet başına çalışır. Varsayılan olarak %75'te
  açıktır; eşik `−` ve `+` düğmeleriyle 5'er puan (%15 ile %95 arası) ayarlanır.

## Üç görünüm

Görünüm bütün sohbetlerde ortaktır ve hatırlanır.

| Görünüm | Ne kalır | Nasıl |
|---|---|---|
| **Detaylı** | Her şey: başlık, iki pencere, bağlam dökümü, diğer platformlar tablosu | `▲` ya da `/kota detaylı` |
| **Kısa** | Başlık, denetimler ve tek satırda üç çubuk (sığmazsa alt alta) | `▼` ya da `/kota kısa` |
| **Gizli** | Yalnız sağ uçta küçük kare bir düğme; noktanın rengi en dar limitin (ya da bağlamın) durumunu gösterir. Üstüne gelince tek satırlık özet çıkar. Basınca son açık görünüme döner | `Gizle` ya da `/kota gizli` |

`/kota` tek başına bandı açar ya da kapatır (kalıcı); kapalıyken otomatik sıkıştırma sürer.
Pencere yüksekliği detaylı görünüme yetmiyorsa bant ayarınızı değiştirmeden kısa görünümü
çizer.

Bant 20 sütundan geniş her ölçüde taşmadan çizilir: geniş ekranda iki blok yan yana, dar
ekranda alt alta; yüzdeler ve eşik her zaman tam görünür. Kırılım noktaları için
[docs/tasarim.md](docs/tasarim.md) dosyasına bakın.

Renkler: yazılar temanın kendi renkleriyle çizilir; çubuklar ve noktalar hem koyu hem açık
zeminde en az 3:1 kontrastlı orta tonlardır. Abonelik adı (Max, Plus...) hiçbir yerde
gösterilmez.

## İsteğe bağlı: Burette ile diğer platformlar

Burette, başka yapay zekâ araçlarının kotalarını izleyen yerel bir kullanım servisidir (Rust,
Windows). Çalışıyorsa bant onunla konuşur; çalışmıyorsa hiçbir şey göstermez ve bant tek
başına çalışır.

| Ne | Nasıl |
|---|---|
| Bağlantı | `%LOCALAPPDATA%\Cetvel\baglanti.json` dosyasından yalnız `port` ve jeton okunur (klasör servisin eski adını taşır). Adres her zaman `http://127.0.0.1:<port>`. Jeton yalnız bellekte durur; günlüğe, ekrana ya da depoya yazılmaz. 401 gelirse dosya bir kez yeniden okunur. |
| Claude verisi | Bandın zaten okuduğu Claude limitleri servise iletilir. |
| Tek soran | 2 dakikalık plan sorusundan önce bant servisten kira ister. Kirayı başka sohbet tutuyorsa bu sohbet sormaz, onun sonucunu servisten okur. |
| Diğer platformlar | 10 sn'de bir sorulur (ETag/304). Detaylı görünüm bağlı her havuzu, pencerelerinde **kalan** yüzdeyle listeler; sıfırlama saatleri ve model adları üzerine gelince açılır. Abonelik adı yazılmaz. Dar bantta iki satırlı kartlara geçilir; tek satırlık özette en dar havuzlar kalır, gerisi `+N` olur. |
| Tahmin | Servisin EWMA hızı, sıfırlaması bandın penceresiyle eşleşirse kullanılır. Haftalıkta yalnız doğrulanmış (`hazir`) tahmin alınır; `deneysel` olanlar kısa bir yoğun oturumu bütün haftaya yayacağı için yok sayılır. Yoksa bandın kendi sönümlü hızı kullanılır. |
| Servis susarsa | Üstel geri çekilme (5–60 sn); satır soluklaşır, "(Cetvel yanıt vermiyor)" yazar, 10 dk sonra kaybolur. |

Neden HTTP: mod motorunun `$.http.fetch` çağrısı yerel adrese çıkabiliyor; `$.process` yalnız
CLI'de var ve birkaç saniyede bir süreç başlatırdı; yalnız anlık dosyayı okumak ise veriyi
iletmeye de kira almaya da yetmezdi.

## Gizlilik

- Bant **model çağırmaz**, telemetri göndermez.
- Ağ: `api.anthropic.com/api/oauth/usage` adresine tek bir sorgu (uygulamanın kendi "Plan
  kullanım limitleri" panelinin okuduğu veri); oturumun kendi kimliğiyle yapılır, mod bu
  kimliği hiç görmez. Bütün sohbetler toplamında en çok 2 dakikada bir. Burette çalışıyorsa
  istekler ayrıca `127.0.0.1` adresine gider, başka yere gitmez.
- Yazılan dosyalar: `~/.claude/plugins/store/` altındaki mod ayar deposu, yedek klasör
  `~/.claude/plugins/data/kota-bandi/` ve aşağıda anlatılan ortak otomatik sıkıştırma klasörü.
  Başka hiçbir yere veri gönderilmez.

## Özgün usage-quota modu da açıksa

İkisi birlikte çift bant, çift otomatik sıkıştırma ve kullanım servisine çift soru demektir.
Bant açılışta ve dakikada bir bakar; özgün mod açıksa ya da kapalı ama açık bir sohbette hâlâ
yüklüyse tek satır uyarı gösterir ("İki kota bandı açık: ..."). Kalıcı kaldırmak için:

```
claude plugin uninstall usage-quota@claude-code-usage-quota-mod
```

Sonra açık sohbetlerde `/reload-plugins` yapın (ayarı `false` yapmak çalışan sohbetten modu
boşaltmaz). Kota Bandı özgün modu asla açmaz ya da kapatmaz, ayarlarına yazmaz; yalnız ilk
kurulumda onun otomatik sıkıştırma ayarlarını ve öğrenilmiş hızı bir kez okuyup kopyalar.

## Ayar deposu bozulursa

Motorun ayar deposu (`~/.claude/plugins/store/kota-bandi_*.json`) bir kez yazma sırasında NUL
baytlarla dolmuş, okumalar boş dönmüş, yazmalar hata vermişti. Bant açılışta depoyu sınar (yaz,
geri oku). Bozuksa tek bildirim gösterir, her anahtarı
`~/.claude/plugins/data/kota-bandi/depo/` altında ayrı küçük dosyalarda tutar, 5 dakikada bir
yeniden dener ve depo düzelince değerleri geri taşır. Elle onarmak için dosyayı yedekleyip
silin, `/reload-plugins` yapın; motor dosyayı yeniden oluşturur.

## Özgün sürümden farkları

- Bütün metinler Türkçe; yüzdeler Türkçe yazımla (%60), süreler g/sa/dk; %99,6 "%99" yazılır,
  asla dolu görünmez.
- Eşik alanı masaüstünde tek basamak gösteriyordu ("40" yerine "4"); metin kutusu kaldırıldı,
  yerine her yüzeyde tam görünen bir artı/eksi ayarı geldi.
- Üç görünüm, Burette bağlantısı, ortak otomatik sıkıştırma ayarı ve depo onarımı yenidir.
- Özgün modun öğrendiği kullanım hızı ve sohbet ayarları ilk açılışta bir kez devralınır.
- Kesin bağlam sayımı (~320 istek) 2 dakikada bir tek sohbette yapılır, sonuç ötekilerle
  paylaşılır.
- `/clear` sonrası yeni sohbet kimliği eski sohbetin otomatik sıkıştırma ayarıyla devam eder.

## Otomatik sıkıştırmayı başka bir modla paylaşmak

İki mod da otomatik sıkıştırma sunuyorsa tek ayar ve tek çalıştırıcı olmalıdır. Kota Bandı aşağıdaki
düzeni kullanır; başka bir mod da buna uyabilir:

| Kural | Nasıl |
|---|---|
| Ortak ayar | Sohbet başına tek dosya: `~/.claude/plugins/data/claude-auto-compact/<sohbet>.json` (`isOn`, `at`, `t`). Birinde yapılan değişiklik ~3 sn içinde ötekine geçer. |
| Tek çalıştırıcı | Kota Bandı 5 sn'de bir `kota-bandi.alive` yazar (gizli görünümde de). Öteki mod bu dosya 20 sn'den yeniyse sıkıştırmamalıdır. |
| Tek başına | Hangisi tek kuruluysa sıkıştırmayı o yapar. |
| Claude Code'un yerleşik sıkıştırması | Modlardan bağımsızdır. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` modun eşiğinden düşükse (ör. 60) uygulama önce sıkıştırır. Değeri en yüksek mod eşiğinin (%95) üstünde (ör. 97) tutun ya da hiç tanımlamayın. |
| Varsayılan | Yeni sohbette açık, %75. Eski sürümlerin %40 ve %80 varsayılanı bir kez %75'e çekilir; elle ayarlanmış eşiğe dokunulmaz. |

İki yazar aynı dosyayı düzenlemez: her mod yalnız kendi `.alive` dosyasını yazar.

## Geliştirme

[AGENTS.md](AGENTS.md) dosyasına bakın. Testler `claude plugin test .` ile çalışır.

## Lisans

MIT. Telif hakkı (c) 2026 Anant Raghunath ve Yiğit Yıldız. [LICENSE](LICENSE) dosyasına bakın.
