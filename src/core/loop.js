/* 主循环 frame（每帧推进物理与绘制）与启动函数 init */
import { app } from '../state.js';
import { stepBoss } from '../boss/boss.js';
import { stepSprings } from '../devices/spring.js';
import { stepBlackHole, stepFinale } from '../effects/blackhole.js';
import { stepExplode } from '../effects/explosion.js';
import { stepParticles, stepShake } from '../effects/particles.js';
import { stepFormulas } from '../effects/text.js';
import { grab, ptrDown } from '../input/pointer.js';
import { dockLetter } from '../letters/panel.js';
import { updateParamContacts } from '../params/panel.js';
import { stepMatter } from '../physics/matter.js';
import { collideBodies, stepField, stepGravity, stepPhysics } from '../physics/step.js';
import { cursorTick, drawChargeMark, drawPendingHint, refreshHover, render, resize, syncGlyphs, tickOrbs } from '../render/render.js';

export let lastT=0;
export let lastDt=1/60;   // the frame's integration step, reused by the swept rod contact in collideBodies
export function frame(now){
  requestAnimationFrame(frame);
  if(!lastT)lastT=now;
  /* Δt 时间倍率（右键字符 t → 参数），0 = 万物自发运动停止。
   * 只把自发演化（物理/Matter/弹簧/碰撞/重力/场/粒子/黑洞）放在 TIME_SCALE>0 里；
   * 渲染与交互（syncGlyphs/refreshHover/render/cursorTick）必须始终执行，否则静止时拖不动、画不了、召唤出来瞬移到左上角。 */
  /* 指针没按着却还留着 grab，说明上一次手势没有正常收尾，会导致：
   *  ① 拖拽跟随逻辑按残留 grab 每帧搬移物体（装了独立铰链的物体凭空匀速漂移）；
   *  ② 新按下被判为已有抓取而拒绝（右键/长按一次后抓不动）。
   * 这里统一清理，只读 ptrDown、不碰拖动语义；触摸端由 pointerdown/up/cancel 维护该标志。 */
  if(!ptrDown && grab && grab.kind){grab.kind=null;grab.obj=null;}
  var dtReal=Math.min(0.033,Math.max(0.008,(now-lastT)/1000));
  lastT=now;
  var dt=dtReal*app.TIME_SCALE;
  lastDt=Math.max(dt,1/240);        // 交互层用的 dt（为 0 时给最小值，避免除零/NaN 瞬移）
  if(app.TIME_SCALE>0){
    stepPhysics(dt);
    /* 这里不调用 applyGivenAccel：它在 stepMatter 的子步循环里（Matter 每子步清 force，帧级施力只剩 1/4）。
     * 帧级再调一次会与子步叠加成 1.25 倍。 */
    stepMatter(dt);
    stepSprings(dt);   // 弹簧：端点跟随宿主 + 施加弹力（必须在 collideBodies 之前）
    collideBodies();
    stepGravity(dt);
    stepField(dt);
    tickOrbs(dt);
    stepExplode(dt);
    stepBlackHole(dt);
    stepFinale(dt);
    stepFormulas(dt);
    stepParticles(dt);
    stepShake(dt);
    stepBoss(dt);      // BOSS 召唤（必须在 stepParticles 之后：它要往 particles 里补 seek 粒子）
  }
  drawChargeMark();
  drawPendingHint();
  /* —— 以下始终执行（交互与渲染，时间静止时用户仍可拖动/合并/召唤/画图）—— */
  refreshHover();
  updateParamContacts();
  syncGlyphs();
  render();
  cursorTick();
}
export function init(){
  resize();
  window.addEventListener('resize',resize);
  [app.mO,app.M2O,app.gO,app.aO,app.vO,app.rO,app.halfO,app.muO,app.cO,app.GO,app.tO,app.BO,app.qO,app.IO,app.EO,app.kO,app.xO].forEach(function(d){d.cat=1;});
  dockLetter(app.mO);dockLetter(app.M2O);dockLetter(app.gO);dockLetter(app.aO);dockLetter(app.vO);dockLetter(app.rO);dockLetter(app.halfO);dockLetter(app.muO);dockLetter(app.cO);dockLetter(app.GO);dockLetter(app.tO);
  dockLetter(app.BO);dockLetter(app.EO);dockLetter(app.qO);dockLetter(app.IO);
  dockLetter(app.kO);dockLetter(app.xO);   // 符号 k / x
  requestAnimationFrame(frame);
}
