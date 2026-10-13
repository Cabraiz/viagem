/**
 * The danger edge of a telegraph, painted on any Graphics-like surface (Phaser's Graphics satisfies EdgeGraphics).
 * Pure module (no Phaser), so node tests record the exact strokes: the island and the endless map keep the bands they
 * had (tests/client/telegraph-edge.test.ts compares them with main's code, frozen in a fixture), and the Cidade Nevada
 * gets its own variant (cidade-nevada-arte.md §7): Breu dashed, Laranja Cone solid, Papel dashed in the same phase.
 */
import {CITY_TELEGRAPH_CSS,DASH_MAX_SEGMENTS,OUTLINE_MAX_POINTS,cityEdgeBands,dashSegments,insetLimit,insetPolygon,type CityEdgeBands,type Pt} from './telegraph-shape.ts';

/** Width of the telegraph's outer (light) stroke at UI scale 1, in world px; the red core is half of it. */
export const TELEGRAPH_STROKE=8;
/**
 * Telegraph edge bands in CSS px (onda 4: every band ≥ 1,5 px on screen at the follow camera's 0,583 zoom):
 * Breu 2 | Papel 2 | Cone 3 | Papel 2 | Breu 2, so the full edge is 11 px wide, inside the zone (D-015).
 */
export const TELEGRAPH_BANDS_CSS={breu:2,papel:2,cone:3} as const;
export const TELEGRAPH_EDGE_CSS=2*TELEGRAPH_BANDS_CSS.breu+2*TELEGRAPH_BANDS_CSS.papel+TELEGRAPH_BANDS_CSS.cone;

/** What the edge painter calls (a subset of Phaser.GameObjects.Graphics). */
export interface EdgeGraphics {
  lineStyle(lineWidth:number,color:number,alpha?:number):unknown;
  strokePoints(points:Pt[],closeShape?:boolean,closePath?:boolean,endIndex?:number):unknown;
}
export interface EdgeColors {breu:number;papel:number;cone:number}
export interface EdgeFrame {
  /** Scene px per CSS px at the current zoom. */
  css:number;
  /** HordeRenderer's UI scale (the island's minimum edge width follows it). */
  ui:number;
  /** telegraphBlink 0..1 (1 with reduced motion): the Papel band's alpha follows it. */
  blink:number;
  /** Cidade Nevada variant. */
  city:boolean;
  /** City dash phase in CSS px (motion.ts telegraphDashPhase; 0 with reduced motion). */
  dashPhase:number;
  colors:EdgeColors;
}

/** Breu band alpha of the city edge: the layer that holds ≥ 3:1 on every city ground (contraste.md). */
export const CITY_BREU_ALPHA=1;

export class TelegraphEdge {
  private ptsIn:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private breuPts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private conePts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private papelPts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private segments=new Float64Array(DASH_MAX_SEGMENTS*4);
  private run:Pt[]=Array.from({length:OUTLINE_MAX_POINTS+2},()=>({x:0,y:0}));
  private bands:CityEdgeBands={breu:{d:0,width:0},cone:{d:0,width:0},papel:{d:0,width:0},scale:0};

  /** Strokes the edge of the zone outline pts[0..n) (scene px), inset so its outer edge is the zone's (D-015). */
  draw(g:EdgeGraphics,pts:Pt[],n:number,f:EdgeFrame){
    if(f.city)this.drawCity(g,pts,n,f);
    else this.drawBands(g,pts,n,f);
  }

