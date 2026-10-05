/* 复制物体 / 组装体 */
import Matter from 'matter-js';
import { BODY, spawnField } from '../bodies/body.js';
import { mkBoundary } from '../bodies/boundary.js';
import { makeRod } from '../bodies/rod.js';
import { GROUND_TH } from '../devices/ground.js';
import { makeHinge } from '../devices/hinge.js';
import { makeRope } from '../devices/rope.js';
import { makeSpring, refreshSpringGeom, springAssemblyOf, springSyncEnds, springSyncGroups } from '../devices/spring.js';
import { GD } from '../letters/glyph.js';
import { refresh, slot } from '../letters/layout.js';
import { sortPanel } from '../letters/panel.js';
import { GROUND_SPAWN_LEN } from './defs.js';
import { applyWMul } from '../physics/material.js';
import { MW } from '../physics/matter.js';
import { ringGo } from '../ui/menu.js';

// 复制一个画出来的线/图形（W 体）。
// W 体不能走 spawnField('W')：那会造出没有 B.pts 的畸形体，drawBoundaries / nearInk / distToHost
// 每帧读 B.pts[0] 抛异常，rAF 链断掉、页面卡死。
export function copyWBody(src,dx,dy,quiet){
  if(!src||src.kind!=='W'||!src.pts||src.pts.length<2)return null;
  // 直接把 src 的**本地** pts 平移过去（不把转角烘进点里）：mkBoundary 会按同样的点算出同样的
  // 质心，于是 B.pts / B.ell / B.notch 全落在与源完全一致的本地坐标系里，转角单独用 th 还原。
  var p=[],i;
  for(i=0;i<src.pts.length;i++)p.push([src.pts[i][0]+src.x+dx,src.pts[i][1]+src.y+dy]);
  var opt={shape:src.wshape||'poly',rad:src.rad||0,closed:!!src.closed,notch:src.notch||null};
  if(src.ell)opt.ell={cx:src.x+src.ell.lcx+dx,cy:src.y+src.ell.lcy+dy,
                      rx:src.ell.rx,ry:src.ell.ry,a0:src.ell.a0,a1:src.ell.a1};
  // 凹槽真弧元数据随副本平移（本地 -> 世界，mkBoundary 会再转回本地）
  if(src.arcs)opt.arcs=src.arcs.map(function(a){
    return {i0:a.i0,i1:a.i1,cx:src.x+a.lcx+dx,cy:src.y+a.lcy+dy,
            mx:src.x+a.lmx+dx,my:src.y+a.lmy+dy,r:a.r};});
  var B=mkBoundary(p,opt);
  if(!B)return null;
  if(src.th){B.th=src.th;if(B.mb)Matter.Body.setAngle(B.mb,src.th);}
  B.sc=src.sc||1;
  // 副本继承用户调过的质量乘数、摩擦系数与弹性（applyWMul 走 B.mb 已就位的路径）
  if(src.mMul)B.mMul=src.mMul;
  if(src.wFrict!=null)B.wFrict=src.wFrict;
  if(src.wBounc!=null)B.wBounc=src.wBounc;
  applyWMul(B);
  /* 器件身份也要复制：否则地面/墙面的副本会变成普通木板（无 gnd、参数面板不对）。
   * 已知限制：belt 的副本同样会丢身份，尚未处理。 */
  if(src.gnd){B.gnd=1;B.len=src.len;B.hw=(src.len||GROUND_SPAWN_LEN)/2;B.hh=src.hh||GROUND_TH/2;}
  if(src.fixed){B.fixed=true;if(B.mb&&MW){Matter.Body.setStatic(B.mb,true);Matter.Sleeping.set(B.mb,false);}}
  B.pop=1;B.orbPulse=1;B.copied=true;
  // 注意：**不能** refresh(B)。refresh 走 layoutField，而 layoutField 只为 S/T 分支做了处理，
  // 落到 'W' 时会执行 `B.fg.body=B` —— W 体没有 fg，直接抛 "Cannot set properties of null"，
  // 而且它先一步写的 `B.glyphs=[null]` 已经污染了数组，之后每帧渲染读 glyph.dead 全部炸。
  if(!quiet)ringGo(B.x,B.y);
  return B;
}
export function copySpringBody(src,dx,dy,quiet){
  var sdx=src.e1.x-src.e0.x,sdy=src.e1.y-src.e0.y;
  // 复制按标志分派（铰链两端重合，用 sdx/sdy 造会退化成长度 1 的假弹簧）。
  var ns=src.hinge?makeHinge(src.x+dx,src.y+dy)
        :src.rope?makeRope(src.e0.x+dx,src.e0.y+dy,src.e0.x+dx+sdx,src.e0.y+dy+sdy)
        :makeSpring(src.e0.x+dx,src.e0.y+dy,src.e0.x+dx+sdx,src.e0.y+dy+sdy);
  if(ns.rope)ns.len=src.len;
  else if(!ns.hinge){ns.len=src.len;ns.ks=src.ks;}
  if(src.dirLock)ns.dirLock={mx:src.dirLock.mx+dx,my:src.dirLock.my+dy,
                             ux:src.dirLock.ux,uy:src.dirLock.uy,
                             auto:!!src.dirLock.auto};   // 导轨随副本平移，auto 标记一并继承
                             // （漏掉 auto：高中模式复制出来的弹簧会开始冻结宿主自转）
  refreshSpringGeom(ns);
  ns.pop=1;ns.orbPulse=1;ns.copied=true;
  if(!quiet)ringGo(ns.x,ns.y);
  return ns;
}
// R60c：整体复制。成员一起平移 (dx,dy)，弹簧按**本地偏移原样**重新锚到宿主的副本上，
// 于是复制出来的装配体与原装配体几何完全一致（相对位置、锚点、自然长度、劲度全保留）。
export function copyAssembly(src,mem){
  var dx=56,dy=44,i,j,pairs=[];
  for(i=0;i<mem.length;i++){
    var O=mem[i],C=null;
    if(O.kind==='W')C=copyWBody(O,dx,dy,true);
    else if(O.kind==='S')C=copySpringBody(O,dx,dy,true);
    else if(O.kind==='T'||O.kind)continue;      // 杆/场源先不进装配体复制（保持旧行为）
    if(C)pairs.push([O,C]);
  }
  for(i=0;i<pairs.length;i++){
    var O2=pairs[i][0],C2=pairs[i][1];
    if(O2.kind!=='S')continue;
    for(j=0;j<2;j++){
      var a=O2.anc[j];if(!a||!a.B)continue;
      var cp=null;
      for(var k2=0;k2<pairs.length;k2++)if(pairs[k2][0]===a.B){cp=pairs[k2][1];break;}
      if(cp)C2.anc[j]={B:cp,ox:a.ox,oy:a.oy};        // 本地偏移照搬 = 几何复制
    }
    springSyncEnds(C2);
  }
  var focus=null;
  for(i=0;i<pairs.length;i++)if(pairs[i][0]===src){focus=pairs[i][1];break;}
  focus=focus||(pairs.length?pairs[0][1]:null);
  if(focus)ringGo(focus.x,focus.y);
  springSyncGroups();
  return focus;
}
export function copyBody(src){
  if(!src)return;
  // 装配体必须整体复制：成员 >1 走整体复制；单体才走各自的复制逻辑。
  var mem=springAssemblyOf(src);
  if(mem.length>1){
    var hasS=false,hasW=false;
    for(var mi=0;mi<mem.length;mi++){
      if(mem[mi].kind==='S')hasS=true;
      if(mem[mi].kind==='W')hasW=true;
    }
    if(hasS&&hasW){var got=copyAssembly(src,mem);sortPanel();return got;}
  }
  if(src.kind==='S'){
    // 弹簧：复制一条同长同角度的新弹簧（锚点不复制 —— 新弹簧从「没接上」开始）
    var ns=copySpringBody(src,56,44,false);
    sortPanel();
    return ns;
  }
  if(src.kind==='W'){
    // 画出来的线/图形：按几何原样复制（不能落到下面的 if(src.kind) 场源分支，见 copyWBody）。
    return copyWBody(src,56,44,false);
  }
  if(src.kind==='T'){
    // copy a vt-rod: a fresh rod of the same length + rotation
    var nr=makeRod(src.x+48+Math.random()*40-20,src.y+42+Math.random()*30-15,0,0);
    nr.th=src.th||0;nr.len=src.len||170;nr.hw=nr.len/2+2;
    /* 副本带上反棘轮目标长度 _rodL（rodSyncAnchors 计算 err 的基准），
     * 否则惰初始化前的那一帧 err 会按旧值算。 */
    nr._rodL=src._rodL||nr.len;
    nr.pop=1;nr.orbPulse=1;nr.copied=true;
    refresh(nr);
    ringGo(nr.x,nr.y);
    return nr;
  }
  if(src.kind){
    // 场源复制（B / q / I / E）：复制同种场源并保留方向/极性（E 保留 th，B 保留 Bz，q/I 保留符号）。
    var nb=spawnField(src.kind,src.x+48+Math.random()*40-20,src.y+42+Math.random()*30-15,0,0);
    if(src.kind==='E'){nb.th=src.th||0;if(src.er)nb.er={l:src.er.l,r:src.er.r,t:src.er.t,b:src.er.b};}
    else if(src.kind==='B'){nb.Bz=src.Bz;}
    else if(src.kind==='q'){nb.qsign=src.qsign;}
    else if(src.kind==='I'){nb.Isign=src.Isign;}
    nb.pop=1;nb.orbPulse=1;nb.copied=true;
    refresh(nb);
    ringGo(nb.x,nb.y);
    sortPanel();
    return nb;
  }
  var ch=(src.massG&&src.massG.type==='M')?'M':'m';
  var massN=GD(ch);
  massN.pop=0;
  var B=BODY(src.x+40+Math.random()*60-30,src.y+30+Math.random()*40-20);
  B.massG=massN;
  massN.body=B;
  B.glyphs=[];B.mem=[];
  var mm=[];
  for(var i=0;i<src.mem.length;i++){
    var c2=src.mem[i].type;
    var g2=GD(c2);g2.pop=0;
    B.mem.push(g2);
    mm.push(g2);
  }
  var list=[massN].concat(mm);
  list.forEach(function(g){g.body=B;g.inBody=true;g.prev={x:0,y:0};B.glyphs.push(g);});
  refresh(B);
  B.pop=1;
  B.orbPulse=1;
  B.copied=true;
  // carry over any per-body physics params the source had (mass/grav/acc/bounc/frict/scale…)
  if(src.param)for(var pk2 in src.param)if(src.param.hasOwnProperty(pk2))B.param[pk2]=src.param[pk2];
  if(B.param.mass!=null)B.mass=B.param.mass;   // refresh() ran before the copy — sync B.mass manually
  if(B.param.massM!=null)B.massCap=B.param.massM;   // capital-M mass (independent key)
  if(B.scaleParam!=null)refresh(B);
  ringGo(B.x,B.y);
  var ms=slot(B,B.massG);
  B.x+=src.x-ms.x;B.y+=src.y-ms.y;
  refresh(B);
  B.vx=60;B.vy=-40;
  sortPanel();
}
