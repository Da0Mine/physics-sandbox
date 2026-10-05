/* 拖拽时的导轨轴向 / 圆弧约束 */
import { bodies } from '../core/dom.js';
import { springAnchoredWorld } from './spring.js';
import { grab, pointer } from '../input/pointer.js';

// 能力标记（供外部探针脚本识别）：springRailFollow 每帧把可动宿主锚点绝对对齐到导轨，
// 且无静止/拖拽参考时法向速度取平均。改语义请一并改它。
// 拖拽轴向约束：被拖物体若挂在某根方向锁弹簧的一端，而另一端是真固定（static / 右键固定），
//   则本次拖拽只允许沿导轨轴向移动：指针位移的法向分量直接丢掉。
// 刚性参考只算 static / fixed，不算压在地上（railHostSupported）：两只压地的球组成的水平弹簧
//   必须能被拖动整体抬起来，把压地算进来就废了。
// 为什么在拖拽侧守：拖拽默认是「指针决定位姿」，但导轨在法向上对装配体是刚性的，被拖物体横向离开
//   导轨后弹簧端点仍投影在导轨上 ⇒ 连接点从物体表面滑开。所以法向必须由拖拽侧拦住，指针只能拉长/压缩弹簧。
// 返回单位方向 {x,y}（导轨轴向）或 null。B 是弹簧自身（kind==='S'）时不约束（拖弹簧 = 搬整体）。
export function dragAxisLock(B){
  if(!B||B.kind==='S'||!B.mb)return null;
  var found=null;
  for(var j=0;j<bodies.length;j++){
    var S=bodies[j];
    if(S.kind!=='S'||S.dead||!S.dirLock)continue;
    for(var i=0;i<2;i++){
      var a=S.anc[i],o=S.anc[1-i];
      if(!a||a.B!==B)continue;
      if(!o||!o.B||o.B.dead)continue;                  // 另一端没锚 ⇒ 自由弹簧，不约束
      var oh=o.B;
      if(!((oh.mb&&oh.mb.isStatic)||oh.fixed))continue; // 只认真固定（见函数头注释）
      found={x:S.dirLock.ux,y:S.dirLock.uy};            // 两端同轴，取哪根都一样
    }
  }
  return found;
}
/* 拖连着杆的宿主（杆另一端是固定体）时，直线拖拽与杆长不可伸长冲突 —— conDragConstrain 的反向钳位
 * 会把拖拽整个吃掉。改为沿弧线拖：指针投影到绕另一端锚点、半径=杆长的圆弧上，跟手且杆长恒定。
 * 返回弧参数 {cx,cy,R}，由 dragPtrAxis 统一投影。 */
export function dragArcLock(B){
  if(!B||B.kind==='T')return null;
  for(var i=0;i<bodies.length;i++){
    var r=bodies[i];
    if(r.kind!=='T'||r.dead||!r.anc)continue;
    for(var e=0;e<2;e++){
      var a=r.anc[e],o=r.anc[1-e];
      if(!a||a.B!==B)continue;
      if(!o||!o.B)continue;
      var oh=o.B;
      if(!((oh.mb&&oh.mb.isStatic)||oh.fixed))continue;   // 另一端必须是铁砧
      var p=springAnchoredWorld(r,1-e);
      return {cx:p.x,cy:p.y,R:r.len||170};
    }
  }
  return null;
}
// 把当前指针投影成等效指针：法向分量丢掉，只留导轨轴向分量（弧线锁时投影到圆弧上）。
// 这个投影必须被所有「把被拖物体摆到指针位置」的写入点共用（pointermove 的即时摆放和 stepMatter
//   的每帧摆放）：漏掉任一处，另一处会以未投影的指针覆盖，轴锁看起来完全没生效。
export function dragPtrAxis(){
  /* 弧线拖拽：被拖体连着另一端为铁砧的杆时，等效指针 = 绕锚点、半径=杆长的圆弧上朝原始指针方向的点 + 抓点偏移。 */
  if(grab&&grab.arc){
    var ac=grab.arc;
    var aa=Math.atan2(pointer.y-grab.gy-ac.cy,pointer.x-grab.gx-ac.cx);
    return {x:ac.cx+Math.cos(aa)*ac.R+grab.gx,y:ac.cy+Math.sin(aa)*ac.R+grab.gy};
  }
  if(!grab||!grab.axis)return pointer;
  var dx=(pointer.x-grab.gx)-grab.ax0,dy=(pointer.y-grab.gy)-grab.ay0;
  var l=dx*grab.axis.x+dy*grab.axis.y;                 // 只留轴向分量
  return {x:grab.ax0+grab.axis.x*l+grab.gx,y:grab.ay0+grab.axis.y*l+grab.gy};
}
