name: Filipino
title: Patakaran sa Privacy
description: Paano hinahawakan ng viagem ang iyong data: ano ang nananatili sa iyong device, ano ang dumadaan sa room server, ang cookies at ads ng Google, at ang iyong mga karapatan sa ilalim ng LGPD at GDPR.
updated: Na-update noong Oktubre 28, 2026
back: ← Bumalik sa laro
note: Isa itong pagsasaling pangkaginhawahan; kung may pagkakaiba, ang bersyong Portuges ang masusunod.
---
## Sino kami
Ang **viagem** ay isang libreng larong kooperatiba (co-op) na tumatakbo sa browser, sa {site}, na ginawa ng isang independiyenteng developer. Ipinaliliwanag ng pahinang ito kung anong data ang ginagamit ng laro, para saan, at kung ano ang maaari mong gawin — ayon sa Pangkalahatang Batas sa Proteksyon ng Data ng Brazil (LGPD, Batas 13.709/2018) at, para sa mga naglalaro mula sa Europa, sa General Data Protection Regulation (GDPR).

## Ang hindi namin hinihingi
Walang pagpaparehistro ang laro. Hindi kami humihingi ng e-mail, password, numero ng telepono, dokumento ng pagkakakilanlan o detalye ng pagbabayad, at hindi kami nagbebenta ng data ng sinuman.

## Ang nananatili sa iyong device
Para matandaan ang iyong mga pinili, iniimbak ng laro sa lokal na storage ng browser (`localStorage`), sa ilalim ng mga key na nagsisimula sa `viagem:`:
- ang karakter, kulay at pangalan ng adventurer na pinili mo;
- ang mga setting ng tunog, musika at vibration, ang zoom ng camera, ang power-saving mode at ang bilang ng bot kapag mag-isang naglalaro;
- ang mga tip na nakita mo na at kung pumapayag kang lumabas sa mga “nakakahiyang sandali” ng laban;
- kung inalis ka sa isang room, isang pansamantalang marka na pumipigil sa iyong bumalik doon hanggang matapos ang oras.
Habang bukas ang tab, ginagamit din ng laro ang `sessionStorage` (nabubura kapag isinara ang tab) para mapanatili ang puwesto mo sa room kung maputol ang koneksyon o mag-reload ang pahina dahil sa update.
Nananatili ang data na ito sa iyong device at hindi ipinapadala sa amin. Maaari mo itong burahin anumang oras sa pamamagitan ng pag-clear ng data ng site sa mga setting ng browser. Nag-iimbak din ang laro ng mga larawan at tunog sa cache (service worker) para mas mabilis itong mag-load; walang anumang data tungkol sa iyo ang cache na ito.

## Ang dumadaan sa room server
Kapag sumali ka sa isang laban, ang pangalan mo bilang adventurer, ang iyong karakter at ang iyong mga aksyon sa laro ay napupunta sa room server (naka-host sa Cloudflare) at nakikita ng ibang manlalaro sa parehong room. Habang umiiral lamang ang room, iniingatan ng server ang pangalan at karakter ng bawat manlalaro, isang naka-encrypt na access code (para makabalik ka sa puwesto mo) at ang progreso ng laban. Ang bawat room ay ganap na binubura sa loob ng humigit-kumulang 50 minuto mula nang malikha; hindi kami nag-iingat ng kasaysayan ng iyong mga laban o ng mga account.
Para maiwasan ang pang-aabuso, ginagamit lamang ang IP address sa mismong sandaling iyon para limitahan kung ilang room ang malilikha bawat minuto; hindi ito iniimbak ng laro. Ang mga teknikal na log ng koneksyon ng server (kailan nagbukas at nagsara ang koneksyon, latency, dami ng data) ay walang pangalan o IP.

