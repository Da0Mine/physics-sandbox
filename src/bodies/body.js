/* 物体（公式体 / 场源）的创建与销毁 */
import Matter from 'matter-js';
import { ALL, bodies, freeG, freeL } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { hingeConstraintDrop } from '../devices/hinge.js';
import { GD } from '../letters/glyph.js';
import { refresh } from '../letters/layout.js';
import { MW, removeMatterBody } from '../physics/matter.js';
import { B_FIELD_RANGE } from '../render/render.js';
import { ringGo } from '../ui/menu.js';

export const BZ_DIR=1;
export function BODY(x,y){
  var B={x:x,y:y,vx:0,vy:0,th:0,sc:1,glyphs:[],mem:[],massG:null,mass:1,massCap:3,hasG:false,hasA:false,hasV:false,hasR:false,family:0,hw:40,hh:26,dv:0,drag:false,diss:false,orbit:null,pendingOrbit:false,param:{},
    kind:null,fg:null,fieldR:0,Bz:1,qsign:1,Isign:1,fieldState:null,L:48,
    er:null,   // E field: asymmetric 4-edge half-extents {l,r,t,b} — each edge drags independently
    bh:null,   // black-hole state {stage:0 growing/1 alive, r, R, t, age, spin, seed}
    st:{open:null,close:null,plus:null,sq:null,slash:null}};
  bodies.push(B);
  return B;
}
export function spawnField(kind,x,y,svx,svy){
  var B=BODY(x,y);
  B.kind=kind;
  var g=GD(kind);
  g.pop=0;g.body=B;g.inBody=true;
  /* 场源体字形必须自洽：GD() 造出的字形 gx/gy 原为 NaN（spawnField 不写偏移），
   * 而悬停高亮、拖拽落点回算、录屏几何等 syncGlyphs/placeLetter 之外的路径都会读它，导致落点偏 45~58px。
   * 这里把偏移钉成 0、坐标钉成体位置，让字形真正长在场源体上。 */
  g.gx=0;g.gy=0;g.wx=B.x;g.wy=B.y;
  B.fg=g;
  B.glyphs=[g];
  var sp=Math.hypot(svx||0,svy||0);
  var f=sp>20?clamp(1-sp/6000,0.5,1):0;
  if(kind==='B'){B.fieldR=B_FIELD_RANGE;B.Bz=BZ_DIR;B.vx=0;B.vy=0;}
  else if(kind==='E'){B.er={l:160,r:160,t:160,b:160};B.fieldR=320;B.th=0;B.vx=0;B.vy=0;}   // E field: uniform direction, rotatable via th; 4 independent edges
  /* 场（电荷场 q / 电流场 I）没有惯性：与 B/E 一致速度清零，落在松手点。
   * 场源体既无重力也无接触摩擦，若继承松手时的鼠标速度 svx/svy，stepPhysics 的 B.x+=B.vx*dt 会让它一路滑行永不停。 */
  else if(kind==='q'){B.qsign=1;B.vx=0;B.vy=0;}
  else if(kind==='I'){B.Isign=1;B.vx=0;B.vy=0;}
  refresh(B);
  /* 场源体必须落在松手点：refresh(B) 对几何来自字形的体（npts=0）会按字形盒重算 B.x/B.y，
   * 实测偏约 (55,−43)px，连带落点命中判定整体错位。建体后把位置钉回请求点，字形偏移同步归零。 */
  B.x=x;B.y=y;
  if(B.mb){try{Matter.Body.setPosition(B.mb,{x:x,y:y});}catch(e){}}
  if(B.glyphs&&B.glyphs[0]){B.glyphs[0].wx=x;B.glyphs[0].wy=y;B.glyphs[0].gx=0;B.glyphs[0].gy=0;}
  ringGo(x,y);
  return B;
}
/* 把支撑体拖走时唤醒压在它上面的睡眠体：Matter 的睡眠体不会因为脚下支撑消失而自己醒来，
 * 否则会悬在空中（是否睡着有随机性，所以表现为「有概率」）。删除体的同类处理见 killBody。
 * 只唤醒附近的：拖动是交互态，全场唤醒会白费休眠。 */
