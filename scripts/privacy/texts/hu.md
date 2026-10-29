name: Magyar
title: Adatvédelmi irányelvek
description: Hogyan kezeli a viagem az adataidat: mi marad az eszközödön, mi halad át a szobaszerveren, a Google sütijei és hirdetései, valamint a jogaid az LGPD és a GDPR szerint.
updated: Frissítve: 2026. október 28.
back: ← Vissza a játékhoz
note: Ez csak a kényelmet szolgáló fordítás; eltérés esetén a portugál változat az irányadó.
---
## Kik vagyunk
A **viagem** egy ingyenes, kooperatív (co-op) játék, amely a böngészőben fut a {site} címen, és egy független fejlesztő készítette. Ez az oldal elmagyarázza, milyen adatokat használ a játék, mire, és mit tehetsz — a brazil általános adatvédelmi törvény (LGPD, 13.709/2018. sz. törvény) és az Európából játszók esetében az általános adatvédelmi rendelet (GDPR) szerint.

## Amit nem kérünk
A játékban nincs regisztráció. Nem kérünk e-mail-címet, jelszót, telefonszámot, személyazonosító okmányt vagy fizetési adatokat, és senkinek az adatait nem adjuk el.

## Ami az eszközödön marad
Hogy megjegyezze a választásaidat, a játék a böngésző helyi tárhelyén (`localStorage`) tárolja, `viagem:` kezdetű kulcsok alatt:
- a választott karaktert, színt és kalandornevet;
- a hang-, zene- és rezgésbeállításokat, a kamera nagyítását, az energiatakarékos módot és a botok számát egyszemélyes játékban;
- a már látott tippeket, és hogy hozzájárulsz-e ahhoz, hogy megjelenj a meccs „kínos pillanataiban”;
- ha eltávolítottak egy szobából, egy ideiglenes jelölést, amely megakadályozza, hogy visszatérj oda, amíg le nem jár az idő.
Amíg a lap nyitva van, a játék a `sessionStorage`-t is használja (a lap bezárásakor törlődik), hogy megtartsa a helyedet a szobában, ha megszakad a kapcsolat, vagy az oldal egy frissítés miatt újratöltődik.
Ezek az adatok az eszközödön maradnak, és nem kerülnek hozzánk. Bármikor törölheted őket a webhely adatainak törlésével a böngésző beállításaiban. A játék képeket és hangokat is tárol gyorsítótárban (service worker), hogy gyorsabban betöltődjön; ez a gyorsítótár semmilyen adatot nem tartalmaz rólad.

## Ami a szobaszerveren halad át
Amikor csatlakozol egy meccshez, a kalandorneved, a karaktered és a játékbeli műveleteid a szobaszerverre kerülnek (amelyet a Cloudflare üzemeltet), és ugyanabban a szobában lévő többi játékos látja őket. Csak amíg a szoba létezik, a szerver megőrzi minden játékos nevét és karakterét, egy titkosított hozzáférési kódot (hogy visszatérhess a helyedre) és a meccs állását. Minden szoba létrehozása után körülbelül 50 percen belül teljesen törlődik; nem őrizzük meg a meccseid előzményeit, és fiókokat sem.
A visszaélések megelőzése érdekében az IP-címet csak az adott pillanatban használjuk annak korlátozására, hogy percenként hány szoba hozható létre; a játék nem tárolja. A szerver kapcsolatainak technikai naplói (mikor nyílt meg és zárult le egy kapcsolat, késleltetés, adatmennyiség) sem nevet, sem IP-címet nem tartalmaznak.

## Tárhely és technikai naplók
A webhely a GitHub Pages-en, a szobaszerver a Cloudflare-nél fut. Mint minden webhely esetében, ezek a szolgáltatások technikai kapcsolati adatokat (IP-cím, böngésző, dátum és idő) kapnak az oldalak kiszolgálásához és a visszaélések elleni védekezéshez, a [GitHub](github) és a [Cloudflare](cloudflare) adatvédelmi irányelvei szerint.

## A Google sütijei és hirdetései
A játékot a **Google AdSense** (H5 Games Ads) hirdetései finanszírozzák, amelyek csak a meccsek között jelennek meg, játék közben soha. Ehhez:
- A Google és partnerei sütiket és hasonló azonosítókat használnak a hirdetések megjelenítésére, annak korlátozására, hogy hányszor látod ugyanazt a hirdetést, az eredmények mérésére és a csalások megelőzésére.
- A Google személyre szabott hirdetéseket jeleníthet meg az ezen és más webhelyeken tett látogatásaid alapján. Lásd: [hogyan használja a Google a szolgáltatásait használó webhelyekről származó információkat](partners).
- A személyre szabott hirdetéseket kikapcsolhatod a [Google hirdetési beállításaiban](adsettings), más cégekéit pedig az [aboutads.info](aboutads) oldalon. A hirdetések továbbra is megjelennek, de személyre szabás nélkül.
- Az Európai Unióból, az Európai Gazdasági Térségből, az Egyesült Királyságból vagy Svájcból érkező látogatók bármilyen hirdetési süti előtt a Google hozzájárulási üzenetét látják (egy tanúsított hozzájáruláskezelő platform). Ha később módosítanád a döntésedet, használd az adatvédelmi és süti-linket, amelyet az üzenet az oldalon hagy, vagy töröld a webhely sütijeit a böngészőben, hogy újra megjelenjen az üzenet.
Letiltjuk a fogadási, kaszinó- és egyéb érzékeny kategóriájú hirdetéseket. Ha hirdetésblokkolót használsz, a játék ugyanúgy működik.

## Miért használjuk ezeket az adatokat
A játék adatait azért használjuk, hogy a meccs működjön (az általad kért szolgáltatás nyújtása). A hirdetések azon a jogos érdeken alapulnak, hogy a játék ingyenes maradjon, és ahol a jogszabály előírja (például a GDPR Európában, valamint a személyre szabott hirdetések sütijei esetében), a hozzájárulásodon, amelyet bármikor visszavonhatsz.

## Gyermekek és serdülők
A játék rajzfilmes stílusú, és semmilyen személyes adatot nem kér. Nem 13 év alatti gyermekeknek szól, és tudatosan nem gyűjtünk gyermekektől adatokat; ha egy szülő vagy gondviselő úgy véli, hogy egy gyermek adatokat küldött nekünk, vegye fel velünk a kapcsolatot, és töröljük azokat. Letiltjuk a nem megfelelő hirdetési kategóriákat.

## A jogaid
Az LGPD (és Európában a GDPR) szerint kérheted annak megerősítését, hogy kezeljük-e az adataidat, valamint a hozzáférést, helyesbítést, anonimizálást vagy törlést, az adathordozhatóságot, tájékoztatást arról, kivel osztjuk meg őket, tiltakozhatsz, és visszavonhatod a hozzájárulásodat. Mivel szinte minden a saját eszközödön van, a legtöbb esetben elég törölni a webhely adatait a böngészőben; a szoba adatai maguktól eltűnnek, amikor a szoba törlődik. Bármilyen más kéréshez, a törlést is beleértve, használd az alábbi elérhetőséget. Panaszt tehetsz a brazil Nemzeti Adatvédelmi Hatóságnál ([ANPD](anpd)) vagy a saját országod adatvédelmi hatóságánál is.

## Kapcsolat
Adatvédelemmel kapcsolatos kérdések vagy kérések: írj a {email} címre, vagy nyiss egy beszélgetést itt: {issues}.

## Változások
Ha ezek az irányelvek megváltoznak, velük együtt változik az oldal tetején lévő dátum is.
