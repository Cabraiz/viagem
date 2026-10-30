name: Kiswahili
title: Sera ya Faragha
description: Jinsi viagem inavyoshughulikia data yako: kinachobaki kwenye kifaa chako, kinachopita kwenye seva ya vyumba, vidakuzi na matangazo ya Google, na haki zako chini ya LGPD na GDPR.
updated: Ilisasishwa tarehe 28 Oktoba 2026
back: ← Rudi kwenye mchezo
note: Hii ni tafsiri ya kurahisisha tu; ikiwa kuna tofauti, toleo la Kireno ndilo linalofuatwa.
---
## Sisi ni nani
**viagem** ni mchezo wa ushirikiano (co-op) wa bure unaochezwa kwenye kivinjari, katika {site}, uliotengenezwa na msanidi programu huru. Ukurasa huu unaeleza mchezo unatumia data gani, kwa madhumuni gani, na unachoweza kufanya — kwa mujibu wa Sheria ya Jumla ya Ulinzi wa Data ya Brazil (LGPD, Sheria 13.709/2018) na, kwa wachezaji kutoka Ulaya, Kanuni ya Jumla ya Ulinzi wa Data (GDPR).

## Tusichokiomba
Mchezo hauna usajili. Hatuombi barua pepe, nenosiri, nambari ya simu, hati ya utambulisho wala taarifa za malipo, na hatuuzi data ya mtu yeyote.

## Kinachobaki kwenye kifaa chako
Ili kukumbuka machaguo yako, mchezo huhifadhi kwenye hifadhi ya ndani ya kivinjari (`localStorage`), chini ya funguo zinazoanza na `viagem:`:
- mhusika, rangi na jina la msafiri uliyechagua;
- mipangilio ya sauti, muziki na mtetemo, ukuzaji wa kamera, hali ya kuokoa nishati na idadi ya boti katika mchezo wa peke yako;
- vidokezo ambavyo umeshaviona na kama unakubali kuonekana katika “matukio ya aibu” ya mechi;
- ikiwa uliondolewa kwenye chumba, alama ya muda inayokuzuia kurudi humo hadi muda wake uishe.
Wakati kichupo kiko wazi, mchezo pia hutumia `sessionStorage` (hufutwa kichupo kinapofungwa) ili kuhifadhi nafasi yako chumbani ikiwa muunganisho utakatika au ukurasa utapakiwa upya kwa sababu ya sasisho.
Data hii hubaki kwenye kifaa chako na haitumwi kwetu. Unaweza kuifuta wakati wowote kwa kufuta data ya tovuti katika mipangilio ya kivinjari. Mchezo pia huhifadhi picha na sauti kwenye akiba (service worker) ili upakie haraka zaidi; akiba hii haina data yoyote kukuhusu.

## Kinachopita kwenye seva ya vyumba
Unapojiunga na mechi, jina lako la msafiri, mhusika wako na vitendo vyako ndani ya mchezo huenda kwenye seva ya vyumba (inayopangishwa kwenye Cloudflare) na huonekana kwa wachezaji wengine katika chumba hicho hicho. Wakati tu chumba kipo, seva huhifadhi jina na mhusika wa kila mchezaji, msimbo wa ufikiaji uliosimbwa (ili uweze kurudi kwenye nafasi yako) na maendeleo ya mechi. Kila chumba hufutwa kabisa takriban dakika 50 baada ya kuundwa; hatuhifadhi historia ya mechi zako wala akaunti.
Ili kuzuia matumizi mabaya, anwani ya IP hutumika papo hapo tu kupunguza idadi ya vyumba vinavyoweza kuundwa kwa dakika; mchezo hauihifadhi. Kumbukumbu za kiufundi za miunganisho ya seva (wakati muunganisho ulifunguliwa na kufungwa, ucheleweshaji, kiasi cha data) hazina jina wala IP.

