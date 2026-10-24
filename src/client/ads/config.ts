/**
 * Ads (NEW-20261023-ORQ-anuncios-h5-games): Google's H5 Games Ads, the AdSense Ad Placement API (adsbygoogle.js +
 * adConfig/adBreak) and nothing else: no other network, no pop-under, no redirect. Only on the site's own hosts; the USER
 * runs the AdSense account and the domain's approval, and gave the ca-pub ID below (docs/anuncios.md). Until the site is
 * approved `test` stays on (data-adbreak-test="on": Google serves test ads, no money, no policy risk).
 *
 * Tiny and free of ad code on purpose: the menu imports it statically and loads ads.ts only when ads can run.
 */
export interface AdsConfig {
  /** Master switch for production builds. */
  enabled:boolean;
  /** The AdSense publisher ID, "ca-pub-…" (not a secret: it goes in the page). Empty = ads never load. */
  client:string;
  /** data-adbreak-test="on": test ads only. Off only once the account and the domain are approved. */
  test:boolean;
  /** Our own floor between two interstitials (also sent as data-ad-frequency-hint). */
  minGapMs:number;
  /**
   * The only hosts ads load on: the domain registered in AdSense. Local previews, the lote's smoke and any mirror make
   * zero calls (adsbygoogle throws TagErrors off an approved site, which the smoke would count as page errors).
   */
  hosts:readonly string[];
}

// Etapa 4: the user's publisher ID (site viagem.cyou, verified by public/ads.txt). `test` stays on until the site is
// approved and H5 Games Ads is enabled for it (docs/anuncios.md).
export const ADS_CONFIG:Readonly<AdsConfig>=Object.freeze({
  enabled:true,
  client:'ca-pub-3277268601080257',
  test:true,
  minGapMs:180_000,
  hosts:Object.freeze(['viagem.cyou','www.viagem.cyou']),
});

/** `?anuncios=teste` turns the test mode on in any build (prints, the user's own check); nothing else does. */
export const ADS_QUERY='anuncios';

export interface AdsEnv {
  /** Vite's import.meta.env.DEV. */
  dev:boolean;
  /** location.search. */
  search:string;
  /** location.hostname. */
  host:string;
}

/** The config ads run with, or undefined when they must not load at all (dev, tests, any host but the site's). */
export function activeAds(env:AdsEnv,config:Readonly<AdsConfig>=ADS_CONFIG):Readonly<AdsConfig>|undefined{
  const forced=new URLSearchParams(env.search).get(ADS_QUERY)==='teste';
  if(forced)return {...config,test:true};
  if(env.dev||!config.enabled||!config.hosts.includes(env.host)||!/^ca-pub-\d{10,}$/.test(config.client))return undefined;
  return config;
}

