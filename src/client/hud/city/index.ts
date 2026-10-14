/** City HUD port (NEW-20261012-ORQ-cidade-ux-01): the public API of src/client/hud/city/. */
export {cityHudLayout,bigMinimapSide,bigSquare,minimapRect,heroRect,arrowRailOf,selectorRects,announceSlot,scaled,notched,referenceInput,skillSide,
  MINIMAP_SIDE,BIG_MIN_SIDE,BIG_MAX_SIDE,HERO_SIDE,BIG_HERO_GAP,HUD_FLOOR,ANNOUNCE_GAP,SELECTOR,REFERENCE_CONTROLS,REFERENCE_GEAR,REFERENCE_VIEWPORT,REFERENCE_NOTCH,
  type Orientation,type Insets,type CityControls,type CityLayoutInput,type CityLayout,type BigSideInput} from './layout.ts';
export {clusterEnemies,pickGroupArrows,groupCountText,GROUP_CELL,GROUP_MIN,GROUP_RANGE,GROUP_ARROWS,GROUP_SHOW,GROUP_KEEP_NEAREST,
  type EnemyPoint,type EnemyGroup,type PickOptions} from './clusters.ts';
export {cityMinimapPoint,cityMinimapMarks,cityMinimapLabels,cityFixedLayer,cityRange,innerRadius,groupMarkSize,labelWidth,
  blockReason,tapBlocked,bigShouldClose,cityHudCss,CityMinimap,
  CITY_SIZE,DEFAULT_CITY,CITY_DRAW_ORDER,CITY_MARK_SIZE,BIG_MARK_SCALE,BASE_LOW,LABEL_MIN,LABEL_PX,NORTH_STICKER,
  BIG_OPEN_MS,NEAR_BLOCK,DANGER_NOTICES,BLOCKED_LABEL,NOTICE_BLOCKED_LABEL,
  type CityView,type MouthId,type CityMapInfo,type CityMarkKind,type CityMark,type CityLabel,type CityMinimapInput,
  type NoticeKind,type BlockReason,type BigCloseInput} from './minimap.ts';
export {cityEdgeTargets,relocateCityTargets,layoutCityEdges,mergeGroupTargets,cityMustPoint,cityPlaceRank,besideWindows,cityEdgeRank,WALL_HIT_MS,GROUP_DANGER_HERO,GROUP_DANGER_WALL,MOUTH_GROUP_MERGE,MOUTH_ARROWS,GROUP_EDGE_ARROWS,
  type CityEdgeInput,type CityPerson,type CityEdgeTarget,type CityEdgeArrow,type CityEdgeOptions} from './edges.ts';
export {initialSelector,selectorReducer,selectorView,mountMapSelector,mapChangedNews,downloadText,MAP_OPTIONS,DEFAULT_MAP,PENDING_MS,NEWS_MS,GUEST_HINT_MS,SELECTOR_TEXT,
  type MapId,type SelectorState,type SelectorEvent,type SelectorView,type SelectorSticker,type MapSelectorOptions} from './map-selector.ts';
export {CityRoute,CityObjectiveTracker,cityRouteOf,cityRouteReady,prewarmCityRoute,idleSchedule,objectiveSlot,routeTerrainOf,plazaCells,screenBearing,objectiveMeters,
  MOUTH_HALF_WIDTH,ROUTE_IDLE_TIMEOUT_MS,ROW_WAITS_OBJECTIVE_MS,OBJECTIVE_TEXT,OBJECTIVE_JOKE,
  type CityObjective,type CityObjectiveInput,type RouteTerrain,type IdleSchedule,type ObjectiveSlotInput} from './route.ts';
export {createObjectiveRow,OBJECTIVE_FULL_MS,type ObjectivePart} from './objective.ts';
export {minimapMode,cityAssetOf,cityMapInfo,mouthOfWarning,trackMouths,screenCorners,hornSeconds,BigMapState,MOUTH_IDS,AVENUE_MATCH,GATE_RADIUS,MOUTH_TAIL_TICKS,
  type MinimapMode,type CityAssetLike} from './wiring.ts';
export {barricadeAt,barricadeTarget,mouthOf,BARRICADE_KIND,MOUTH_NAMES,type BarricadeSpot,type CityBocas} from './barricade.ts';