## Upangishaji na kumbukumbu za kiufundi
Tovuti inapangishwa kwenye GitHub Pages na seva ya vyumba kwenye Cloudflare. Kama tovuti yoyote, huduma hizi hupokea data ya kiufundi ya muunganisho (anwani ya IP, kivinjari, tarehe na saa) ili kuwasilisha kurasa na kujilinda dhidi ya matumizi mabaya, kwa mujibu wa sera za faragha za [GitHub](github) na [Cloudflare](cloudflare).

## Vidakuzi na matangazo ya Google
Mchezo unagharimiwa na matangazo ya **Google AdSense** (H5 Games Ads), yanayoonekana tu kati ya mechi, kamwe si wakati wa kucheza. Kwa ajili hiyo:
- Google na washirika wake hutumia vidakuzi na vitambulisho vinavyofanana ili kuonyesha matangazo, kupunguza mara unazoona tangazo lilelile, kupima matokeo na kuzuia ulaghai.
- Google inaweza kuonyesha matangazo yaliyobinafsishwa kulingana na ziara zako kwenye tovuti hii na nyingine. Tazama [jinsi Google inavyotumia taarifa kutoka tovuti zinazotumia huduma zake](partners).
- Unaweza kuzima matangazo yaliyobinafsishwa katika [Mipangilio ya Matangazo ya Google](adsettings), au ya kampuni nyingine katika [aboutads.info](aboutads). Matangazo yataendelea kuonekana, lakini bila kubinafsishwa.
- Wageni kutoka Umoja wa Ulaya, Eneo la Kiuchumi la Ulaya, Uingereza au Uswisi huona ujumbe wa idhini kutoka Google (jukwaa lililoidhinishwa la kudhibiti idhini) kabla ya kidakuzi chochote cha matangazo. Ili kubadilisha chaguo lako baadaye, tumia kiungo cha faragha na vidakuzi ambacho ujumbe huo huacha kwenye ukurasa, au futa vidakuzi vya tovuti kwenye kivinjari ili uone ujumbe huo tena.
Tunazuia matangazo ya kamari, kasino na kategoria nyingine nyeti. Ukitumia kizuia matangazo, mchezo hufanya kazi kama kawaida.

## Kwa nini tunatumia data hii
Tunatumia data ya mchezo ili mechi ifanye kazi (utoaji wa huduma unayoiomba). Matangazo yanategemea maslahi halali ya kuuweka mchezo bure na, pale sheria inapohitaji (kama GDPR barani Ulaya, na kwa vidakuzi vya matangazo yaliyobinafsishwa), idhini yako, ambayo unaweza kuiondoa wakati wowote.

## Watoto na vijana
Mchezo una mtindo wa katuni na hauombi data yoyote ya kibinafsi. Haukusudiwa watoto walio chini ya umri wa miaka 13 na hatukusanyi kwa makusudi data ya watoto; ikiwa mzazi au mlezi anaamini mtoto ametutumia data, wasiliana nasi nasi tutaifuta. Tunazuia kategoria za matangazo zisizofaa.

## Haki zako
Chini ya LGPD (na, barani Ulaya, GDPR) unaweza kuomba uthibitisho kama tunachakata data yako, pamoja na ufikiaji, urekebishaji, kufanya data isijulikane au kufutwa, uhamishaji, taarifa kuhusu tunayeshiriki naye, pingamizi na kuondoa idhini. Kwa kuwa karibu kila kitu kiko kwenye kifaa chako mwenyewe, katika hali nyingi inatosha kufuta data ya tovuti kwenye kivinjari; data ya chumba hupotea yenyewe chumba kinapofutwa. Kwa ombi lingine lolote, ikiwemo kufuta, tumia mawasiliano yaliyo hapa chini. Unaweza pia kuwasilisha malalamiko kwa Mamlaka ya Kitaifa ya Ulinzi wa Data ya Brazil ([ANPD](anpd)) au mamlaka ya ulinzi wa data ya nchi yako.

## Mawasiliano
Maswali au maombi kuhusu faragha: andika kwa {email} au anzisha mazungumzo kwenye {issues}.

## Mabadiliko
Sera hii ikibadilika, tarehe iliyo juu ya ukurasa hubadilika pamoja nayo.
