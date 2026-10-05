/* 黑洞与黑洞终章 */
import Matter from 'matter-js';
import { app } from '../state.js';
import { killBody, killLetter } from '../bodies/body.js';
import { DD, bodies, formulas, freeL, panel, particles, trash } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { blastAt } from './explosion.js';
import { burstParticles, shake, spawnExplosion } from './particles.js';
import { killFormula } from './text.js';
import { grab, trashDrag } from '../input/pointer.js';
import { GD } from '../letters/glyph.js';
import { place } from '../letters/layout.js';
import { dockLetter, freeLetter } from '../letters/panel.js';
import { removeMatterBody } from '../physics/matter.js';
import { BH_REACH, cvx } from '../render/render.js';
import { ringGo } from '../ui/menu.js';

// ================= BLACK HOLE (2GM/c² -> collapse) =================
export const BH_MAXR=105;
/* 黑洞出现 BH_FORCE_AGE 秒后强制清场：场上剩余物体直接碎裂为粒子被吸入。
 * stage-1 的吞噬有三重门槛：d>BH_REACH 直接跳过；吸力按 1/d² 衰减，远处几乎不动；
 * fixed 锚死或装配体被杆约束连成整体时等效加速度被稀释（补偿上限 8 倍，连着固定点拉不动是正确物理）
 * ⇒ 连接体/远处物体可能永远进不了视界，需要这个兜底。 */
