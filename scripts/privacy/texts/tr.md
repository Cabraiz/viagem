name: Türkçe
title: Gizlilik Politikası
description: viagem verilerinizi nasıl işler: cihazınızda ne kalır, oda sunucusundan ne geçer, Google çerezleri ve reklamları ve LGPD ile GDPR kapsamındaki haklarınız.
updated: 28 Ekim 2026 tarihinde güncellendi
back: ← Oyuna dön
note: Bu, kolaylık amacıyla yapılmış bir çeviridir; herhangi bir farklılık durumunda Portekizce sürüm geçerlidir.
---
## Biz kimiz
**viagem**, bağımsız bir geliştirici tarafından yapılmış, tarayıcıda {site} adresinde çalışan ücretsiz bir ortak (co-op) oyundur. Bu sayfa oyunun hangi verileri, ne amaçla kullandığını ve neler yapabileceğinizi açıklar — Brezilya Genel Veri Koruma Kanunu (LGPD, 13.709/2018 sayılı Kanun) uyarınca ve Avrupa'dan oynayanlar için Genel Veri Koruma Tüzüğü (GDPR) uyarınca.

## Ne istemiyoruz
Oyunda kayıt yoktur. E-posta, şifre, telefon, kimlik belgesi veya ödeme bilgisi istemiyoruz ve kimsenin verisini satmıyoruz.

## Cihazınızda ne kalır
Seçimlerinizi hatırlamak için oyun, tarayıcının yerel depolamasında (`localStorage`), `viagem:` ile başlayan anahtarlarla şunları saklar:
- seçtiğiniz karakter, renk ve maceracı adı;
- ses, müzik ve titreşim ayarları, kamera yakınlaştırması, tasarruf modu ve tek kişilik oyundaki bot sayısı;
- daha önce gördüğünüz ipuçları ve maçın “utanç anlarında” görünmeyi kabul edip etmediğiniz;
- bir odadan çıkarıldıysanız, süre dolana kadar o odaya dönmenizi engelleyen geçici bir işaret.
Sekme açık olduğu sürece oyun, bağlantı koptuğunda veya sayfa bir güncelleme nedeniyle yeniden yüklendiğinde odadaki yerinizi korumak için `sessionStorage` (sekme kapanınca silinir) da kullanır.
Bu veriler cihazınızda kalır ve bize gönderilmez. Tarayıcı ayarlarında site verilerini temizleyerek bunları istediğiniz zaman silebilirsiniz. Oyun daha hızlı yüklenmek için görüntüleri ve sesleri önbellekte (service worker) de tutar; bu önbellekte sizinle ilgili hiçbir veri yoktur.

