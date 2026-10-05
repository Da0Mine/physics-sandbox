/* mc² 爆炸 */
import Matter from 'matter-js';
import { killBody, killLetter } from '../bodies/body.js';
import { bndPts, mkBoundary } from '../bodies/boundary.js';
import { clamp } from '../core/math.js';
import { bodies, freeL } from '../core/world.js';
import { annihBody } from './blackhole.js';
import { burstParticles, shake, spawnExplosion } from './particles.js';
import { formulas } from './text.js';
import { grab } from '../input/pointer.js';
import { removeMatterBody } from '../physics/matter.js';

// BLAST WAVE (mc² explosion / black-hole detonation):
//  - whole bodies in range  -> shatter into their OWN letters, flung outward (letters
//    inherit the big kick and their speed decays fast — freeLetter damping)
//  - free letters in range  -> vaporized outright
//  - rendered formula shards -> blown away with an outward kick
export function blastAt(cx,cy,R){
  for(var j=bodies.length-1;j>=0;j--){
    var O=bodies[j];
    if(O.bh)continue;
    if(grab.kind==='body'&&grab.obj===O)continue;
    // 画出来的边界（线/图形）走专门的撕裂/汽化（不能被 O.kind 一刀切跳过）：
    // 闭合图形汽化成粒子，开放笔画被撕成 2~3 段继续飞。
    if(O.kind==='W'){
      if(Math.hypot(O.x-cx,O.y-cy)<=R)blastBoundary(O,cx,cy);
      continue;
    }
    if(O.kind==='S'||O.kind==='T'){
      /* 范围内的 S（弹簧/轻绳）/ T（杆）直接销毁，冲击波对它们才有效（下面的 if(O.kind)continue 会跳过所有带 kind 的体）。
       * killBody 负责摘掉引用它的 Matter 约束、铰链 Constraint 并唤醒睡眠体，不会留下幽灵约束把宿主钉住。 */
      if(Math.hypot(O.x-cx,O.y-cy)<=R){
        burstParticles(O.x,O.y,14,0.9);
        if(O.anc){O.anc[0]=null;O.anc[1]=null;}   // 先解绑，免得求解器这一帧还去够已经没了的体
        killBody(O);
      }
      continue;
    }
    if(O.kind)continue;
    var dx=O.x-cx,dy=O.y-cy;
    var d=Math.hypot(dx,dy);
    if(d<=R){
      var dirx=dx/(d||1),diry=dy/(d||1);
      var fl=1200*(1-d/R)+240;
      O.vx+=dirx*fl;O.vy+=diry*fl;
      O.shatterBlast=true;   // stepPhysics converts this into shatter(O,'split')
    }
  }
  for(var fl2=freeL.length-1;fl2>=0;fl2--){
    var L2=freeL[fl2];
    if(L2.state==='grab')continue;
    var ldx=L2.wx-cx,ldy=L2.wy-cy;
    if(Math.hypot(ldx,ldy)<=R){killLetter(L2);}   // killLetter already removes it from freeL
  }
  for(var fx2=formulas.length-1;fx2>=0;fx2--){
    var F=formulas[fx2];
    var fdx=F.x-cx,fdy=F.y-cy;
    var fd=Math.hypot(fdx,fdy);
    if(fd<=R){
      var k2=1-fd/R;
      F.vx+=(fdx/(fd||1))*(900+500*k2);
      F.vy+=(fdy/(fd||1))*(900+500*k2);
    }
  }
}
export function blastBoundary(O,cx,cy){
  // mc² 冲击波对边界的专门处理：闭合图形（矩形/三角形/凹槽）没有字母碎片可炸，直接汽化成粒子（同 annihBody）；
  // 开放笔画被撕成 2~3 段，各自带着向外的冲量继续飞。
  var i0=bodies.indexOf(O);if(i0<0)return;
  if(O.closed||O.pts.length<8){annihBody(O,i0);return;}
  var wp=bndPts(O),nSeg=wp.length-1,nCut=(nSeg>=24)?3:2,c1;
  var cuts=[];
  for(c1=1;c1<=nCut;c1++)cuts.push(Math.round(nSeg*c1/(nCut+1)));
  var prev=0;
  for(c1=0;c1<=nCut;c1++){
    var endP=(c1<nCut)?cuts[c1]:nSeg;
    var seg=wp.slice(prev,endP+1);prev=endP;
    if(seg.length<2)continue;
    var nb=mkBoundary(seg,{shape:'poly',closed:false});
    if(!nb)continue;
    var scx=0,scy=0,q;
    for(q=0;q<seg.length;q++){scx+=seg[q][0];scy+=seg[q][1];}
    scx/=seg.length;scy/=seg.length;
    var ddx=scx-cx,ddy=scy-cy,dd=Math.hypot(ddx,ddy)||1;
    var fl=1200*(1-Math.min(1,dd/320))+240;
    nb.vx=O.vx+ddx/dd*fl;nb.vy=O.vy+ddy/dd*fl;
    if(nb.mb){Matter.Body.setVelocity(nb.mb,{x:nb.vx/60,y:nb.vy/60});Matter.Sleeping.set(nb.mb,false);}
  }
  removeMatterBody(O);
  bodies.splice(i0,1);
  burstParticles(O.x,O.y,10,0.8);
}
export function explodeBody(B){
  var cx=B.x,cy=B.y;
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  spawnExplosion(cx,cy);
  for(var j=0;j<B.glyphs.length;j++){var g=B.glyphs[j];if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}}
  B.glyphs=[];B.mem=[];
  blastAt(cx,cy,300);   // shockwave: shatter nearby wholes, vaporize nearby loose letters
  shake(16,0.55);
}
export function stepExplode(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B.exploding)continue;
    B.explT+=dt;
    var T=0.9;
    var k=clamp(B.explT/T,0,1);
    B.infl=1+0.7*k;
    B.wob=Math.sin(B.explT*38)*0.05*k;
    // NOTE: velocity is NOT zeroed here — the inflating mc² keeps moving and can be
    // pushed/gravitated like any other body (stepPhysics handles it).
    if(B.explT>=T){explodeBody(B);break;}
  }
}
