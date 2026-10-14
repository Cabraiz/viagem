/**
 * D-047, the chaveiro objective as the render reads it (card NEW-20261013-ORQ-chaveiro-render): the part of the
 * contract's ObjectiveView (contract/objective.ts, protocol 15) the drawing needs. Route and stops are optional here:
 * the protocol sends them on keyframes and when they change (tracker.ts RouteMemo keeps them), and the sandboxes' fake
 * objective (sandbox-chaveiro.ts) builds this shape directly.
 */
import type {ObjectiveView} from '../../../contract/index.ts';

export {CAR_PARTS,type CarPart,type MotoMode,type ObjectiveStopKind as StopKind} from '../../../contract/index.ts';

export type ChaveiroView=Pick<ObjectiveView,'moto'|'etaS'|'alarmUntil'|'delivery'|'car'|'ended'>&{
  /** The moto's route from its avenue end to the car (simplified polyline), and its stops in route order. */
  route?:readonly ObjectiveView['route'][number][];
  stops?:readonly ObjectiveView['stops'][number][];
};
/** The objective of a run view (RunView.objective); undefined when the run has none. */
export function objectiveOf(view:{objective?:ChaveiroView}|undefined):ChaveiroView|undefined{
  return view?.objective;
}
