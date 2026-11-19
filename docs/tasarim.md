# Tasarım notları

Kota Bandı'nın görünüm ilkeleri ve genişlik kırılımları. Bant `AbovePrompt` bileşeni olarak
`terminal`, `desktop` ve `mobile` yüzeylerinde çizilir.

## İlkeler

- **Rozet yok, ton var:** yüzdelerin arkasında renkli kutu yoktur; durum, temanın başarı,
  uyarı ve hata renkleriyle ve çubuğun rengiyle anlatılır. İkincil metin soluk renktedir.
- **Kalan odaklı:** detaylı görünümde 5 saatlik ve haftalık satır **kalan** oranı gösterir
  (`%14 kalan`); çubukta sıfırlanma anındaki tahmini kalan noktası çentikle işaretlenir.
- **İki yazı boyutu:** ana metin ve dipnot. Rakamlar sabit genişlikte hizalıdır.
- **Diğer platformlar:** bağlı her havuz kendi satırında (Burette bağlıyken). Tükenen hücre
  kırmızı "tükendi" yazar; açılış saati, sıfırlamalar ve model adları üzerine gelince açılır.
- **Yüzey farkı:** masaüstü ve mobilde yarı saydam yuvarlak çerçeve ve piksel çubuklar,
  terminalde çerçevesiz, çizgi karakterli çubuklar.

## Renk ve kontrast

Tema dosyası okunmaz; bant hem koyu (`#262624`) hem açık (`#faf9f5`) zeminde çalışacak biçimde
seçilmiştir. Metinde en az 4.5:1 için temanın kendi anahtarları kullanılır; çubuk ve nokta
dolguları en az 3:1 olan orta tonlardır.

| Kullanım | Değer | Koyu zemin | Açık zemin |
|---|---|---|---|
| Çubuk / nokta, rahat | `#149245` | 3.77:1 | 3.82:1 |
| Çubuk / nokta, dikkat | `#c26606` | 3.75:1 | 3.84:1 |
| Çubuk / nokta, kritik | `#e14348` | 3.68:1 | 3.91:1 |
| Mesajlar / Araçlar / Diğer ve çentik | `#0987a8` / `#7968eb` / `#767d8d` | 3.60–3.67:1 | 3.92–3.99:1 |

## Genişlik kırılımları

Kullanılabilir iç genişlik: 30 sütunun altında çerçevesiz; 30–43 arası çerçeve var, yan boşluk
yok; 44 ve üstü çerçeve ve 1 sütun yan boşluk. En küçük desteklenen genişlik 20 sütundur.

### Detaylı görünüm

| İç genişlik | Yerleşim |
|---|---|
| 84 ve üstü | Claude ve Bağlam yan yana; diğer platformlar 4 sütunlu tablo |
| 81–83 | Tek sütun; 4 sütunlu tablo |
| 64–80 | Tek sütun; 3 sütunlu tablo (sıfırlama sütunu üzerine gelince açılır) |
| 42–63 | Tek sütun; her platform iki satırlı kart, mini çubuklu |
| 20–41 | Çubuksuz sarılabilir kartlar; 32'nin altında Claude yüzdesi kısa biçimde |

Yükseklik `maxRows` değerini aşarsa tercih korunarak geçici olarak kısa görünüme geçilir.

### Kısa görünüm

| İç genişlik | Yerleşim |
|---|---|
| 86 ve üstü | Üç öğe tek satırda |
| 55–85 | Üstte 5 Saat ve Hafta, altta tam genişlikte Bağlam |
| 55'in altı | Üç satır alt alta, yüzdeler sağa hizalı |
