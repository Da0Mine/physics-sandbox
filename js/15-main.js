/* 主循环 frame 与 init（原 index.html 第 18893–18949 行） */
function frame(now){
  requestAnimationFrame(frame);
  if(!lastT)lastT=now;
  /* ★★R131-34/42：**Δt 时间倍率**（右键字符 t → 参数）——0 = 万物自发运动停止。
   *  ★★R131-42（用户：「时间停止时我还是要能拖动、能合并、能召唤、能画图」）：
   *   **渲染与交互同步（syncGlyphs/refreshHover/render/cursorTick）必须始终执行**，
   *   只把「自发演化」那一族（物理/Matter/弹簧/碰撞/重力/场/粒子/黑洞）放到 TIME_SCALE>0 里。
   *   上一版把交互也一起跳过了 ⇒ 静止时拖不动、画不了、召唤出来瞬移到左上角。 */
  /* ★★R131-54d（**一个修法治两个 bug**）：指针没按着却还留着 grab ⇒ 说明上一次手势
   *  没有正常收尾。实测后果有两个：
   *   ① 「物体装了独立铰链就凭空匀速漂移」——各处的拖拽跟随逻辑都按 grab 走，残留时每帧搬移；
   *   ② 「右键/长按一次后抓不动」——新按下被判为「已有抓取」而拒绝。
   *  在这里统一清理（**只读 `__ptrDown`，不碰任何拖动语义**；真拖动时指针按着不会被清，
   *  触摸端由 pointerdown/up/cancel 维护该标志 ⇒ 不破坏触摸拖动）。 */
  if(!window.__ptrDown && grab && grab.kind){grab.kind=null;grab.obj=null;}
  var dtReal=Math.min(0.033,Math.max(0.008,(now-lastT)/1000));
  lastT=now;
  var dt=dtReal*TIME_SCALE;
  lastDt=Math.max(dt,1/240);        // ★交互层用的 dt（为 0 时给最小值，避免除零/NaN 瞬移）
  if(TIME_SCALE>0){
    stepPhysics(dt);
    /* ★★R131-60：**这里不再调用** applyGivenAccel —— 它已搬到 stepMatter 的**子步循环**里
     *  （Matter 每子步清 force，每帧施一次只剩 1/4 ⇒ 加速度永远到不了 g）。留在帧级会与子步
     *  那次叠加成 1.25 倍，必须删。 */
    stepMatter(dt);
    stepSprings(dt);   // R57 弹簧：端点跟随宿主 + 施加弹力（必须在 collideBodies 之前）
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
    stepBoss(dt);      // ★R132 BOSS 召唤（必须在 stepParticles 之后：它要往 particles 里补 seek 粒子）
  }
  if(typeof drawChargeMark==='function')drawChargeMark();
  if(typeof drawPendingHint==='function')drawPendingHint();
  /* —— 以下始终执行（交互与渲染，时间静止时用户仍可拖动/合并/召唤/画图）—— */
  refreshHover();
  updateParamContacts();
  syncGlyphs();
  render();
  cursorTick();
}
function init(){
  resize();
  window.addEventListener('resize',resize);
  [mO,M2O,gO,aO,vO,rO,halfO,muO,cO,GO,tO,BO,qO,IO,EO,kO,xO].forEach(function(d){d.cat=1;});
  dockLetter(mO);dockLetter(M2O);dockLetter(gO);dockLetter(aO);dockLetter(vO);dockLetter(rO);dockLetter(halfO);dockLetter(muO);dockLetter(cO);dockLetter(GO);dockLetter(tO);
  dockLetter(BO);dockLetter(EO);dockLetter(qO);dockLetter(IO);
  dockLetter(kO);dockLetter(xO);   // R57：新符号 k / x
  requestAnimationFrame(frame);
}
init();
