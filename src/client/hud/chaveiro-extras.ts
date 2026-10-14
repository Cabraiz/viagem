/**
 * D-047 (card chaveiro-render): the chaveiro objective on the WC3 minimap (wc-minimap, Executor-1), as its extras:
 * the route still ahead of the moto (a dashed line under the marks), the next delivery, the car at the plaza and the
 * moto (Cone while it needs the team: dead or fallen). Nothing once the run ended. Pure.
 */
import type {MmExtra} from './wc-minimap/minimap.ts';
import {motoNeedsTeam,routeAhead} from '../render/chaveiro/rules.ts';
import type {ChaveiroView} from '../render/chaveiro/view.ts';

/** Token colours (ui/tokens.css): Papel for the route, the delivery and the moto, Cone when it needs the team. */
export const CHAVEIRO_MM_COLORS=Object.freeze({route:'#EEDDB8',delivery:'#EEDDB8',moto:'#EEDDB8',motoHelp:'#FF7A1F',car:'#7FA7B5'});

export function chaveiroExtras(view:ChaveiroView|undefined):MmExtra[]{
  if(!view||view.ended)return [];
  const c=CHAVEIRO_MM_COLORS,out:MmExtra[]=[];
  if(view.route&&view.route.length>1){
    const points=routeAhead(view.route,view.moto);
    if(points.length>1)out.push({kind:'rota',x:view.moto.x,y:view.moto.y,color:c.route,points});
  }
  if(view.delivery)out.push({kind:'entrega',x:view.delivery.x,y:view.delivery.y,color:c.delivery});
  out.push({kind:'carro',x:view.car.x,y:view.car.y,color:c.car});
  out.push({kind:'moto',x:view.moto.x,y:view.moto.y,color:motoNeedsTeam(view.moto.mode)?c.motoHelp:c.moto});
  return out;
}
