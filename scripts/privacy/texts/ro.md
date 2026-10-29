name: Română
title: Politica de confidențialitate
description: Cum gestionează viagem datele tale: ce rămâne pe dispozitivul tău, ce trece prin serverul de camere, cookie-urile și reclamele Google și drepturile tale conform LGPD și GDPR.
updated: Actualizată pe 28 octombrie 2026
back: ← Înapoi la joc
note: Aceasta este o traducere oferită pentru comoditate; în caz de diferențe, prevalează versiunea în portugheză.
---
## Cine suntem
**viagem** este un joc cooperativ (co-op) gratuit care rulează în browser, la {site}, creat de un dezvoltator independent. Această pagină explică ce date folosește jocul, în ce scop și ce poți face — conform Legii generale braziliene privind protecția datelor (LGPD, Legea 13.709/2018) și, pentru cei care joacă din Europa, Regulamentului general privind protecția datelor (GDPR).

## Ce nu îți cerem
Jocul nu are înregistrare. Nu cerem e-mail, parolă, număr de telefon, act de identitate sau date de plată și nu vindem datele nimănui.

## Ce rămâne pe dispozitivul tău
Pentru a-și aminti alegerile tale, jocul salvează în spațiul de stocare local al browserului (`localStorage`), sub chei care încep cu `viagem:`:
- personajul, culoarea și numele de aventurier pe care le-ai ales;
- setările de sunet, muzică și vibrații, zoomul camerei, modul de economisire și numărul de boți când joci singur;
- sfaturile pe care le-ai văzut deja și dacă ești de acord să apari în „momentele jenante” ale meciului;
- dacă ai fost scos dintr-o cameră, un marcaj temporar care te împiedică să revii acolo până expiră timpul.
Cât timp fila este deschisă, jocul folosește și `sessionStorage` (se șterge la închiderea filei) pentru a-ți păstra locul în cameră dacă se întrerupe conexiunea sau pagina se reîncarcă din cauza unei actualizări.
Aceste date rămân pe dispozitivul tău și nu ne sunt trimise. Le poți șterge oricând golind datele site-ului în setările browserului. Jocul salvează și imagini și sunete în cache (service worker) ca să se încarce mai repede; acest cache nu conține nicio dată despre tine.

## Ce trece prin serverul de camere
Când intri într-un meci, numele tău de aventurier, personajul și acțiunile tale din joc ajung la serverul de camere (găzduit la Cloudflare) și sunt văzute de ceilalți jucători din aceeași cameră. Doar cât timp camera există, serverul păstrează numele și personajul fiecărui jucător, un cod de acces criptat (ca să poți reveni la locul tău) și progresul meciului. Fiecare cameră este ștearsă complet în aproximativ 50 de minute de la creare; nu păstrăm istoricul meciurilor tale și nici conturi.
Pentru a preveni abuzurile, adresa IP este folosită doar pe moment pentru a limita câte camere pot fi create pe minut; jocul nu o salvează. Jurnalele tehnice ale conexiunilor serverului (când s-a deschis și s-a închis o conexiune, latența, volumul de date) nu conțin nici nume, nici IP.

## Găzduire și jurnale tehnice
Site-ul este găzduit pe GitHub Pages, iar serverul de camere la Cloudflare. Ca orice site web, aceste servicii primesc date tehnice de conexiune (adresa IP, browserul, data și ora) pentru a livra paginile și a se proteja împotriva abuzurilor, conform politicilor de confidențialitate ale [GitHub](github) și [Cloudflare](cloudflare).

## Cookie-uri și reclame Google
Jocul este finanțat prin reclame **Google AdSense** (H5 Games Ads), care apar doar între meciuri, niciodată în timpul jocului. Pentru aceasta:
- Google și partenerii săi folosesc cookie-uri și identificatori similari pentru a afișa reclame, a limita de câte ori vezi aceeași reclamă, a măsura rezultatele și a preveni frauda.
- Google poate afișa reclame personalizate pe baza vizitelor tale pe acest site și pe altele. Vezi [cum folosește Google informațiile de pe site-urile care îi utilizează serviciile](partners).
- Poți dezactiva reclamele personalizate din [Setările pentru reclame Google](adsettings), sau pe cele ale altor companii pe [aboutads.info](aboutads). Reclamele vor continua să apară, dar fără personalizare.
- Vizitatorii din Uniunea Europeană, Spațiul Economic European, Regatul Unit sau Elveția văd un mesaj de consimțământ de la Google (o platformă certificată de gestionare a consimțământului) înainte de orice cookie de publicitate. Pentru a-ți schimba ulterior alegerea, folosește linkul de confidențialitate și cookie-uri pe care mesajul îl lasă pe pagină sau șterge cookie-urile site-ului din browser ca să vezi din nou mesajul.
Blocăm reclamele la pariuri, cazinouri și alte categorii sensibile. Dacă folosești un blocant de reclame, jocul funcționează normal.

## De ce folosim aceste date
Folosim datele jocului pentru ca meciul să funcționeze (furnizarea serviciului pe care îl ceri). Reclamele se bazează pe interesul legitim de a menține jocul gratuit și, acolo unde legea o cere (cum ar fi GDPR în Europa și pentru cookie-urile de reclame personalizate), pe consimțământul tău, pe care îl poți retrage oricând.

## Copii și adolescenți
Jocul are stil de desen animat și nu cere nicio dată personală. Nu se adresează copiilor sub 13 ani și nu colectăm în mod intenționat date ale copiilor; dacă un părinte sau tutore crede că un copil ne-a trimis date, contactează-ne și le vom șterge. Blocăm categoriile de reclame nepotrivite.

## Drepturile tale
Conform LGPD (și, în Europa, GDPR) poți cere confirmarea faptului că îți prelucrăm datele, precum și acces, rectificare, anonimizare sau ștergere, portabilitate, informații despre cu cine le partajăm, opoziție și retragerea consimțământului. Deoarece aproape totul se află pe propriul tău dispozitiv, în cele mai multe cazuri este suficient să ștergi datele site-ului din browser; datele unei camere dispar singure când camera este ștearsă. Pentru orice altă cerere, inclusiv de ștergere, folosește contactul de mai jos. Poți, de asemenea, să depui o plângere la Autoritatea Națională pentru Protecția Datelor din Brazilia ([ANPD](anpd)) sau la autoritatea de protecție a datelor din țara ta.

## Contact
Întrebări sau solicitări despre confidențialitate: scrie la {email} sau deschide o discuție pe {issues}.

## Modificări
Dacă această politică se schimbă, se schimbă odată cu ea și data din partea de sus a paginii.