## Oda sunucusundan ne geçer
Bir maça katıldığınızda maceracı adınız, karakteriniz ve oyundaki eylemleriniz oda sunucusuna (Cloudflare'de barındırılır) gider ve aynı odadaki diğer oyuncular tarafından görülür. Yalnızca oda var olduğu sürece sunucu her oyuncunun adını ve karakterini, şifrelenmiş bir erişim kodunu (yerinize dönebilmeniz için) ve maçın ilerlemesini tutar. Her oda oluşturulduktan yaklaşık 50 dakika sonra tamamen silinir; maç geçmişinizi veya hesap tutmuyoruz.
Kötüye kullanımı önlemek için IP adresi, dakikada kaç oda oluşturulabileceğini sınırlamak amacıyla yalnızca o anda kullanılır; oyun onu saklamaz. Sunucunun bağlantılara ilişkin teknik kayıtlarında (bağlantının ne zaman açılıp kapandığı, gecikme, veri hacmi) ne ad ne de IP bulunur.

## Barındırma ve teknik kayıtlar
Site GitHub Pages'te, oda sunucusu ise Cloudflare'de barındırılır. Her web sitesinde olduğu gibi bu hizmetler, sayfaları sunmak ve kendilerini kötüye kullanıma karşı korumak için bağlantının teknik verilerini (IP adresi, tarayıcı, tarih ve saat) [GitHub](github) ve [Cloudflare](cloudflare) gizlilik politikalarına göre alır.

## Google çerezleri ve reklamları
Oyun, yalnızca maçlar arasında, asla oynarken değil, gösterilen **Google AdSense** (H5 Games Ads) reklamlarıyla desteklenir. Bunun için:
- Google ve iş ortakları reklam göstermek, aynı reklamı kaç kez gördüğünüzü sınırlamak, sonuçları ölçmek ve dolandırıcılığı önlemek için çerezler ve benzeri tanımlayıcılar kullanır.
- Google, bu ve diğer sitelere yaptığınız ziyaretlere dayanarak kişiselleştirilmiş reklamlar gösterebilir. Bkz. [Google'ın, hizmetlerini kullanan sitelerden gelen bilgileri nasıl kullandığı](partners).
- Kişiselleştirilmiş reklamları [Google Reklam Ayarları](adsettings) sayfasından, diğer şirketlerinkini ise [aboutads.info](aboutads) adresinden kapatabilirsiniz. Reklamlar görünmeye devam eder, ancak kişiselleştirme olmadan.
- Avrupa Birliği, Avrupa Ekonomik Alanı, Birleşik Krallık veya İsviçre'den gelenler, herhangi bir reklam çerezinden önce Google'ın onay mesajını (sertifikalı bir onay yönetim platformu) görür. Seçiminizi daha sonra değiştirmek için bu mesajın sayfada bıraktığı gizlilik ve çerezler bağlantısını kullanın veya mesajı yeniden görmek için tarayıcıda sitenin çerezlerini temizleyin.
Bahis, kumarhane ve diğer hassas kategorilerdeki reklamları engelliyoruz. Reklam engelleyici kullansanız da oyun normal şekilde çalışır.

## Bu verileri neden kullanıyoruz
Oyun verilerini maçın çalışması için kullanırız (istediğiniz hizmetin sunulması). Reklamlar, oyunu ücretsiz tutmaya yönelik meşru menfaate ve yasanın gerektirdiği yerlerde (Avrupa'da GDPR kapsamında ve kişiselleştirilmiş reklam çerezleri için) istediğiniz zaman geri çekebileceğiniz onayınıza dayanır.

## Çocuklar ve gençler
Oyun çizgi film tarzındadır ve hiçbir kişisel veri istemez. 13 yaşından küçükler için tasarlanmamıştır ve çocuklara ait verileri bilerek toplamayız; bir ebeveyn veya vasi bir çocuğun bize veri gönderdiğini düşünüyorsa bizimle iletişime geçsin, verileri sileriz. Uygunsuz reklam kategorilerini engelliyoruz.

## Haklarınız
LGPD (ve Avrupa'da GDPR) kapsamında verilerinizi işleyip işlemediğimizin teyidini, ayrıca erişim, düzeltme, anonimleştirme veya silme, taşınabilirlik, verileri kimlerle paylaştığımıza ilişkin bilgi, itiraz ve onayın geri çekilmesini talep edebilirsiniz. Neredeyse her şey kendi cihazınızda olduğundan, çoğu durumda tarayıcıda site verilerini temizlemek yeterlidir; oda verileri oda silindiğinde kendiliğinden kaybolur. Silme talebi dahil diğer tüm talepler için aşağıdaki iletişim adresini kullanın. Brezilya Ulusal Veri Koruma Otoritesine ([ANPD](anpd)) veya ülkenizin veri koruma otoritesine şikâyette de bulunabilirsiniz.

## İletişim
Gizlilikle ilgili sorular veya talepler: {email} adresine yazın ya da {issues} üzerinde bir tartışma açın.

## Değişiklikler
Bu politika değişirse sayfanın üstündeki tarih de onunla birlikte değişir.
