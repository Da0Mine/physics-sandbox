/* 主循环 frame 与 init（原 index.html 第 18893–18949 行） */
function frame(now){
  requestAnimationFrame(frame);
  if(!lastT)lastT=now;
  /* Δt 时间倍率（右键字符 t → 参数），0 = 万物自发运动停止。
   * 只把自发演化（物理/Matter/弹簧/碰撞/重力/场/粒子/黑洞）放在 TIME_SCALE>0 里；
   * 渲染与交互（syncGlyphs/refreshHover/render/cursorTick）必须始终执行，否则静止时拖不动、画不了、召唤出来瞬移到左上角。 */
  /* 指针没按着却还留着 grab，说明上一次手势没有正常收尾，会导致：
   *  ① 拖拽跟随逻辑按残留 grab 每帧搬移物体（装了独立铰链的物体凭空匀速漂移）；
   *  ② 新按下被判为已有抓取而拒绝（右键/长按一次后抓不动）。
   * 这里统一清理，只读 __ptrDown、不碰拖动语义；触摸端由 pointerdown/up/cancel 维护该标志。 */
  if(!window.__ptrDown && grab && grab.kind){grab.kind=null;grab.obj=null;}
  var dtReal=Math.min(0.033,Math.max(0.008,(now-lastT)/1000));
  lastT=now;
  var dt=dtReal*TIME_SCALE;
  lastDt=Math.max(dt,1/240);        // 交互层用的 dt（为 0 时给最小值，避免除零/NaN 瞬移）
  if(TIME_SCALE>0){
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
  dockLetter(kO);dockLetter(xO);   // 符号 k / x
  requestAnimationFrame(frame);
}
init();
