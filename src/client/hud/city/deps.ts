/**
 * The only door of the city HUD (card NEW-20261012-ORQ-cidade-ux-01) to the rest of the tree: everything it reuses from
 * the island HUD comes through here, so the sector migration (design/arquitetura-setores.md) edits this file alone.
 */
export {computeZones,auditBoxes,crosses,gap,inflate,union,orientationOf,right,bottom,THUMB_GAP,HERO_MARGIN,EDGE_COLUMN,MIN_PLAY_SIDE,
  type Rect,type ZoneInput,type ScreenZones,type AuditBox,type AuditResult} from '../zones.ts';
export {layoutEdges,pointedTargets,arrowHalf,distanceText,MAX_ARROWS,MERGE_PX,RIM_PAD,TAG_ROOM,NAME_ROOM,
  type EdgeTarget,type EdgeArrow,type EdgeKind,type EdgeOptions} from '../edges.ts';
export {minimapPoint} from '../minimap.ts';
export {rotateVector} from '../../projection.ts';
export {railName} from '../../render/map-label-rules.ts';
export {icon,type IconName} from '../../ui/icon.ts';
export {DEFAULT_MAP as PROTOCOL_DEFAULT_MAP,type MapId} from '../../../protocol/index.ts';
