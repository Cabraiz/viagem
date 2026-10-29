name: Svenska
title: Integritetspolicy
description: Hur viagem hanterar dina uppgifter: vad som stannar på din enhet, vad som passerar rumsservern, Googles cookies och annonser, och dina rättigheter enligt LGPD och GDPR.
updated: Uppdaterad den 28 oktober 2026
back: ← Tillbaka till spelet
note: Detta är en översättning för enkelhetens skull; vid skillnader gäller den portugisiska versionen.
---
## Vilka vi är
**viagem** är ett gratis samarbetsspel (co-op) som körs i webbläsaren, på {site}, skapat av en oberoende utvecklare. Den här sidan förklarar vilka uppgifter spelet använder, varför, och vad du kan göra — enligt Brasiliens allmänna dataskyddslag (LGPD, lag 13.709/2018) och, för spelare i Europa, dataskyddsförordningen (GDPR).

## Vad vi inte ber om
Spelet har ingen registrering. Vi ber inte om e-postadress, lösenord, telefonnummer, identitetshandling eller betalningsuppgifter, och vi säljer ingens uppgifter.

## Vad som stannar på din enhet
För att komma ihåg dina val sparar spelet i webbläsarens lokala lagring (`localStorage`), under nycklar som börjar med `viagem:`:
- karaktären, färgen och äventyrarnamnet du valde;
- inställningarna för ljud, musik och vibration, kamerazoomen, energisparläget och antalet bottar när du spelar ensam;
- tipsen du redan har sett och om du går med på att synas i matchens ”pinsamma ögonblick”;
- om du har tagits bort från ett rum, en tillfällig markering som hindrar dig från att gå tillbaka dit tills tiden har gått ut.
Medan fliken är öppen använder spelet också `sessionStorage` (rensas när fliken stängs) för att behålla din plats i rummet om anslutningen bryts eller sidan laddas om på grund av en uppdatering.
Uppgifterna stannar på din enhet och skickas inte till oss. Du kan radera dem när du vill genom att rensa webbplatsens data i webbläsarens inställningar. Spelet sparar också bilder och ljud i en cache (service worker) så att det laddar snabbare; den cachen innehåller inga uppgifter om dig.

## Vad som passerar rumsservern
När du går med i en match skickas ditt äventyrarnamn, din karaktär och dina handlingar i spelet till rumsservern (som körs hos Cloudflare) och visas för de andra spelarna i samma rum. Endast så länge rummet finns sparar servern varje spelares namn och karaktär, en krypterad åtkomstkod (så att du kan återvända till din plats) och matchens förlopp. Varje rum raderas helt inom cirka 50 minuter efter att det skapats; vi sparar ingen historik över dina matcher och inga konton.
För att förhindra missbruk används IP-adressen bara i stunden för att begränsa hur många rum som kan skapas per minut; spelet sparar den inte. Serverns tekniska anslutningsloggar (när en anslutning öppnas och stängs, fördröjning, datamängd) innehåller varken namn eller IP.

## Drift och tekniska loggar
Webbplatsen ligger på GitHub Pages och rumsservern hos Cloudflare. Som alla webbplatser tar dessa tjänster emot tekniska anslutningsuppgifter (IP-adress, webbläsare, datum och tid) för att leverera sidorna och skydda sig mot missbruk, enligt integritetspolicyerna för [GitHub](github) och [Cloudflare](cloudflare).

## Googles cookies och annonser
Spelet finansieras med annonser från **Google AdSense** (H5 Games Ads), som bara visas mellan matcher, aldrig medan du spelar. För detta:
- Google och dess partner använder cookies och liknande identifierare för att visa annonser, begränsa hur många gånger du ser samma annons, mäta resultat och förhindra bedrägerier.
- Google kan visa anpassade annonser baserat på dina besök på den här och andra webbplatser. Se [hur Google använder information från webbplatser som använder Googles tjänster](partners).
- Du kan stänga av anpassade annonser i [Googles annonsinställningar](adsettings), eller andra företags på [aboutads.info](aboutads). Annonser fortsätter att visas, men utan anpassning.
- Besökare från Europeiska unionen, Europeiska ekonomiska samarbetsområdet, Storbritannien eller Schweiz ser ett samtyckesmeddelande från Google (en certifierad plattform för samtyckeshantering) innan någon annonscookie används. För att ändra ditt val senare använder du länken för integritet och cookies som meddelandet lämnar på sidan, eller rensar webbplatsens cookies i webbläsaren för att se meddelandet igen.
Vi blockerar annonser för spel om pengar, kasinon och andra känsliga kategorier. Om du använder en annonsblockerare fungerar spelet som vanligt.

## Varför vi använder dessa uppgifter
Vi använder speluppgifterna för att matchen ska fungera (tillhandahållande av tjänsten du ber om). Annonserna grundar sig på vårt berättigade intresse av att hålla spelet gratis och, där lagen kräver det (som enligt GDPR i Europa och för cookies för anpassade annonser), på ditt samtycke, som du när som helst kan återkalla.

## Barn och tonåringar
Spelet är i tecknad stil och ber inte om några personuppgifter. Det riktar sig inte till barn under 13 år och vi samlar inte medvetet in uppgifter om barn; om en förälder eller vårdnadshavare tror att ett barn har skickat uppgifter till oss, kontakta oss så raderar vi dem. Vi blockerar olämpliga annonskategorier.

## Dina rättigheter
Enligt LGPD (och, i Europa, GDPR) kan du begära bekräftelse på om vi behandlar dina uppgifter, samt tillgång, rättelse, anonymisering eller radering, dataportabilitet, information om vilka vi delar dem med, invändning och återkallande av samtycke. Eftersom nästan allt finns på din egen enhet räcker det i de flesta fall att rensa webbplatsens data i webbläsaren; ett rums uppgifter försvinner av sig själva när rummet raderas. För alla andra begäranden, även om radering, använd kontakten nedan. Du kan också lämna klagomål till Brasiliens nationella dataskyddsmyndighet ([ANPD](anpd)) eller till dataskyddsmyndigheten i ditt land.

## Kontakt
Frågor eller begäranden om integritet: skriv till {email} eller starta en konversation på {issues}.

## Ändringar
Om den här policyn ändras, ändras datumet högst upp på sidan med den.
