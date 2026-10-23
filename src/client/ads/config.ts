/**
 * Ads (NEW-20261023-ORQ-anuncios-h5-games): Google's H5 Games Ads, the AdSense Ad Placement API (adsbygoogle.js +
 * adConfig/adBreak) and nothing else: no other network, no pop-under, no redirect. Off by default; the USER creates the
 * AdSense account, gets the domain approved and pastes the ca-pub ID here (docs/anuncios.md). Until then `test` stays on
 * (data-adbreak-test="on": Google serves test ads, no money, no policy risk).
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
}

export const ADS_CONFIG:Readonly<AdsConfig>=Object.freeze({
  enabled:false,
  client:'',
  test:true,
  minGapMs:180_000,
});

/** `?anuncios=teste` turns the test mode on in any build (prints, the user's own check); nothing else does. */
export const ADS_QUERY='anuncios';

export interface AdsEnv {
  /** Vite's import.meta.env.DEV. */
  dev:boolean;
  /** location.search. */
  search:string;
}

/** The config ads run with, or undefined when they must not load at all (the default in dev and in tests). */
export function activeAds(env:AdsEnv,config:Readonly<AdsConfig>=ADS_CONFIG):Readonly<AdsConfig>|undefined{
  const forced=new URLSearchParams(env.search).get(ADS_QUERY)==='teste';
  if(forced)return {...config,test:true};
  if(env.dev||!config.enabled||!/^ca-pub-\d{10,}$/.test(config.client))return undefined;
  return config;
}

