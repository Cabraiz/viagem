/**
 * The build sites the towers stand on (torres-sim, D-041): E1's pontos-de-obra (src/maps/build-sites.ts), through the
 * maps port. The towers read them only from here.
 * - x/y: a site's centre; a build of size s covers the s·cell square centred on it (footprint), s ≤ the site's maxSize.
 * - The city: 16 sites around the plaza and the Gustavão's rail on the west avenue (railRect). The endless camp: per
 *   seed (cached per terrain object; never assume a count), no rail. The island: none.
 */
export {buildPlanFor,footprint,railRect,rectDistance,validateBuildPlan,type BuildPlan,type BuildSite,type BuildSize,type RailSite,type Rect} from '../../maps/index.ts';