  /** Island and endless map: Breu | Papel | Cone | Papel | Breu, solid (main's code, unchanged). */
  private drawBands(g:EdgeGraphics,pts:Pt[],n:number,f:EdgeFrame){
    const c=f.colors,css=f.css,w=f.ui,blink=f.blink;
    // Bands in CSS px (never thinner on screen when the camera zooms in); never below the old UI-scaled width either.
    const want=Math.max(TELEGRAPH_EDGE_CSS*css,TELEGRAPH_STROKE*w)/2,half=insetPolygon(pts,n,want,this.ptsIn),k=2*half/TELEGRAPH_EDGE_CSS;
    g.lineStyle(2*half,c.breu,.95);g.strokePoints(this.ptsIn,true,true,n);
    g.lineStyle(k*(2*TELEGRAPH_BANDS_CSS.papel+TELEGRAPH_BANDS_CSS.cone),c.papel,.55+.45*blink);g.strokePoints(this.ptsIn,true,true,n);
    g.lineStyle(k*TELEGRAPH_BANDS_CSS.cone,c.cone,1);g.strokePoints(this.ptsIn,true,true,n);
  }

  /**
   * Cidade Nevada (§7), outside in: Breu 2 CSS px dashed, Laranja Cone 3 solid at 100%, Papel 3 dashed in the same
   * dashes and phase as the Breu (both are dashed from the zone outline, so each Papel dash sits right inside its Breu
   * dash). The Papel keeps the urgency blink, as on the island.
   */
  private drawCity(g:EdgeGraphics,pts:Pt[],n:number,f:EdgeFrame){
    const c=f.colors,b=cityEdgeBands(f.css,insetLimit(pts,n),this.bands);
    if(!(b.scale>0))return;
    insetPolygon(pts,n,b.breu.d,this.breuPts);
    insetPolygon(pts,n,b.cone.d,this.conePts);
    insetPolygon(pts,n,b.papel.d,this.papelPts);
    const k=b.scale,dash=CITY_TELEGRAPH_CSS.dash*k,gap=CITY_TELEGRAPH_CSS.gap*k,phase=f.dashPhase*k;
    g.lineStyle(b.breu.width,c.breu,CITY_BREU_ALPHA);
    this.strokeDashes(g,dashSegments(pts,n,dash,gap,phase,this.segments,this.breuPts));
    g.lineStyle(b.cone.width,c.cone,1);g.strokePoints(this.conePts,true,true,n);
    g.lineStyle(b.papel.width,c.papel,.55+.45*f.blink);
    this.strokeDashes(g,dashSegments(pts,n,dash,gap,phase,this.segments,this.papelPts));
  }

  /**
   * City edge over main's imported dashed border (telegraph-art.ts, drawn as a textured strip): only the outermost
   * Breu 2 CSS px dashed band of drawCity, same dashes and phase, so the zone keeps its city rim around the art.
   */
  drawCityRim(g:EdgeGraphics,pts:Pt[],n:number,f:EdgeFrame){
    const b=cityEdgeBands(f.css,insetLimit(pts,n),this.bands);
    if(!(b.scale>0))return;
    insetPolygon(pts,n,b.breu.d,this.breuPts);
    const k=b.scale;
    g.lineStyle(b.breu.width,f.colors.breu,CITY_BREU_ALPHA);
    this.strokeDashes(g,dashSegments(pts,n,CITY_TELEGRAPH_CSS.dash*k,CITY_TELEGRAPH_CSS.gap*k,f.dashPhase*k,this.segments,this.breuPts));
  }

  /** Strokes the segments, joining the pieces of a dash split at a vertex into one polyline (clean corner joins). */
  private strokeDashes(g:EdgeGraphics,count:number){
    const s=this.segments,run=this.run,cap=run.length;
    let len=0;
    for(let i=0;i<count;i++){
      const o=i*4,x0=s[o],y0=s[o+1];
      const joins=len>0&&run[len-1].x===x0&&run[len-1].y===y0;
      if(!joins||len>=cap){
        if(len>1)g.strokePoints(run,false,false,len);
        len=0;
        if(joins){run[0].x=x0;run[0].y=y0;len=1;}
      }
      if(len===0){run[0].x=x0;run[0].y=y0;len=1;}
      run[len].x=s[o+2];run[len].y=s[o+3];len++;
    }
    if(len>1)g.strokePoints(run,false,false,len);
  }
}
