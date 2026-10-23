/** Public door of the city render (card cidade-03a). Other code imports from here only. */
export {parseCityAsset,groundAt,heightAt,groundZ,cellOf,GROUND_KINDS} from './asset.ts';
export {cityRenderAsset} from './from-maps.ts';
export type {CityAsset,CityBlock,CityProp,BlockKind,PropKind,GroundKind,CityPointName} from './asset.ts';
export {CityLayer,CITY_GROUND_DEPTH,PINE_TEXTURE,queueCityArt} from './city-layer.ts';
export {buildCityArtPlan,cityArtOptions,CITY_ART_HEIGHT,GROUND_FROM_MANIFEST} from './art-plan.ts';
export type {CityArtPlan,CityArtOptions,CityArtHeight} from './art-plan.ts';
export type {CityFrame,CityLayerOptions} from './city-layer.ts';
export {CITY_PALETTE,OUTSIDE_CITY} from './palette.ts';
export {VIEW_PIVOT,depth,project,unproject} from './projection.ts';
export {makeSampleCity} from './sample.ts';
export {CityLive,decalMeshes,queueLiveArt} from './live/layer.ts';
export type {CityLiveOptions,LiveNest,LivePiece} from './live/layer.ts';
export {artViewOf,decorKey,isDecal,type ArtView,type DecorEntry} from './live/rules.ts';
export {nestArtId,nestsFromStructures} from './live/nests.ts';
export {liveSheets,livePieces,liveTextureKey,type LiveSheet} from './live/art.ts';
export {ViaductLayer,viaductPieces,frontSides,UNDER_ALPHA,UNDER_RADIUS} from './viaduct.ts';