## Hosting at mga teknikal na log
Naka-host ang site sa GitHub Pages at ang room server sa Cloudflare. Gaya ng anumang website, tumatanggap ang mga serbisyong ito ng teknikal na data ng koneksyon (IP address, browser, petsa at oras) para maihatid ang mga pahina at maprotektahan ang sarili laban sa pang-aabuso, ayon sa mga patakaran sa privacy ng [GitHub](github) at [Cloudflare](cloudflare).

## Cookies at ads ng Google
Pinopondohan ang laro ng mga ad ng **Google AdSense** (H5 Games Ads), na lumalabas lamang sa pagitan ng mga laban, hindi kailanman habang naglalaro. Para dito:
- Gumagamit ang Google at ang mga partner nito ng cookies at mga katulad na identifier para magpakita ng ads, limitahan kung ilang beses mong nakikita ang parehong ad, sukatin ang mga resulta at pigilan ang pandaraya.
- Maaaring magpakita ang Google ng personalized ads batay sa iyong mga pagbisita sa site na ito at sa iba pang mga site. Tingnan ang [kung paano ginagamit ng Google ang impormasyon mula sa mga site na gumagamit ng mga serbisyo nito](partners).
- Maaari mong i-off ang personalized ads sa [Mga Setting ng Ad ng Google](adsettings), o ang sa ibang kumpanya sa [aboutads.info](aboutads). Patuloy na lalabas ang ads, pero walang personalization.
- Ang mga bisita mula sa European Union, European Economic Area, United Kingdom o Switzerland ay makakakita ng mensahe ng pahintulot mula sa Google (isang sertipikadong consent management platform) bago ang anumang ad cookie. Para baguhin ang iyong pinili sa ibang pagkakataon, gamitin ang link sa privacy at cookies na iniiwan ng mensaheng iyon sa pahina, o i-clear ang cookies ng site sa iyong browser para makita muli ang mensahe.
Bina-block namin ang mga ad ng pagsusugal, casino at iba pang sensitibong kategorya. Kung gumagamit ka ng ad blocker, gumagana nang normal ang laro.

## Bakit namin ginagamit ang data na ito
Ginagamit namin ang data ng laro para gumana ang laban (pagbibigay ng serbisyong hinihiling mo). Nakabatay ang ads sa lehitimong interes na panatilihing libre ang laro at, kung saan hinihingi ng batas (gaya sa Europa sa ilalim ng GDPR, at para sa cookies ng personalized ads), sa iyong pahintulot, na maaari mong bawiin anumang oras.

## Mga bata at kabataan
Cartoon ang istilo ng laro at hindi ito humihingi ng anumang personal na data. Hindi ito para sa mga batang wala pang 13 taong gulang at hindi namin sinasadyang mangolekta ng data ng mga bata; kung naniniwala ang isang magulang o tagapag-alaga na may batang nagpadala sa amin ng data, makipag-ugnayan sa amin at buburahin namin ito. Bina-block namin ang mga hindi angkop na kategorya ng ad.

## Ang iyong mga karapatan
Sa ilalim ng LGPD (at, sa Europa, ng GDPR) maaari kang humiling ng kumpirmasyon kung pinoproseso namin ang iyong data, pati na rin ng access, pagwawasto, anonymization o pagbura, portability, impormasyon kung kanino namin ito ibinabahagi, pagtutol at pagbawi ng pahintulot. Dahil halos lahat ay nasa sarili mong device, sa karamihan ng kaso sapat nang i-clear ang data ng site sa browser; kusang nawawala ang data ng room kapag binura ang room. Para sa anumang iba pang kahilingan, kabilang ang pagbura, gamitin ang contact sa ibaba. Maaari ka ring magreklamo sa Pambansang Awtoridad sa Proteksyon ng Data ng Brazil ([ANPD](anpd)) o sa awtoridad sa proteksyon ng data ng iyong bansa.

## Makipag-ugnayan
Mga tanong o kahilingan tungkol sa privacy: sumulat sa {email} o magbukas ng usapan sa {issues}.

## Mga pagbabago
Kung magbago ang patakarang ito, magbabago rin ang petsa sa itaas ng pahina.