export const BH_FORCE_AGE=15;
export function stepBlackHole(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B.bh)continue;
    var bh=B.bh;
    bh.age+=dt;bh.spin+=dt*(0.5+bh.r/60);
    if(bh.stage===0){
      // stage 0 — collapse: horizon grows outward while the formula's letters
      // (2, G, M, c, ²) spiral inward and get sucked through (alpha -> 0).
      bh.t+=dt;
      var k=bh.t/0.8;
      if(k>=1){bh.stage=1;bh.r=BH_MAXR;continue;}
      var ek=1-Math.pow(1-clamp(k,0,1),3);
      bh.r=BH_MAXR*ek*0.5;
      var s=clamp(1-k*1.4,0,1);
      B.infl=s;B.wob=Math.sin(bh.t*30)*0.3*k;
      bh.fade=(k>0.7)?clamp(1-(k-0.7)*4,0,1):1;   // letters sink into the horizon
      if(k>=0.92){
        // the letters are consumed by the horizon
        B.glyphs.slice().forEach(function(g){if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}});
        B.glyphs=[];
      }
      continue;
    }
    // ---- stage 1 — alive: devour EVERYTHING on screen (whole-screen accretion) ----
    if(B.vx||B.vy){B.vx=0;B.vy=0;}   // the hole itself is immovable
    if(app.BH_FINALE&&app.BH_FINALE.hole===B)continue;   // finale drives the hole visuals now (suck/shrink)
    if(grab.kind==='body'&&grab.obj===B)continue;   // paused while the hole is being dragged
    /* 到时清场：不看距离、质量、是否 fixed（黑洞面前固定不住），逐个爆粒子并走既有的湮灭/清场通道。
     * 只做一次（bh.forced），否则每帧重扫会连刚生成的粒子一起爆。被指针抓着的体跳过。 */
    if(!bh.forced&&bh.age>BH_FORCE_AGE){
      bh.forced=1;
      for(var fj=bodies.length-1;fj>=0;fj--){
        var OF=bodies[fj];
        if(!OF||OF===B||OF.bh||OF.dead)continue;
        if(grab.kind==='body'&&grab.obj===OF)continue;
        var ofIsField=(OF.kind==='q'||OF.kind==='I'||OF.kind==='B'||OF.kind==='E');
        try{
          burstParticles(OF.x,OF.y,10,1);
          if(ofIsField)killFieldBody(OF,fj); else annihBody(OF,fj);
        }catch(e3){}
      }
      for(var fl2=freeL.length-1;fl2>=0;fl2--){
        var LF=freeL[fl2];
        if(!LF||LF.dead)continue;
        try{burstParticles(LF.wx||LF.x||0,LF.wy||LF.y||0,4,0.6);}catch(e4){}
        LF.body=null;LF.inBody=false;
        try{killLetter(LF);}catch(e5){}
      }
    }
    // BH reach: full-screen diagonal + margin. The pull tapers linearly to 0 at the edge so
  // the influence FEELS whole-screen but fades out at the screen boundary — a corner is no
  // stronger than another, and at the very rim the pull is exactly zero.
  var reach=BH_REACH;
    /* 吸力加速度与质量无关，但杆约束把互连物体连成整体，有效加速度被稀释 m_self/M_total 倍。
     * 按「装配体总质量 / 自质量」放大吸力（BFS 连通分量，上限 8 倍防爆炸）；
     * 连着固定点的装配体拉不动是正确物理（fixed 锚死），不在补偿之列。 */
    var _asmMult={};
    (function(){
      var seen={};
      for(var qi=0;qi<bodies.length;qi++){
        var Q0=bodies[qi];
        if(seen[Q0.i]!=null)continue;
        var comp=[],stk=[Q0];seen[Q0.i]=1;
        while(stk.length){
          var N=stk.pop();comp.push(N);
          for(var r2=0;r2<bodies.length;r2++){
            var RR2=bodies[r2];
            if(RR2.kind!=='T'||RR2.dead||!RR2.anc)continue;
            var aa2=RR2.anc[0],ab2=RR2.anc[1];
            if(!(aa2&&ab2&&aa2.B&&ab2.B))continue;
            var other=null;
            if(aa2.B===N&&!ab2.B.dead&&!seen[ab2.B.i])other=ab2.B;
            if(ab2.B===N&&!aa2.B.dead&&!seen[aa2.B.i])other=aa2.B;
            if(other){seen[other.i]=1;stk.push(other);}
          }
        }
        var Mtot=0;
        for(var ci=0;ci<comp.length;ci++)Mtot+=((comp[ci].mb&&!comp[ci].mb.isStatic)?comp[ci].mb.mass:1)||1;
        for(ci=0;ci<comp.length;ci++){
          var mm2=((comp[ci].mb&&!comp[ci].mb.isStatic)?comp[ci].mb.mass:1)||1;
          _asmMult[comp[ci].i]=Math.max(1,Math.min(8,Mtot/mm2));
        }
      }
    })();
    for(var j=bodies.length-1;j>=0;j--){
      var O=bodies[j];
      if(O===B||O.bh)continue;
      if(grab.kind==='body'&&grab.obj===O)continue;
      var dx=B.x-O.x,dy=B.y-O.y;
      var d=Math.hypot(dx,dy)||1;
      if(d>reach){O.bhFade=null;O.bhShed=0;continue;}
      // spiral accretion, closer = much stronger. The pull has a radial part and a
      // tangential part (spiral), and ACCRETION DRAG — velocity-proportional damping,
      // a true energy sink that is stronger the closer the body is. No stable orbit
      // can survive the drag: everything spirals in and gets swallowed.
      // Field sources (B/E) and rods ARE devoured too — they are objects on the canvas.
      var fall=(O.kind==='q'||O.kind==='I');
      var src=(O.kind==='B'||O.kind==='E');
      var taper=clamp(1-d/reach,0,1);
      var inv=1/Math.max(d,20);
      var ux2=dx*inv,uy2=dy*inv;       // toward the hole
      var tx2=-uy2,ty2=ux2;            // tangential (spiral)
      var pull=(fall?1600:(src?5000:20000))*bh.r/(d*d)*(dt*60)*taper;
      var _am=_asmMult[O.i]||1;
      O.vx+=ux2*pull*_am;O.vy+=uy2*pull*_am;
      O.vx+=tx2*pull*0.5*_am;O.vy+=ty2*pull*0.5*_am;
      var drg=Math.pow(0.25,dt*1.6*Math.min(1,bh.r/Math.max(d,30)));
      O.vx*=drg;O.vy*=drg;
      // B/E sources and rods are skipped by stepPhysics (static), so integrate them here.
      // W 边界是 Matter 刚体，stepMatter 每帧用 mb.position 覆写 B.x/B.y，直接手推坐标会被吞掉，
      // 必须把速度注入 Matter 本体；固定（static）的边界用 setPosition 硬拽（黑洞面前固定不住）。
      if(O.kind==='W'&&O.mb){
        if(O.fixed){Matter.Body.setPosition(O.mb,{x:O.x+O.vx*dt,y:O.y+O.vy*dt});}
        else{Matter.Body.setVelocity(O.mb,{x:O.vx/60,y:O.vy/60});}
        Matter.Sleeping.set(O.mb,false);
      }
      else if(src||O.kind==='T'){O.x+=O.vx*dt;O.y+=O.vy*dt;}
      // progressive disintegration: the nearer it gets, the faster it sheds particles and
      // the more it has eroded away — it visibly comes apart on the way in. The falloff is
      // long enough (~280px) that disintegration starts far from the horizon so the trail
      // is clearly visible.
      var near=clamp(1-(d-bh.r)/280,0,1);
      if(near>0){
        O.bhShed=(O.bhShed||0)+dt;
        var iv=0.06-0.045*near;
        if(O.bhShed>=iv){
          O.bhShed=0;
          burstParticles(O.x+(Math.random()*22-11),O.y+(Math.random()*22-11),2+Math.round(near*3),0.45);
        }
        O.bhFade=clamp(1-near*1.1,0.06,1);
      }
      if(d<bh.r+16){   // swallowed
        if(fall||src){
          burstParticles(O.x,O.y,12,1);
          killFieldBody(O,j);
        }else{
          annihBody(O,j);   // particleize the whole into the hole
        }
      }
    }
    for(var fl=freeL.length-1;fl>=0;fl--){
      var L2=freeL[fl];
      if(L2.state==='grab')continue;
      var fdx=B.x-L2.wx,fdy=B.y-L2.wy;
      var fd=Math.hypot(fdx,fdy)||1;
      if(fd>reach)continue;
      var fux=fdx/fd,fuy=fdy/fd;
      var ftap=clamp(1-fd/reach,0,1);
      var fpull=(26000*bh.r)/(fd*fd)*(dt*60)*ftap;
      L2.vx+=fux*fpull*2.2;L2.vy+=fuy*fpull*2.2;
      L2.vx+=(-fuy)*fpull*0.5;L2.vy+=fux*fpull*0.5;
      // progressive disintegration: the letter visibly flicks apart and fades as it falls
      var fnear=clamp(1-(fd-bh.r)/280,0,1);
      if(fnear>0){
        L2.bhShed=(L2.bhShed||0)+dt;
        var fiv=0.06-0.045*fnear;
        if(L2.bhShed>=fiv){
          L2.bhShed=0;
          burstParticles(L2.wx+(Math.random()*10-5),L2.wy+(Math.random()*10-5),1+Math.round(fnear*2),0.4);
        }
        L2.fade=clamp(1-fnear*1.0,0.1,1);
      }
      if(fd<bh.r+8){killLetter(L2);burstParticles(B.x,B.y,14,1);}   // killLetter removes it from freeL
    }
    // formulas (rendered collision shards) also get pulled in and consumed
    for(var fx=formulas.length-1;fx>=0;fx--){
      var F=formulas[fx];
      var fx2=B.x-F.x,fy2=B.y-F.y;
      var fd2=Math.hypot(fx2,fy2)||1;
      if(fd2>reach)continue;
      var fux2=fx2/fd2,fuy2=fy2/fd2;
      var ftap2=clamp(1-fd2/reach,0,1);
      var fp=(20000*bh.r)/(fd2*fd2)*(dt*60)*ftap2;
      F.vx+=fux2*fp*2.2-fuy2*fp*0.5;F.vy+=fuy2*fp*2.2+fux2*fp*0.5;
      if(fd2<bh.r+10){killFormula(F);formulas.splice(fx,1);burstParticles(B.x,B.y,14,1);}
    }
    // the debris itself falls in: particles spiral into the hole and wink out at the horizon
    for(var pi=particles.length-1;pi>=0;pi--){
      var p=particles[pi];
      var pdx=B.x-p.x,pdy=B.y-p.y;
      var pd=Math.hypot(pdx,pdy)||1;
      if(pd>reach)continue;
      var pux=pdx/pd,puy=pdy/pd;
      var ptap=clamp(1-pd/reach,0,1);
      var ppull=(30000*bh.r)/(pd*pd)*(dt*60)*ptap;
      p.vx+=pux*ppull*1.6-puy*ppull*0.5;
      p.vy+=puy*ppull*1.6+pux*ppull*0.5;
      if(pd<bh.r*0.75){particles.splice(pi,1);}   // crossed the horizon
    }
    // the top-right panel gets devoured too — letters detach and fly into the hole, then the
    // bare panel itself breaks apart in chunks nearest the hole first
    stepBlackHolePanel(B,bh,dt);
    // slow breathing of the horizon
    bh.r=BH_MAXR+Math.sin(bh.age*2.2)*3;
  }
}
// the hole slowly pulls docked letters out of the top-right panel, one at a time. Each
// letter that is taken leaves an EMPTY slot in the tray frame — the frame itself never
// shrinks or breaks apart (its 4x4 grid rows are fixed in CSS, and each letter is pinned
// to its own cell by sortPanel/dockSlotEl).
export function ensurePanelEat(bh){
  if(bh.panelEat)return;
  bh.panelEat={t:0.45+Math.random()*0.35};
}
export function stepBlackHolePanel(B,bh,dt){
  ensurePanelEat(bh);
  var pe=bh.panelEat;
  if(!pe)return;
  pe.t-=dt;
  if(pe.t>0)return;
  var pool=[];
  var chars=[].slice.call(panel.querySelectorAll('.char'));
  for(var i=0;i<chars.length;i++){
    var r=chars[i].getBoundingClientRect();
    var ref=chars[i]._letterRef;
    if(ref&&ref.state==='dock'&&ref.el===chars[i]){
      pool.push({cx:r.x+r.width/2,cy:r.y+r.height/2,d:ref});
    }
  }
  if(!pool.length)return;   // tray fully emptied — the hole moves on to its finale
  // RANDOM batch: sometimes a single letter slips away, sometimes two or three go at once,
  // always picked at random across the whole tray (no fixed near-to-far order).
  var rr=Math.random();
  var count=rr<0.38?1:rr<0.68?2:rr<0.88?3:4;
  if(count>pool.length)count=pool.length;
  for(var c=0;c<count;c++){
    var idx=Math.floor(Math.random()*pool.length);
    var cell=pool[idx];
    pool.splice(idx,1);
    if(!cell||!cell.d)continue;
    var dx=B.x-cell.cx,dy=B.y-cell.cy,dd=Math.hypot(dx,dy)||1;
    var sp=180+Math.random()*300;
    // jitter so a multi-letter batch fans out instead of overlapping
    var jx=(Math.random()-0.5)*130,jy=(Math.random()-0.5)*130;
    freeLetter(cell.d,cell.cx,cell.cy,(dx/dd)*sp+jx,(dy/dd)*sp+jy,1);
  }
  pe.t=0.5+Math.random()*1.15;   // irregular pause between events
}
// k / x 也要能被黑洞吃掉（和面板里其它符号一视同仁）
export const BH_CHARS=['m','M','g','a','v','r','½','μ','c','G','t','B','E','q','I','k','x'];
export function finaleSlot(i,pr){
  var col=i%4,row=Math.floor(i/4);
  return {x:pr.left+10+col*50+22,y:pr.top+10+row*50+22};
}
export function resetTrashPos(){
  trash.style.left='';trash.style.top='';trash.style.transform='';
  trash.style.right='24px';trash.style.bottom='24px';
}
export function trashTo(px,py){
  trash.style.right='auto';trash.style.bottom='auto';
  trash.style.left=px+'px';trash.style.top=py+'px';
}
export function trashCenter(){
  var r=trash.getBoundingClientRect();
  return {x:r.left+r.width/2,y:r.top+r.height/2};
}
export function maybeStartFinale(){
  /* BH_FINALE 自愈：finale 中途被打断或黑洞被清屏移除时，残留的 BH_FINALE 会让 if(BH_FINALE)return 永久挡住后续黑洞；
   * 宿主已死/不在场/超时（25s）则清掉再继续。 */
  if(app.BH_FINALE){
    var _fh=app.BH_FINALE.hole;
    var _stale=(!_fh||_fh.dead||bodies.indexOf(_fh)<0||
                (app.BH_FINALE.t0&&performance.now()-app.BH_FINALE.t0>25000));
    if(_stale)app.BH_FINALE=null;else return;
  }
  if(grab.kind||trashDrag.active)return;
  var hole=null,holes=[];
  for(var i=0;i<bodies.length;i++){
    var Bx=bodies[i];
    if(Bx.bh&&Bx.bh.stage===1){if(!hole)hole=Bx;holes.push(Bx);}
  }
  if(!hole)return;
  var otherBodies=0;
  for(i=0;i<bodies.length;i++){var By=bodies[i];if(!(By.bh&&By.bh.stage===1))otherBodies++;}
  /* 不做两黑洞合并：出生处已门控同时只能有一个黑洞；万一出现两个也各自独立存在。 */
  if(holes.length>=2)return;
  var docked=false;
  var chars=panel.querySelectorAll('.char');
  for(var j=0;j<chars.length;j++){
    var ref=chars[j]._letterRef;
    if(ref&&ref.state==='dock'){docked=true;break;}
  }
  if(docked)return;                 // tray letters still remain to be eaten
  if(bodies.length>1)return;        // other bodies still being devoured
  if(freeL.length||formulas.length)return;   // debris still in flight
  // everything is consumed — begin the finale
  var bin=trash.getBoundingClientRect();
  hole.bh.finalizing=true;
  app.BH_FINALE={ph:'pull',t:0,hole:hole,
    hx:hole.x,hy:hole.y,
    bl:bin.left,bt:bin.top,bw:bin.width,bhh:bin.height,
    pullD:1.05,suckD:0.55,shakeD:0.85,letters:[],removed:false};
}
export function suckPuff(x,y,tx,ty){
  for(var n=0;n<3;n++){
    var a=Math.random()*6.2832;
    particles.push({x:x+(Math.random()*10-5),y:y+(Math.random()*10-5),
      vx:Math.cos(a)*60+(tx-x)*1.6,vy:Math.sin(a)*60+(ty-y)*1.6,
      age:0,life:0.28+Math.random()*0.22,r:1+Math.random()*1.4,alpha:1});
  }
}
export function finaleBurst(){
  var F=app.BH_FINALE;
  var pr=panel.getBoundingClientRect();
  var names=['mO','M2O','gO','aO','vO','rO','halfO','muO','cO','GO','tO','BO','EO','qO','IO'];
  var refs=[app.mO,app.M2O,app.gO,app.aO,app.vO,app.rO,app.halfO,app.muO,app.cO,app.GO,app.tO,app.BO,app.EO,app.qO,app.IO];
  for(var i=0;i<BH_CHARS.length;i++){
    var old=refs[i];
    if(old&&old.el&&old.el.parentNode)old.el.parentNode.removeChild(old.el);
    var nd=GD(BH_CHARS[i]);
    nd.cat=1;nd.pop=0;
    switch(names[i]){
      case 'mO':app.mO=nd;break;case 'M2O':app.M2O=nd;break;case 'gO':app.gO=nd;break;case 'aO':app.aO=nd;break;
      case 'vO':app.vO=nd;break;case 'rO':app.rO=nd;break;case 'halfO':app.halfO=nd;break;case 'muO':app.muO=nd;break;
      case 'cO':app.cO=nd;break;case 'GO':app.GO=nd;break;case 'tO':app.tO=nd;break;case 'BO':app.BO=nd;break;
      case 'EO':app.EO=nd;break;case 'qO':app.qO=nd;break;case 'IO':app.IO=nd;break;
    }
    nd.el.style.fontSize='34px';
    nd.el.style.pointerEvents='none';
    DD.body.appendChild(nd.el);
    var a=Math.random()*6.2832,sp=240+Math.random()*360;
    var tgt=finaleSlot(i,pr);
    F.letters.push({d:nd,el:nd.el,x:F.bx||F.hx,y:F.by||F.hy,
                    vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,tx:tgt.x,ty:tgt.y,arr:false});
    place(nd,F.hx,F.hy,0,1,true);
  }
  burstParticles(F.hx,F.hy,24,1.5);
  ringGo(F.hx,F.hy);
}
export function stepFinale(dt){
  if(!app.BH_FINALE){maybeStartFinale();return;}
  var F=app.BH_FINALE;
  F.t+=dt;
  if(F.ph==='pull'){
    // the hole drags the bin across the screen toward itself (accelerating)
    var e=Math.min(1,F.t/F.pullD);e=e*e;
    var bc=trashCenter();
    var sx=F.bl+F.bw/2,sy=F.bt+F.bhh/2;
    var cx=sx+(F.hx-sx)*e,cy=sy+(F.hy-sy)*e;
    trashTo(cx-F.bw/2,cy-F.bhh/2);
    if(F.t>=F.pullD){
      F.ph='suck';F.t=0;
    }
  }else if(F.ph==='suck'){
    // the hole shrinks and streams into the bin, then vanishes inside it
    /* e2 的 NaN 防护：F.t 被污染成 NaN 时会把 bh.r 写成 NaN，缩洞动画整个失效。 */
    var e2=Math.min(1,Math.max(0,(isFinite(F.t/F.suckD)?F.t/F.suckD:0)));
    var h=F.hole;
    if(!isFinite(F.t))F.t=0;
    if(h.bh)h.bh.r=Math.max(1.5,BH_MAXR*(1-e2));
    if(Math.random()<0.8)suckPuff(h.x,h.y,F.hx,F.hy);
    if(F.t>=F.suckD){
      var hx=h.x,hy=h.y;
      var bi=bodies.indexOf(h);if(bi>=0)bodies.splice(bi,1);
      if(h.bh){h.bh.dead=true;}
      F.removed=true;
      burstParticles(hx,hy,20,1.2);
      shake(10,0.35);
      F.ph='shake';F.t=0;
    }
  }else if(F.ph==='shake'){
    // two diminishing bounces — something inside is trying to break out
    var p=Math.min(1,F.t/F.shakeD);
    var cyc=p*2.2,n2=Math.floor(cyc),f2=cyc-n2;
    var amp=(1-p)*11;
    var ox=(n2%2===0?1:-1)*Math.sin(f2*Math.PI)*amp;
    var oy=Math.sin(f2*Math.PI*1.7)*2.4*(1-p);
    trash.style.transform='translate('+ox.toFixed(1)+'px,'+oy.toFixed(1)+'px)';
    if(F.t>=F.shakeD){
      F.ph='fly';F.t=0;
      finaleBurst();
    }
  }else if(F.ph==='fly'){
    // letters burst out of the bin and glide back into their tray slots
    var any=false;
    for(var i=0;i<F.letters.length;i++){
      var L=F.letters[i];
      if(L.arr)continue;
      any=true;
      L.vx+=(L.tx-L.x)*24*dt;L.vy+=(L.ty-L.y)*24*dt;
      L.vx*=Math.pow(0.86,dt*60);L.vy*=Math.pow(0.86,dt*60);
      var sp2=Math.hypot(L.vx,L.vy);
      if(sp2>1500){L.vx*=1500/sp2;L.vy*=1500/sp2;}
      L.x+=L.vx*dt;L.y+=L.vy*dt;
      L.el.style.left=(L.x-L.el.offsetWidth/2)+'px';
      L.el.style.top=(L.y-L.el.offsetHeight/2)+'px';
      var d2=Math.hypot(L.tx-L.x,L.ty-L.y);
      if(d2<4&&sp2<140){
        L.arr=true;L.el.style.pointerEvents='';
        dockLetter(L.d);
      }
    }
    // the bin flies home while the letters do
    var e4=Math.min(1,F.t/1.1);
    var sc=trashCenter();
    var hx0=F.hx,hy0=F.hy;
    var hcx=F.bl+F.bw/2,hcy=F.bt+F.bhh/2;
    var cx2=hx0+(hcx-hx0)*e4,cy2=hy0+(hcy-hy0)*e4;
    trashTo(cx2-F.bw/2,cy2-F.bhh/2);
    var arrN=0;for(var k=0;k<F.letters.length;k++)if(F.letters[k].arr)arrN++;
    if(!any&&arrN===F.letters.length||F.t>4.5){
      for(var m2=0;m2<F.letters.length;m2++){
        var L2=F.letters[m2];
        if(!L2.arr){L2.arr=true;L2.el.style.pointerEvents='';dockLetter(L2.d);}
      }
      resetTrashPos();
      app.BH_FINALE=null;
      return;
    }
  }
}
export function annihBody(O,idx){
  // the body is swallowed: it particleizes (letters burst) and merges into the hole
  var cx=O.x,cy=O.y;
  burstParticles(cx,cy,22,1.2);
  ringGo(cx,cy);
  removeMatterBody(O);    // if a boundary is swallowed, its Matter body goes with it
  var i=bodies.indexOf(O);if(i>=0)bodies.splice(i,1);
  if(O.go){var gD=O.go;if(gD.bin){var P2=gD.by;if(P2&&bodies.indexOf(P2)>=0){P2.vx=-Math.sin(gD.ang)*gD.w*gD.rad*gD.rP;P2.vy=Math.cos(gD.ang)*gD.w*gD.rad*gD.rP;P2.goB=null;}}O.go=null;}
  if(O.goB&&bodies.indexOf(O.goB)>=0){var H2=O.goB,gH2=H2.go;if(gH2){H2.vx=-Math.sin(gH2.ang)*gH2.w*gH2.rad*gH2.rB;H2.vy=Math.cos(gH2.ang)*gH2.w*gH2.rad*gH2.rB;H2.go=null;}O.goB.goB=null;}
  O.diss=true;
  for(var j=0;j<O.glyphs.length;j++){
    var g=O.glyphs[j];
    if(g.body===O){g.body=null;g.inBody=false;killLetter(g);}
  }
  O.glyphs=[];O.mem=[];
}
// a field source (B / E) or a charge/current (q / I) swallowed by the hole: its field dies
// with it, so it is simply destroyed in a last puff of debris.
export function killFieldBody(O,idx){
  burstParticles(O.x,O.y,16,1.1);
  ringGo(O.x,O.y);
  killBody(O);
}
// kill (trash / double-click) of a LIVE black hole: it "explodes" — a blast wave
// shatters whole bodies in range into their own letters (flung outward, fast decay),
// free letters are vaporized outright, and formulas are blown away.
export const BLAST_R=500;
export function explodeBlackHole(B){
  var cx=B.x,cy=B.y;
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  if(B.bh)B.bh.dead=true;
  B.diss=true;
  B.glyphs.slice().forEach(function(g){if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}});
  B.glyphs=[];B.mem=[];
  // flash: 240 dark + 120 white-hot particles
  spawnExplosion(cx,cy);
  for(var w=0;w<120;w++){
    var wa=Math.random()*6.2832,ws=200+Math.random()*900;
    particles.push({x:cx,y:cy,vx:Math.cos(wa)*ws,vy:Math.sin(wa)*ws,age:0,life:0.5+Math.random()*0.7,r:1+Math.random()*2,alpha:1,hot:true});
  }
  shake(22,0.8);
  blastAt(cx,cy,BLAST_R);   // blast wave: shatter wholes, vaporize letters, blow shards
}
export function drawBlackHole(B){
  var bh=B.bh,cx=B.x,cy=B.y;
  var r=Math.max(4,bh.r);
  // ---- 1) gravitational lens: concentric distorted rings around the hole ----
  var rings=5;
  for(var li=0;li<rings;li++){
    var lr=r*1.15+li*13+Math.sin(bh.spin*1.4+li*1.9)*3;
    var wob=1+0.10*Math.sin(bh.spin*2.1+li*2.4);
    cvx.strokeStyle='rgba(38,34,28,'+(0.30-li*0.045)+')';
    cvx.lineWidth=1.6-li*0.18;
    cvx.beginPath();
    // a ring drawn as a wobbly ellipse: space is "stretched" tangentially
    var N=26;
    for(var n=0;n<=N;n++){
      var a=n/N*6.2832;
      var rr=lr*(wob+(0.05*Math.sin(3*a+bh.spin*1.7))*li*0.4);
      var xx=cx+Math.cos(a)*rr;
      var yy=cy+Math.sin(a)*rr*(0.92+0.06*Math.sin(2*a+bh.spin));
      if(n===0)cvx.moveTo(xx,yy);else cvx.lineTo(xx,yy);
    }
    cvx.stroke();
  }
  // lens streaks: short arcs tangentially smeared (space warping streaks)
  cvx.strokeStyle='rgba(38,34,28,0.22)';
  cvx.lineWidth=1.2;
  for(var s2=0;s2<8;s2++){
    var sa=bh.spin*0.9+s2*0.7854;
    var sr=r*1.3+(s2%3)*10;
    cvx.beginPath();
    cvx.arc(cx,cy,sr,sa,sa+0.9);
    cvx.stroke();
  }
  // ---- 2) accretion disk: a MONOCHROME swirl of dark streaks just outside the horizon.
  // Everything on this canvas is ink-black line art — no colour anywhere.
  for(var ai=0;ai<3;ai++){
    var ar=r+4+ai*4;
    cvx.strokeStyle='rgba(38,34,28,'+(0.55-ai*0.13)+')';
    cvx.lineWidth=3.4-ai*0.9;
    cvx.beginPath();
    cvx.arc(cx,cy,ar,bh.spin*2+ai*0.5,bh.spin*2+ai*0.5+4.6-ai*1.1);
    cvx.stroke();
  }
  // ---- 3) the hole itself: pure black core with a soft dark falloff ----
  var grd=cvx.createRadialGradient(cx,cy,r*0.2,cx,cy,r*1.05);
  grd.addColorStop(0,'rgba(0,0,0,1)');
  grd.addColorStop(0.78,'rgba(12,10,14,0.96)');
  grd.addColorStop(1,'rgba(20,18,22,0)');
  cvx.fillStyle=grd;
  cvx.beginPath();
  cvx.arc(cx,cy,r*1.05,0,6.2832);
  cvx.fill();
  // thin photon-ring edge (ink, not colour)
  cvx.strokeStyle='rgba(38,34,28,0.75)';
  cvx.lineWidth=1.4;
  cvx.beginPath();
  cvx.arc(cx,cy,r+1,0,6.2832);
  cvx.stroke();
}