export function wakeSleepNear(x,y,rad){
  if(!MW||!MW.engine||typeof Matter==='undefined'||!Matter.Sleeping)return 0;
  var bs=Matter.Composite.allBodies(MW.engine.world),n=0;
  for(var i=0;i<bs.length;i++){var b=bs[i];
    if(!b||b.isStatic||!b.isSleeping)continue;
    if(Math.hypot(b.position.x-x,b.position.y-y)<=rad){Matter.Sleeping.set(b,false);n++;}}
  return n;
}
export function killLetter(d){
  d.dead=true;
  var i=freeL.indexOf(d);if(i>=0)freeL.splice(i,1);
  i=freeG.indexOf(d);if(i>=0)freeG.splice(i,1);
  i=ALL.indexOf(d);if(i>=0)ALL.splice(i,1);
  if(d.el&&d.el.parentNode)d.el.parentNode.removeChild(d.el);
}
export function killBody(B){
  /* 铰链被删除时必须摘掉它的真 Constraint，否则会继续把两个宿主隐形地钉在一起。 */
  if(B&&B._hcon)hingeConstraintDrop(B);
  /* 删体 ⇒ 世界里任何引用它的约束都要摘掉。放在删除源头而非 hingeSolve / springSyncEnds：
   宿主被删后 hingeSolve 第一行就返回，springSyncEnds 也可能跑不到，约束会残留并隐形地钉住另一个体。 */
  if(B&&B.mb&&MW&&typeof Matter!=='undefined'&&Matter.Composite&&Matter.Composite.allConstraints){
    var _cs=Matter.Composite.allConstraints(MW.engine.world);
    for(var _ci=0;_ci<_cs.length;_ci++){
      var _c=_cs[_ci];
      if(_c&&(_c.bodyA===B.mb||_c.bodyB===B.mb))Matter.Composite.remove(MW.engine.world,_c);
    }
  }
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  removeMatterBody(B);    // boundaries & rod mirrors live in the Matter world as well
  /* 删掉支撑体后唤醒世界里所有睡眠的非静止体，否则它们会挂在空中
   （实测删平台后方块停在 y=561 且 isSleeping=true，唤醒后落到地面 y=693）。
   只在删体时做一次，不影响每帧开销。 */
  if(MW&&typeof Matter!=='undefined'&&Matter.Composite&&Matter.Composite.allBodies&&Matter.Sleeping){
    var _bs=Matter.Composite.allBodies(MW.engine.world);
    for(var _bi=0;_bi<_bs.length;_bi++){
      var _b=_bs[_bi];
      if(_b&&!_b.isStatic&&_b.isSleeping)Matter.Sleeping.set(_b,false);
    }
  }
  // dissolve any binary-star / orbit link involving B (release partner tangentially)
  if(B.go){
    var gD=B.go, txd=-Math.sin(gD.ang), tyd=Math.cos(gD.ang);
    var P2=gD.bin?gD.by:null;
    if(P2&&bodies.indexOf(P2)>=0){
      P2.vx=txd*gD.w*(gD.rad*(gD.bin?gD.rP:1));P2.vy=tyd*gD.w*(gD.rad*(gD.bin?gD.rP:1));
      P2.goB=null;
    }
    B.go=null;
  }
  if(B.goB&&bodies.indexOf(B.goB)>=0){
    var H=B.goB,gH=H.go;
    if(gH){var txd2=-Math.sin(gH.ang),tyd2=Math.cos(gH.ang);H.vx=txd2*gH.w*(gH.rad*gH.rB);H.vy=tyd2*gH.w*(gH.rad*gH.rB);H.go=null;}
    H.goB=null;
    B.goB=null;
  }
  if(B.bh){B.bh.dead=true;B.bh=null;}   // kill a black hole: the hole itself vanishes
  B.diss=true;
  for(var j=0;j<B.glyphs.length;j++){
    var g=B.glyphs[j];
    if(g.body===B){
      g.body=null;g.inBody=false;
      killLetter(g);
    }
  }
  B.glyphs=[];B.mem=[];
}
