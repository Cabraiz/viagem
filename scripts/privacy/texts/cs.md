name: Čeština
title: Zásady ochrany osobních údajů
description: Jak viagem nakládá s vašimi údaji: co zůstává ve vašem zařízení, co prochází serverem místností, soubory cookie a reklamy Google a vaše práva podle LGPD a GDPR.
updated: Aktualizováno 28. října 2026
back: ← Zpět do hry
note: Toto je překlad pouze pro usnadnění; v případě rozdílů platí portugalská verze.
---
## Kdo jsme
**viagem** je bezplatná kooperativní hra (co-op), která běží v prohlížeči na {site} a kterou vytvořil nezávislý vývojář. Tato stránka vysvětluje, jaké údaje hra používá, k čemu a co můžete udělat — podle brazilského obecného zákona o ochraně osobních údajů (LGPD, zákon 13.709/2018) a pro hráče z Evropy podle obecného nařízení o ochraně osobních údajů (GDPR).

## Co po vás nežádáme
Hra nemá registraci. Nežádáme e-mail, heslo, telefonní číslo, doklad totožnosti ani platební údaje a nikomu neprodáváme ničí údaje.

## Co zůstává ve vašem zařízení
Aby si hra pamatovala vaše volby, ukládá do místního úložiště prohlížeče (`localStorage`) pod klíči začínajícími na `viagem:`:
- postavu, barvu a jméno dobrodruha, které jste si vybrali;
- nastavení zvuku, hudby a vibrací, přiblížení kamery, úsporný režim a počet botů při hře o samotě;
- tipy, které jste už viděli, a zda souhlasíte s tím, že se objevíte v „trapných momentech“ zápasu;
- pokud jste byli z místnosti odebráni, dočasnou značku, která vám brání se do ní vrátit, dokud nevyprší čas.
Dokud je karta otevřená, hra používá také `sessionStorage` (vymaže se při zavření karty), aby vám udržela místo v místnosti, pokud spojení vypadne nebo se stránka kvůli aktualizaci znovu načte.
Tyto údaje zůstávají ve vašem zařízení a nejsou nám odesílány. Můžete je kdykoli smazat vymazáním dat webu v nastavení prohlížeče. Hra také ukládá obrázky a zvuky do mezipaměti (service worker), aby se načítala rychleji; tato mezipaměť neobsahuje žádné údaje o vás.

## Co prochází serverem místností
Když se připojíte k zápasu, vaše jméno dobrodruha, postava a vaše akce ve hře jdou na server místností (hostovaný u Cloudflare) a vidí je ostatní hráči ve stejné místnosti. Pouze dokud místnost existuje, server uchovává jméno a postavu každého hráče, šifrovaný přístupový kód (abyste se mohli vrátit na své místo) a průběh zápasu. Každá místnost je zcela smazána přibližně do 50 minut od vytvoření; neuchováváme historii vašich zápasů ani účty.
Aby se předešlo zneužití, IP adresa se používá jen v danou chvíli k omezení počtu místností, které lze vytvořit za minutu; hra ji neukládá. Technické záznamy o připojeních serveru (kdy se spojení otevřelo a zavřelo, latence, objem dat) neobsahují jméno ani IP.

## Hosting a technické záznamy
Web je hostován na GitHub Pages a server místností u Cloudflare. Jako každý web tyto služby přijímají technické údaje o připojení (IP adresu, prohlížeč, datum a čas), aby mohly doručovat stránky a chránit se před zneužitím, podle zásad ochrany osobních údajů [GitHub](github) a [Cloudflare](cloudflare).

## Soubory cookie a reklamy Google
Hra je financována reklamami **Google AdSense** (H5 Games Ads), které se zobrazují jen mezi zápasy, nikdy během hraní. Proto:
- Google a jeho partneři používají soubory cookie a podobné identifikátory k zobrazování reklam, omezení počtu zobrazení téže reklamy, měření výsledků a předcházení podvodům.
- Google může zobrazovat personalizované reklamy na základě vašich návštěv tohoto a jiných webů. Viz [jak Google používá informace z webů, které používají jeho služby](partners).
- Personalizované reklamy můžete vypnout v [Nastavení reklam Google](adsettings), reklamy jiných společností na [aboutads.info](aboutads). Reklamy se budou dál zobrazovat, ale bez personalizace.
- Návštěvníci z Evropské unie, Evropského hospodářského prostoru, Spojeného království nebo Švýcarska uvidí před jakýmkoli reklamním souborem cookie zprávu o souhlasu od Googlu (certifikované platformy pro správu souhlasu). Chcete-li svou volbu později změnit, použijte odkaz na ochranu soukromí a soubory cookie, který zpráva ponechá na stránce, nebo vymažte soubory cookie webu v prohlížeči, aby se zpráva zobrazila znovu.
Blokujeme reklamy na sázení, kasina a další citlivé kategorie. Pokud používáte blokátor reklam, hra funguje normálně.

## Proč tyto údaje používáme
Údaje hry používáme, aby zápas fungoval (poskytování služby, o kterou žádáte). Reklamy se opírají o oprávněný zájem udržet hru zdarma a tam, kde to zákon vyžaduje (jako GDPR v Evropě a u souborů cookie personalizovaných reklam), o váš souhlas, který můžete kdykoli odvolat.

## Děti a dospívající
Hra má kreslený styl a nežádá žádné osobní údaje. Není určena dětem mladším 13 let a vědomě neshromažďujeme údaje dětí; pokud se rodič nebo zákonný zástupce domnívá, že nám dítě poslalo údaje, kontaktujte nás a smažeme je. Blokujeme nevhodné kategorie reklam.

## Vaše práva
Podle LGPD (a v Evropě podle GDPR) můžete požádat o potvrzení, zda vaše údaje zpracováváme, a také o přístup, opravu, anonymizaci nebo výmaz, přenositelnost, informace o tom, s kým je sdílíme, vznést námitku a odvolat souhlas. Protože téměř vše je ve vašem vlastním zařízení, ve většině případů stačí vymazat data webu v prohlížeči; údaje místnosti zmizí samy, když je místnost smazána. Pro jakoukoli jinou žádost, včetně výmazu, použijte kontakt níže. Můžete také podat stížnost u brazilského Národního úřadu pro ochranu osobních údajů ([ANPD](anpd)) nebo u úřadu pro ochranu osobních údajů ve vaší zemi.

## Kontakt
Dotazy nebo žádosti týkající se soukromí: napište na {email} nebo otevřete diskusi na {issues}.

## Změny
Pokud se tyto zásady změní, změní se s nimi i datum v horní části stránky.
