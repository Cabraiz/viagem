/**
 * ?sandbox=voce — the "você" marker (ring with beak, sticker contour, "Você" arrow, mini health bar) over flat samples
 * of every ground it must read on: today's dark sea and grass, and the light tropical scene of D-022 (water, grass,
 * sand), plus the lilac horde and the gosma. A table measures each ring layer against each ground (WCAG contrast):
 * at least one layer must pass 3:1 everywhere (design onda 3 §0, checklist A8). Dev page; ground hexes are samples.
 * Query: hero (class id, default sensei), facing (degrees, default 90 = down), low=1 (health at 20%).
 */
import Phaser from 'phaser';
import {YouMarkers} from './render/you.ts';
import {token} from '../ui/tokens.ts';

const GROUNDS:{name:string;hex:string}[]=[
  {name:'Mar escuro (hoje)',hex:'#142F2D'},{name:'Grama escura (hoje)',hex:'#4E6B47'},
  {name:'Água clara (D-022)',hex:'#8DCECC'},{name:'Grama clara (D-022)',hex:'#7CBF6A'},{name:'Areia (D-022)',hex:'#E8D49A'},
  {name:'Horda lilás',hex:'#976C97'},{name:'Gosma',hex:'#CF94BC'},
];
const LAYERS:{name:string;token:string}[]=[{name:'Papel',token:'--c-papel'},{name:'Lilás (você)',token:'--c-voce'},{name:'Breu',token:'--c-breu'}];

const lin=(c:number)=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;};
const lum=(hex:string)=>{const n=parseInt(hex.replace('#',''),16);return .2126*lin(n>>16&255)+.7152*lin(n>>8&255)+.0722*lin(n&255);};
export const contrast=(a:string,b:string)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

const params=new URLSearchParams(location.search);
const hero=params.get('hero')||'sensei',facing=Number(params.get('facing')??90)*Math.PI/180,low=params.get('low')==='1';

class VoceScene extends Phaser.Scene{
  private you:YouMarkers[]=[];private sprites:Phaser.GameObjects.Sprite[]=[];
  constructor(){super('voce');}
  preload(){this.load.image('hero',`/art/portraits/${hero}.webp`);}
  create(){
    const w=this.scale.width,h=this.scale.height,cols=GROUNDS.length>4&&w>h?GROUNDS.length:Math.ceil(GROUNDS.length/2),rows=Math.ceil(GROUNDS.length/cols);
    const cw=w/cols,ch=h*.62/rows;
    GROUNDS.forEach((g,i)=>{
      const x=(i%cols)*cw,y=Math.floor(i/cols)*ch;
      this.add.rectangle(x,y,cw,ch,parseInt(g.hex.slice(1),16)).setOrigin(0,0);
      const sprite=this.add.sprite(x+cw/2,y+ch*.62,'hero').setOrigin(.5,.88).setDisplaySize(44,44).setDepth(96500);
      this.sprites.push(sprite);
      const you=new YouMarkers(this,true);you.showArrow(this.time.now);this.you.push(you);
    });
  }
  update(time:number){
    // The arrow is kept on (it normally shows for 2 s) so every sample shows the whole marker.
    this.sprites.forEach((sprite,i)=>{this.you[i].showArrow(time);this.you[i].update(time,1,[{id:'self',sprite,self:true,feet:{x:sprite.x,y:sprite.y},covered:false,hp:low?20:70,maxHp:100,downed:false,facing}]);});
  }
}

const root=document.createElement('div');
root.style.cssText='position:fixed;inset:0;z-index:var(--z-dialogo);background:var(--c-breu)';
document.body.append(root);
const stage=document.createElement('div');stage.style.cssText='position:absolute;inset:0';root.append(stage);
new Phaser.Game({type:Phaser.WEBGL,parent:stage,width:innerWidth,height:innerHeight,backgroundColor:token('--c-breu'),banner:false,audio:{noAudio:true},scene:[VoceScene]});

// Measurement table (A8): every ring layer against every ground; ✓ when the best layer reaches 3:1.
const table=document.createElement('table');
table.style.cssText='position:absolute;left:8px;right:8px;bottom:8px;border-collapse:collapse;background:var(--c-papel);color:var(--c-breu);font:700 13px/1.25 var(--f-sistema);border:2px solid var(--c-breu)';
const head=document.createElement('tr');
for(const label of ['Fundo',...LAYERS.map(l=>l.name),'Melhor'])head.append(Object.assign(document.createElement('th'),{textContent:label}));
table.append(head);
const results:{ground:string;ratios:number[];best:number}[]=[];
for(const g of GROUNDS){
  const ratios=LAYERS.map(l=>contrast(getComputedStyle(document.documentElement).getPropertyValue(l.token).trim()||'#000000',g.hex));
  const best=Math.max(...ratios);results.push({ground:g.name,ratios,best});
  const row=document.createElement('tr');
  for(const text of [g.name,...ratios.map(r=>r.toFixed(1)),`${best>=3?'✓':'✗'} ${best.toFixed(1)}`])row.append(Object.assign(document.createElement('td'),{textContent:text}));
  table.append(row);
}
for(const cell of table.querySelectorAll<HTMLElement>('th,td'))cell.style.cssText='padding:2px 5px;border:1px solid var(--c-breu);text-align:left';
root.append(table);
(window as unknown as {__voce?:unknown}).__voce={results};
