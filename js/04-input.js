/* 右键菜单、指针 / 触屏输入（原 index.html 第 6700–7960 行） */
function openMenu(x,y,B,d){
  if(!B)return;
  menuBody=B;
  menuLetter=d||null;
  // "参数" button only shows when right-clicked LETTER has an adjustable param
  // (a bare body right-click, e.g. a T-rod, uses paramDef(body) instead)
  var adj=(d)?paramDefForLetter(B,d).length>0:paramDef(B).length>0;
  var pb=menu.querySelector('[data-act="param"]');
  if(pb)pb.classList.toggle('hide',!adj);
  // "固定/解锁" button shows for BOUNDARIES (drawn lines & preset shapes) — nothing else
  var fb=menu.querySelector('[data-act="fix"]');
  if(fb)fb.classList.toggle('hide',!(B.kind==='W'));
  var fx=menu.querySelector('[data-act="fix"] .fix-lab');
  if(fx)fx.textContent=(B.fixed)?'取消固定':'固定';
  // R64：「固定方向」只对弹簧显示 —— 锁定那一刻的弹簧朝向成为导轨，之后只能沿它伸缩
  // ★R104-3（用户：「绳子不需要有固定方向的选项」）：把这个门收成 **kind==='S' 且不是绳/铰链**。
  //   'S' 一族现在有三个成员：弹簧（有朝向、可锁导轨）、轻绳（没有「方向」可言，几何完全由两个
  //   锚点决定）、光滑铰链（长度恒 0，连方向都没有）。旧判据只看 kind ⇒ 后两者也弹出这一行，
  //   而 dirLock 对它们做的事是**冻结宿主自转 + 用弹簧力把锚点拽回导轨** —— 对一条只传张力的绳
  //   或一个销钉来说是纯破坏（铰链会被拽成一根有向的杆）。所以直接在**显示层**收口，
  //   并在下面 menu click 的分派里加同一条守卫（双通道，漏一处就会出现「点得到但没反应」）。
  var db=menu.querySelector('[data-act="dirlock"]');
  if(db)db.classList.toggle('hide',B.kind!=='S'||!!B.rope||!!B.hinge);
  /* ★R131-33（用户：「右键铰链显示固定角度按钮，点击后铰链固定角度」）：杆（铰链）显示
   *  「固定角度」——锁定后**物体随杆一起转**（连接点仍不动，相对姿态锁死）。 */
  var rb=menu.querySelector('[data-act="rodlock"]');
  if(rb){
    var rk=(B.kind==='T'&&B.anc&&(B.anc[0]||B.anc[1]));
    rb.classList.toggle('hide',!rk);
    var rl=rb.querySelector('.rl-lab');
    if(rl)rl.textContent=B._rodAngleLock?'解除角度固定':'固定角度';
  }
  var dl=menu.querySelector('[data-act="dirlock"] .dl-lab');
  if(dl)dl.textContent=(B.dirLock)?'取消固定方向':'固定方向';
  // R65（用户：「右键的那些按钮有时太靠近下面会导致被屏幕截断点不到」）：固定偏移的 clamp
  // 在菜单条目变多后会失守（H-90 是按 3 条目估的）。先显示、再量**实际**渲染尺寸、按视口收 ——
  // 菜单永远整条落在窗口内。
  menu.classList.add('on');
  var mr=menu.getBoundingClientRect();
  var ax=clamp(x,0,window.innerWidth-mr.width-6);
  var ay=clamp(y,0,window.innerHeight-mr.height-6);
  /* ★★R132-9za（用户 2026-10-03：「那些物体，比如方形，圆形啥的都不行，
   *   **只有右键点击了 q 字符，这个字符就无法赋予了**」）。
   *   病根：菜单的定位是「左上角放在光标处、向右下展开」⇒ **会盖住刚被右键的那个字符**
   *   （实测面板最下一排的 q：菜单 [1264,207,130,39] 压在字符格 [1271,185,44,44] 上，
   *    重叠 968px²、`elementFromPoint(字符中心)` 返回的是 `menu`；而 m/v/E 只是边缘重叠、
   *    字符中心仍可点 ⇒ 只有最下面一排的字符合格）。
   *   后果：用户接着想「抓住这个 q 拖到物体上」的那一下 `pointerdown` **被菜单吃掉**
   *   ⇒ 拖拽根本没开始（`grab` 始终是 null）⇒ 后面当然「赋不上」，
   *   而且**与目标物体是什么（方块/圆/任何）完全无关** —— 这正是「方形圆形都不行」的原因。
   *   修：菜单**避开**被右键的元素。候选顺序 = 元素下方 → 上方 → 右侧 → 左侧，
   *   取第一个「整条在视口内且与元素矩形不相交」的；都不行才退回原位（宁可挡也别丢菜单）。
   *   ★对**画布上的物体**右键不避让（`d` 为空 ⇒ `el` 为空 ⇒ 行为逐字节不变）。 */
  var _el=(d&&d.el&&d.el.getBoundingClientRect)?d.el:null;
  if(_el){
    var ar=_el.getBoundingClientRect();
    var cand=[[ar.left,ar.bottom+6],              /* 正下方 */
              [ar.left,ar.top-mr.height-6],       /* 正上方 */
              [ar.right+6,ar.top],                /* 右侧 */
              [ar.left-mr.width-6,ar.top]];       /* 左侧 */
    for(var ci=0;ci<cand.length;ci++){
      var L=clamp(cand[ci][0],0,window.innerWidth-mr.width-6);
      var T=clamp(cand[ci][1],0,window.innerHeight-mr.height-6);
      if(L<ar.right&&L+mr.width>ar.left&&T<ar.bottom&&T+mr.height>ar.top)continue;  /* 仍相交 */
      ax=L;ay=T;break;
    }
  }
  menu.style.left=ax+'px';
  menu.style.top=ay+'px';
}
function closeMenu(){menu.classList.remove('on');}
function ringGo(x,y){
  var e=ring;
  e.style.left=(x-75)+'px';e.style.top=(y-75)+'px';
  e.classList.remove('go');void e.offsetWidth;e.classList.add('go');
}
menu.addEventListener('click',function(e){
  e.stopPropagation();
  var it=e.target.closest('.menu-item');
  if(!it)return;
  var act=it.getAttribute('data-act');
  if(act==='param'&&menuBody){openParams(menuBody,menuLetter);}
  else if(act==='copy'&&menuBody){
    /* ★★R131-49（用户：「对 a 复制，怎么复制出来的是 m？还有复制完之后面板里的 a 又退回
     *  原位、画布上的 a 拖不动」）：真因——右键 a 时 `menuBody` 是**临时参数宿主体**（为
     *  打开参数面板而造），它**没有字形信息**（y 的赋予型字符不进 glyphs/mem）⇒ copyBody
     *  复制宿主体时字形回退到**字符表第一个 'm'**。
     *  修：**右键的是字符（menuLetter 非空）⇒ 复制那个字符本身**（在它旁边生成同字符的
     *  自由字符），完全不碰临时宿主；同时保持原字符的状态（不回面板、仍可拖动）。 */
    /* ★★R131-55（用户：「组合体的复制失效了，只复制里面的一个元素」）：上一版无条件
     *  按"复制字符本身"处理 ⇒ **把组合体的整体复制也吃掉了**。
     *  修：**只有"独立的赋予型字符"（v/a/q/t 且不构成表达式）才复制字符**；
     *  其余（真正的组合体/物体）走原来的 copyBody（整体复制）。 */
    var _ml=menuLetter;
    var _isLoneGiveChar=!!(_ml&&_ml.ch&&!_ml.dead&&
        (_ml.ch==='v'||_ml.ch==='a'||_ml.ch==='q'||_ml.ch==='t')&&
        !(menuBody&&((menuBody.mem&&menuBody.mem.length>1)||(menuBody.glyphs&&menuBody.glyphs.length>1))));
    if(_isLoneGiveChar){
      var _nd=GD(_ml.ch);
      _nd.cat=_ml.cat||1;_nd.pop=0;
      var _px=(_ml.wx!=null?_ml.wx:0)+48, _py=(_ml.wy!=null?_ml.wy:0)+10;
      _nd.state='free';_nd.wx=_px;_nd.wy=_py;_nd.vx=0;_nd.vy=0;
      if(typeof _ml.vGive!=='undefined')_nd.vGive=_ml.vGive;
      if(typeof _ml.vAng!=='undefined')_nd.vAng=_ml.vAng;
      if(typeof _ml.aGive!=='undefined')_nd.aGive=_ml.aGive;
      if(typeof _ml.aAng!=='undefined')_nd.aAng=_ml.aAng;
      if(typeof _ml.qCharge!=='undefined')_nd.qCharge=_ml.qCharge;
      charDefFill(_nd);   // ★R132-9m：同上 —— 面板上改过的默认值在这里补齐
      if(freeL.indexOf(_nd)<0)freeL.push(_nd);
      placeLetter(_nd);
    }else{
      copyBody(menuBody);
    }
  }
  else if(act==='fix'&&menuBody&&menuBody.kind==='W'){
    menuBody.fixed=!menuBody.fixed;
    if(menuBody.mb&&MW){
      Matter.Body.setStatic(menuBody.mb,menuBody.fixed);
      Matter.Sleeping.set(menuBody.mb,false);
    }
  }
  else if(act==='rodlock'&&menuBody&&menuBody.kind==='T'){
    /* ★R131-33：切换铰链的「固定角度」——锁定 ⇒ 宿主随杆一起转（力矩关闭、ω 重建恢复） */
    menuBody._rodAngleLock=!menuBody._rodAngleLock;
    var rl2=menu.querySelector('[data-act="rodlock"] .rl-lab');
    if(rl2)rl2.textContent=menuBody._rodAngleLock?'解除角度固定':'固定角度';
    var mb2=menuBody;
    for(var _ak=0;_ak<2;_ak++){
      var _h=(mb2.anc&&mb2.anc[_ak])?mb2.anc[_ak].B:null;
      if(_h&&_h.kind!=='T'&&_h.mb&&!_h.mb.isStatic&&!mb2._rodAngleLock){
        /* 解除固定 ⇒ 唤醒（让它按重力摆） */
        Matter.Sleeping.set(_h.mb,false);
      }
    }
  }
  else if(act==='dirlock'&&menuBody&&menuBody.kind==='S'&&!menuBody.rope&&!menuBody.hinge){
    // R64：锁定 = 把**此刻**的中点与方向冻结成导轨线。解除 = 清掉，几何回到「跟着宿主走」。
    if(menuBody.dirLock){
      menuBody.dirLock=null;
    }else{
      var mx0=(menuBody.e0.x+menuBody.e1.x)/2,my0=(menuBody.e0.y+menuBody.e1.y)/2;
      var ddx0=menuBody.e1.x-menuBody.e0.x,ddy0=menuBody.e1.y-menuBody.e0.y;
      var dd0=Math.hypot(ddx0,ddy0)||1;
      menuBody.dirLock={mx:mx0,my:my0,ux:ddx0/dd0,uy:ddy0/dd0};
      refreshSpringGeom(menuBody);          // 立刻投影一次，端点贴上导轨
    }
  }
  closeMenu();
});
/* ★★R131-54b：**"指针真的按着"标志**（只读用途）——修复「物体装了独立铰链就凭空匀速漂移」：
 *  残留的 grab（上一次手势没正常收尾）会让**拖拽中的磁吸**每帧执行 ⇒ 铰链连同锚定物体
 *  被持续平移（REC 实测：x 544→639 匀速、21~42px/s）。磁吸加这个门控即可根治，
 *  且**不动 grab 本体**（上一版在 pointerdown 清 grab 破坏了触摸拖动，已回退）。 */
window.__ptrDown=false;
DD.addEventListener('pointerdown',function(e){window.__ptrDown=true;},true);
DD.addEventListener('pointerup',function(e){window.__ptrDown=false;},true);
/* ★★R132-9：`pointercancel` 也要**收尾半截手势**，不能只把 __ptrDown 抹掉。
   为什么必须补（`_tmp_r314` 实测）：浏览器掐断指针流时（touch-action 判成滚动手势、
   或系统抢走触摸）pointerup **永远不会来** —— 于是 `TOOL.drag` / `TOOL.stroke` /
   `trashDrag.active` / `grab` 全部停在「手势进行中」，下一个手势直接落在残骸上
   （画形状时表现为「拉了个框却不落体，之后整个工具都是坏的」）。
   注意：`touch-action:none` 已让画布/垃圾桶不该再被掐断，这里是**兜底**，不是主修。 */
DD.addEventListener('pointercancel',function(e){
  window.__ptrDown=false;
  if(typeof TOOL!=='undefined'&&TOOL){
    if(TOOL.drag){TOOL.drag=null;}          // 取消的形状框：**丢弃**（松手才落体，取消不落）
    if(TOOL.stroke){TOOL.stroke=null;}      // 取消的笔画：同上
    if(TOOL.devDrag){try{endDeviceOut();}catch(_e){}}
  }
  if(typeof trashDrag!=='undefined'&&trashDrag&&trashDrag.active){
    trashDrag.active=false;
    var _tr=DD.getElementById('trash');
    if(_tr){_tr.style.left='';_tr.style.top='';
            _tr.style.right='24px';_tr.style.bottom='24px';_tr.classList.remove('on');}
  }
  if(typeof grab!=='undefined'&&grab){grab.kind=null;grab.obj=null;}
},true);
DD.addEventListener('pointerdown',function(e){if(!e.target.closest('#menu'))closeMenu();});
var grab={kind:null,obj:null,gx:0,gy:0,lx:0,ly:0,t:0,svx:0,svy:0,start:0};
var dblState={t:0,x:0,y:0,body:null};
var hoverB=null;
function easeOutBack(k){k-=1;return 1+k*k*((2.2)*k+1+2.2);}
var TOUCH_LETTER=null;   // ★R131-27c：触屏下面板中被点选的符号（等第二次点画布放置）
/* ★★R131-59：把「触摸长按 = 右键菜单」的动作体从**画布**的 pointerdown 里抽出来。
 *  原来它只挂在 cv 上 ⇒ 手指**正好压在小字形上**时（`.char` 自己吃掉了 pointerdown，
 *  画布那条入口根本收不到）长按**完全没有反应**（_diag_r153 ② 实测 菜单=False）。
 *  现在画布与字符两条入口共用同一个动作体 + 同一个计时器 TOUCH_LP
 *  （所以 pointermove / pointerup 里的 `clearTimeout(TOUCH_LP)` 对两条入口一样有效）。 */
function touchLongPressStart(cand){
  if(typeof TOUCH_LP!=='undefined'&&TOUCH_LP)clearTimeout(TOUCH_LP);
  TOUCH_LP=setTimeout(function(){touchLongPressFire(cand);},450);
}
function touchLongPressFire(cand){
  TOUCH_LP=null;
  window.__lpFired=(window.__lpFired||0)+1;   // 调试标记：长按回调是否触发
  if(grab&&grab.kind){grab.kind=null;grab.obj=null;}
  /* 触摸端没有 hover ⇒ hoverB 恒空，必须**按按下坐标主动扫墨线命中**
   * （_diag_r131u 实测：hoverB=None 导致长按菜单从未弹出）。 */
  /* ★R131-51：长按**自由字符**也要弹菜单（原来只扫 bodies ⇒ 长按 a/t 无反应）。 */
  /* ★★R131-59：**按下就命中的那个字符**直接当候选 —— 不能再靠「按下坐标 ±26px 扫描」：
   *  自由字符是有速度的（松手会被抛出/自己漂），450ms 长按期间它能飞出扫描半径，
   *  于是「长按自由字符」在字符刚动过之后**永远不弹菜单**（_diag_r153c 实证：
   *  lpFired=1 但 _fl=null ⇒ 菜单=False）。 */
  var _fl=null;
  if(cand&&cand.ch&&!cand.dead&&freeL.indexOf(cand)>=0)_fl=cand;
  if(!_fl)for(var _fi=0;_fi<freeL.length;_fi++){
    var _L=freeL[_fi];
    if(!_L||_L.dead)continue;
    if(Math.hypot((_L.wx||0)-pointer.x,(_L.wy||0)-pointer.y)<26){_fl=_L;break;}
  }
  if(_fl){
    var _fb=_fl.body||(typeof promoteFreeLetter==='function'?promoteFreeLetter(_fl):null);
    if(_fb){openMenu(pointer.x,pointer.y,_fb,_fl);if(grab){grab.kind=null;grab.obj=null;}return;}
  }
  var _mb=hoverB||((cand&&!cand.ch&&!cand.dead)?cand:null)||null;
  if(!_mb){
    for(var _mi=0;_mi<bodies.length;_mi++){
      var _B2=bodies[_mi];
      /* 触摸放宽：手指粗 ⇒ 用「距表面 <15px」，不用严格的墨线命中（实测差 2px 就漏） */
      if(_B2&&!_B2.dead&&_B2.kind==='W'&&distToHost(_B2,pointer.x,pointer.y)<15){_mb=_B2;break;}
    }
    if(!_mb){
      for(_mi=0;_mi<bodies.length;_mi++){
        _B2=bodies[_mi];
        if(_B2&&!_B2.dead&&_B2.kind==='S'&&segPointDist(_B2.e0.x,_B2.e0.y,_B2.e1.x,_B2.e1.y,pointer.x,pointer.y)<SPR_GRAB){_mb=_B2;break;}
      }
    }
  }
  if(_mb&&!_mb.dead){openMenu(pointer.x,pointer.y,_mb,null);}
}
function gdDown(e,d){
  /* ★R131-58c（**撤销"每次按下都清 grab"**）：实测它会**打断正在进行的拖动**（连续操作/
   *  多指/合成事件下尤甚）⇒ 正是"时能拖时不能拖、抓两次才动"。残留清理交给 frame 里
   *  那条（只在**指针没按着**时才清，绝不会打断真拖动）。 */
  /* ★★R131-27（用户：「触摸屏上手指按压位置与字符实际位置偏离一段距离、没有跟手」）：
   *  触摸没有 hover ⇒ pointerdown 时 pointer 仍是**上一次**的坐标；抓点偏移
   *  gx=pointer.x−cx 因此算成「旧指针到字符中心的距离」，拖动时字符与手指就永远
   *  保持这段距离（鼠标路径因为 mousemove 持续更新 pointer 所以看不出来）。
   *  修：按下时**先按本次事件坐标刷新 pointer**，再算抓点偏移。 */
  if(e&&typeof e.clientX==='number'){pointer.x=e.clientX;pointer.y=e.clientY;}
  if(e.button!==0)return;
  /* ★★R131-59：字符这条入口也要起**长按计时**——手指压在小字形上时画布那条入口收不到
   *  （见 touchLongPressStart 的注释）。面板(dock)字符除外：那边走 TOUCH_PENDING 的点选/
   *  拖出分流，长按计时会和它打架。移动/松手会统一取消（两条入口共用 TOUCH_LP）。 */
  if(uiTouch()&&e.pointerType==='touch'&&d.state!=='dock')touchLongPressStart(d);
  if(d.state==='dock'){
    /* ★★R131-27c（用户：「触屏下点符号应该变成面板内选中态（框+背景变色），
     *  再点一下屏幕位置才放置」）：触屏时点面板符号 ⇒ 记录 TOUCH_LETTER 并在
     *  面板上高亮（.touch-pick），**不立即拖出**；下一次点画布 ⇒ 放置到该处。 */
    if(uiTouch()&&e.pointerType==='touch'){
      /* ★★R131-28b（用户：「要保留两种放置功能」）：触屏点面板符号**不当场决定**——
       *  记为待定（TOUCH_PENDING），由后续手势分流：
       *  · 按住**移动超 12px** ⇒ 按原逻辑直接拖出（拖动放置，pointermove 里触发）；
       *  · 松手时**没怎么动**（tap）⇒ 面板内选中态（.touch-pick 高亮），下一次点画布放置。 */
      if(TOUCH_LETTER===d){TOUCH_LETTER=null;if(d.el)d.el.classList.remove('touch-pick');return;}
      window.TOUCH_PENDING={d:d,x:e.clientX,y:e.clientY};
      return;
    }
    var rp=d.el.getBoundingClientRect();
    var cx=rp.left+rp.width/2,cy=rp.top+rp.height/2;
    if(isMass(d)){
      var t2=GD(d.ch);
      t2.cat=1;t2.pop=0;
      t2.state='grab';
      t2.body=null;
      t2.wx=cx;t2.wy=cy;
      t2.w=F*0.7;t2.h=F;
      grab={kind:'letter',obj:t2,gx:pointer.x-cx,gy:pointer.y-cy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
      DD.body.appendChild(t2.el);
      place(t2,cx,cy,0,1,true);
      return;
    }
    var t2=GD(d.ch);
    t2.cat=1;t2.pop=0;
    t2.state='grab';
    t2.body=null;
    t2.wx=cx;t2.wy=cy;
    t2.w=F*0.7;t2.h=F;
    /* ★★R132 BOSS（接入点⑥）：**面板 v 的光速态必须传给拖出的克隆**。
     *  用户的操作正是「把 v 给召唤出来」——先在面板里把 v 调成光速，再从面板拖到 ½mv² 上。
     *  而 dock 拖出走的是 `GD(d.ch)` 造**新字符**，属性不会自动带过来 ⇒ 光速态在拖出那一刻
     *  就丢了，落下去只会当成普通"赋予速度 v"融进公式（公式就毁了）。
     *  这里与菜单「复制」分支（copyBody 那段）保持同一份拷贝清单，少一个都会出现
     *  「同一个 v 走不同入口行为不同」的诡异差异。 */
    if(typeof d.vGive!=='undefined')t2.vGive=d.vGive;
    if(typeof d.vAng!=='undefined')t2.vAng=d.vAng;
    if(typeof d.aGive!=='undefined')t2.aGive=d.aGive;
    if(typeof d.aAng!=='undefined')t2.aAng=d.aAng;
    if(typeof d.qCharge!=='undefined')t2.qCharge=d.qCharge;
    if(d.vLight){t2.vLight=true;t2.vGive=d.vGive;}
    /* ★R132-9m：dock 模板自身**不带**数值（W1 契约），面板上改过的值记在 `CHAR_DEF` 里
     *  ⇒ 从面板拖出的克隆用 `CHAR_DEF` 补齐缺省字段（已有值的不覆盖）。 */
    charDefFill(t2);
    grab={kind:'letter',obj:t2,gx:pointer.x-cx,gy:pointer.y-cy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
    DD.body.appendChild(t2.el);
    place(t2,cx,cy,0,1,true);
    return;
  }
  if(d.body&&!d.body.bh&&d.body.glyphs&&d.body.glyphs.indexOf(d)>=0){
    var B=d.body;
    if(dblState.body!==B){dblState.t=0;dblState.body=B;dblState.g=d;dblState.x=pointer.x;dblState.y=pointer.y;}
    grab={kind:'body',obj:B,gx:pointer.x-B.x,gy:pointer.y-B.y,lx:pointer.x,ly:pointer.y,t:performance.now(),svx:B.vx,svy:B.vy,start:pointer.x,x0:pointer.x,y0:pointer.y};
    grab.ax0=B.x;grab.ay0=B.y;grab.axis=dragAxisLock(B);   // R94：轴向约束在**按下那一刻**定死
    DD.body.appendChild(d.el);
    return;
  }
  /* ★★R131-46（用户：「t 每次要抓两次才能拖动，拖两次只有一次动」）：赋予型字符
   *  （v/a/q/t）被 promote 过之后**有宿主但不在任何 glyphs 列表里** ⇒ 上面的分支都不命中、
   *  而这里的自由字符分支要求 state 恰为 free/grab ⇒ 第一次抓为空抓。
   *  修：**赋予型字符无条件走自由字符抓取**（不管 state，也不管有没有临时宿主）。 */
  if((d.ch==='v'||d.ch==='a'||d.ch==='q'||d.ch==='t')&&d.state!=='dock'){
    detachFieldGlyph(d);          /* ★R132-9ze：场源体的字形先摘成自由字符（否则拖了没反应） */
    /* ★R131-58c：**不再强行改状态/摘 mem**（那会破坏正在进行的状态机）——只保证抓取成立。
     * ★★R131-59：**抓起即清速度** —— 自由字符松手会被抛出（pointerup 用 grab.svx 赋 L.vx），
     *  不在这里清掉的话，下一次抓起来时它还在按上次的速度飞 ⇒ 拖拽中从指针下"滑走"。 */
    d.vx=0;d.vy=0;
    grab={kind:'letter',obj:d,gx:pointer.x-d.wx,gy:pointer.y-d.wy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
    /* ★R131-55g（诊断发现 lastDown=None ⇒ 自愈拿不到锚点）：**这条分支也要记录** */
    window.__lastDownLetter={d:d,x:pointer.x,y:pointer.y,t:performance.now()};
    return;
  }
  /* ★★R131-51（触摸/快速连操实测：长按或快速点两次之后字母**抓不动**；间隔 1.2s 再拖就正常
   *  ⇒ 是「快速连续操作被双击判定吞掉」）：**自由字符的抓取放宽到所有非面板状态**
   *  （原来是 free/grab 两个状态 —— 双击/上一轮操作的中间态（如 idle）会落空 ⇒ 抓不动）。 */
  if(d.state!=='dock'){
    detachFieldGlyph(d);          /* ★R132-9ze：同上，任何「像字符但属于场源体」的字形都先摘 */
    d.state='free';
    d.vx=0;d.vy=0;      // ★R131-59：抓起即清速度（同上一分支；否则带着上次抛出的速度滑走）
    grab={kind:'letter',obj:d,gx:pointer.x-d.wx,gy:pointer.y-d.wy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
    /* ★R131-55d：记录"本次按下命中的字符"，供 pointermove 的**自愈式抓取**使用。 */
    window.__lastDownLetter={d:d,x:pointer.x,y:pointer.y,t:performance.now()};
    return;
  }
}
handle.addEventListener('pointerdown',function(e){
  // R56：固定的 W 边界也用这个旋转手柄（悬浮固定的线/图形时出现）
  /* ★R131-51：含 a 的表达式体（ma 组合）不响应旋转手柄 */
  var _hasA2=!!(hoverB&&((hoverB.glyphs&&hoverB.glyphs.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hoverB.mem&&hoverB.mem.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hoverB.massG&&(hoverB.massG.ch==='a'||hoverB.massG.type==='a'))
              ||hoverB.accGive!=null||hoverB.accX!=null||hoverB.accY!=null));
  if(_hasA2)return;
  if(!hoverB||(!hoverB.hasA&&hoverB.kind!=='T'&&hoverB.kind!=='E'&&!springCanRotate(hoverB)
     &&!(hoverB.kind==='W'&&hoverB.fixed)))return;
  e.preventDefault();e.stopPropagation();
  // Remember the angle at the moment of the press + the body's angle then. All later frames
  // derive the angle from the DRAG START (absolute), never from the previous frame — that is
  // what lets us snap LIVE without the snap pinning the rotation in place.
  var s0=tAnchor(hoverB);
  grab={kind:'rot',obj:hoverB,lx:pointer.x,ly:pointer.y,t:performance.now(),
        th0:hoverB.th||0,a0:Math.atan2(pointer.y-s0.y,pointer.x-s0.x)};
});
// R56：圆弧端点手柄——按住哪个端点，拖到哪角度就到哪（PPT 黄控制点交互）
// R57（用户 #2）：按住期间整条弧进入「编辑固定」态（editLock + Matter static），
// 不会一边改角度一边往下掉；松开（pointerup）才解除，恢复它原本的固定/自由状态。
ark.forEach(function(kn,i){
  kn.addEventListener('pointerdown',function(e){
    if(!arcHov||arcHov.dead)return;
    e.preventDefault();e.stopPropagation();
    grab={kind:'arcedit',obj:arcHov,end:i,t:performance.now()};
    hoverW=arcHov;
    arcHov.editLock=true;
    if(arcHov.mb)Matter.Body.setStatic(arcHov.mb,true);
  });
});
// R98-3：轻质杆的**两端长度手柄** —— 按住端点 i 拖，改的是杆长（+ 朝向），**另一端钉死不动**。
// 与 setRodLen（参数面板：质心不动、两端对称伸缩）语义不同，手柄走 setRodEnds。
// 远端坐标在**按下那一刻**存进 grab.fx/fy 一次，之后每帧都拿它当固定端 —— 不能每帧从
// rodEndWorld 现取：setRodEnds 会同时改写中心与角度，现取的远端会随上一帧的结果一起漂
// （拖 200px 实测远端累计漂走 30+px，正是「想调长短结果整根杆被推走」）。
rodh.forEach(function(kn,i){
  kn.addEventListener('pointerdown',function(e){
    if(!rodHov||rodHov.dead)return;
    /* ★★R131-31（用户实测：「杆和圆的中心连接还能在那一侧调节长度」）：端点已锚定 ⇒
     *  该端的长度手柄**不响应**（锚定端的长度由约束决定，不是用户拖出来的），
     *  避免干扰双击解除。 */
    if(typeof rodEndLenDragAllowed==='function'&&!rodEndLenDragAllowed(rodHov,i))return;
    /* ★★R131-32（用户：「杆固定一端后双击无法解除，第二下又出现拉伸标记」）：若这是
     *  双击的**第二下**（500ms 内、同一根杆）⇒ 不启动长度拖拽，让事件冒泡给双击
     *  解除逻辑处理——否则 rodlen 的 grab 会把第二下吃掉（stopPropagation）⇒ 解除失败。 */
    if(dblState&&dblState.body===rodHov&&dblState.t&&(performance.now()-dblState.t)<520){
      /* ★★R131-32e（用户：「双击无法解除」）：手柄会吃掉第二下的点击（主画布收不到）
       *  ⇒ **在这里直接执行解除**（该端锚定则断开），不依赖冒泡。 */
      if(typeof springDisconnectAtPoint==='function'&&springDisconnectAtPoint(pointer.x,pointer.y)){
        dblState.t=0;dblState.body=null;
      }
      return;
    }
    e.preventDefault();e.stopPropagation();
    var far=(rodHov.belt?beltEndWorld:rodEndWorld)(rodHov,1-i);   // 被拖的是 i，钉死的是 1-i
    grab={kind:'rodlen',obj:rodHov,end:i,fx:far.x,fy:far.y,t:performance.now()};
    rodHov.vx=0;rodHov.vy=0;rodHov.om=0;      // 冻结：按下即清速度（重力/残余转动不再起作用）
  });
});
// field-area RESIZE handle: drag it to grow/shrink the E square / B circle range.
// (This handler owns the handle element itself — stopPropagation keeps it off the canvas grab.)
rszHandle.addEventListener('pointerdown',function(e){
  e.preventDefault();e.stopPropagation();
  var B=hoverB;
  if(!B||(B.kind!=='E'&&B.kind!=='B'))return;
  var edge='rad',side=null;
  if(B.kind==='E'){
    var erD=B.er||{l:(B.fieldR||E_FIELD_RANGE)/2,r:(B.fieldR||E_FIELD_RANGE)/2,t:(B.fieldR||E_FIELD_RANGE)/2,b:(B.fieldR||E_FIELD_RANGE)/2};
    var pxD=pointer.x-B.x,pyD=pointer.y-B.y;
    var dL=Math.abs(pxD+erD.l),dR=Math.abs(pxD-erD.r),dT=Math.abs(pyD+erD.t),dB=Math.abs(pyD-erD.b);
    var m=Math.min(dL,dR,dT,dB);
    if(m===dL){edge='x';side='l';}
    else if(m===dR){edge='x';side='r';}
    else if(m===dT){edge='y';side='t';}
    else{edge='y';side='b';}
  }
  grab={kind:(B.kind==='E')?'resizeE':'resizeB',obj:B,lx:pointer.x,ly:pointer.y,rszEdge:edge,rszSide:side,startR:B.fieldR||((B.kind==='E')?E_FIELD_RANGE:B_FIELD_RANGE),t:performance.now()};
  rszHandle.classList.add('on');
});
cv.addEventListener('pointerdown',function(e){
  // R65：只认左键。此前右键的 pointerdown 也会走 grab/dblState —— 后果是「500ms 内在同一
  // 位置连按两次右键」被 pointerup 的 S 分支当成**双击解散**（dissolveSpring 把弹簧拆回 k/x，
  // 而 contextmenu 打开的菜单还开着、menuBody 已死）：想用菜单解除方向锁的用户，快速两次
  // 右键就会凭空拆掉弹簧。字母的 gdDown 一直有 e.button!==0 守卫，cv 是漏网的那个。
  // 右键的全部语义归 contextmenu 处理，这里不掺和。
  if(e.button!==0)return;
  // drawing tools own the canvas while they are armed — never fall through to a grab
  if(TOOL.mode==='brush'){e.preventDefault();startStroke(e);return;}
  if(TOOL.mode==='shape'){e.preventDefault();startShapeDrag(e);return;}
  // R96：器件模式 —— 每点一次就在指针处放一个（弹簧没有「拖出尺寸」这一步，所以按下即落，
  // 与形状的「按下开始拖框」不同）。连续模式下不放完就继续武装（由 TOOL.cont 决定）。
  if(TOOL.mode==='device'){
    e.preventDefault();
    var dspB=placeDevice(TOOL.device,pointer.x,pointer.y);
    if(dspB&&!TOOL.cont)setToolMode(null);
    return;
  }
  /* ★★R131-59：**按下必须先用本次事件的坐标刷新 pointer，再做命中扫描**。
   *  原来这行排在 hit 扫描**之后** ⇒ 扫描用的是**上一次移动留下的旧坐标**：
   *   · 鼠标有 hover（move 一直更新 pointer）⇒ 看不出问题；
   *   · **触屏按下前不会有任何 pointermove** ⇒ 指针是一段旧坐标（甚至上一次手指抬起的位置）
   *     ⇒ `hit` 恒空 ⇒ 摸 стояния 到画布上的物体/杆**抓不起来**（用户报的触摸"时能拖时不能拖"）。
   *  与 gdDown（5490 附近）和触摸分支的做法统一：**先进坐标，再判定**。 */
  if(e&&typeof e.clientX==='number'){pointer.x=e.clientX;pointer.y=e.clientY;}
  var hit=null;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    // R57：W 体（画出的线/空心图形）只认「线」，不认外接框的空白区。原来用 AABB 判定，
    // 于是点空心矩形正中间也能把它拖走 —— 和「只有线才是边界」的模型不一致（用户 #4）。
    // 判定与 refreshHover() 共用 nearInk()，保证「高亮得起来 = 抓得住」完全一致。
    if(B.kind==='W'){if(nearInk(B,pointer.x,pointer.y))hit=B;continue;}
    // R57 弹簧：整条线圈都是可抓区（线段 + SPR_GRAB 容差），和画笔线一样「只有线上才响应」
    if(B.kind==='S'){if(segPointDist(B.e0.x,B.e0.y,B.e1.x,B.e1.y,pointer.x,pointer.y)<SPR_GRAB)hit=B;continue;}
    var dx=pointer.x-B.x,dy=pointer.y-B.y;
    var th=B.th||0,c=Math.cos(th),s=Math.sin(th);
    var lx=c*dx+s*dy,ly=-s*dx+c*dy;
    if(Math.abs(lx)<(B.hw||30)+10&&Math.abs(ly)<(B.hh||24)+10)hit=B;
  }
  /* ★R131-27：同上——画布抓取前先按本次事件坐标刷新 pointer（触摸端跟手）；见上面的统一入口。 */
  if(typeof e.clientX==='number'){pointer.x=e.clientX;pointer.y=e.clientY;}
  /* ★R131-27 触摸版：按下即启动长按计时（450ms 未移动 ⇒ 当右键弹菜单）
   *  垃圾桶/面板上的按下不走画布触摸逻辑（垃圾桶有自己的 tap×2 清屏与拖动）。 */
  if(e.target&&(e.target.id==='trash'||(e.target.closest&&(e.target.closest('#trash')||e.target.closest('#panel')||e.target.closest('#panelToggle')))))return;
  if(uiTouch()&&e.pointerType==='touch'&&TOUCH_LETTER){
    /* ★★R132-10n（用户 2026-10-03：「手机版那个点击放置，点一下再点一下，
     *   但是无论点击哪里，放置的位置都是符号表那里」）：**这里只拦下本次按下，不做放置**。
     *
     *   旧版在这里直接调 `gdDown(..., _dl)` 走 dock 拖出分支 —— 但 dock 分支的落点取的是
     *   **面板格子的中心**（`rp=d.el.getBoundingClientRect(); cx=rp.left+rp.width/2`），
     *   它压根不看 `pointer`。于是符号被放在「面板里那个字符原本的位置」上；而 `TOUCH_LETTER`
     *   又在这里被清成 null ⇒ 后面 `pointerup` 里那条**带落点修正**的分支（7481 附近）永远
     *   不生效 —— 用户看到的就是「点哪儿都放回符号表」。
     *
     *   R131-28b 修这条路径时只改了 `pointerup` 那条（注释里也写了「不再复用 gdDown 的 dock
     *   分支」），却漏了 `cv.pointerdown` 这条**优先级更高**的老入口，两条从此打架。
     *   ⇒ 放置真源统一到 `pointerup`（DD 层，见 `TOUCH_LETTER&&!TOUCH_LETTER.dead!==false`
     *     那段：它调完 gdDown 会把 grab.obj 显式 `place` 到 `pointer`）。
     *   本分支保留 `return` 的原因：放置这一次手指不该再落进画布的 grab/长按逻辑。 */
    return;
  }
  if(uiTouch()&&e.pointerType==='touch'){
    touchLongPressStart(hit);
  }
  if(hit&&!hit.bh){
    if(dblState.body!==hit){dblState.t=0;dblState.body=hit;dblState.g=hit.massG;}
    /* ★R131-15f：x/y **每次按下都刷新**——原来只在「换物体」时记，同体连点两次时
     *  dsS.x/y 停在**很久以前**的那次按下位置 ⇒ mvdS 虚大 ⇒ 双击解散永不触发
     *  （_verify_r57 57-9 间歇 FAIL：miss1=8.3px、双击判定 mvdS 超限）。 */
    dblState.x=pointer.x;dblState.y=pointer.y;
    // R66 拖拽悬摆：抓点相对质心的偏移要存**本地系**（glx/gly）——物体转动后世界偏移 (gx/gy)
    // 会失效，本地偏移不随旋转变，抓的始终是同一块材料。
    var gth66=hit.th||0,gc66=Math.cos(gth66),gs66=Math.sin(gth66),gdx66=pointer.x-hit.x,gdy66=pointer.y-hit.y;
    grab={kind:'body',obj:hit,gx:gdx66,gy:gdy66,glx:gc66*gdx66+gs66*gdy66,gly:-gs66*gdx66+gc66*gdy66,lx:pointer.x,ly:pointer.y,t:performance.now(),svx:hit.vx,svy:hit.vy,start:pointer.x,x0:pointer.x,y0:pointer.y};
    // R94：拖拽轴向约束（被固定/被支撑端拴住时只能沿弹簧方向拖）—— 按下那一刻定死，
    // 免得拖拽过程中「支撑」状态抖动导致约束忽有忽无。null = 不约束。
    grab.ax0=hit.x;grab.ay0=hit.y;grab.axis=dragAxisLock(hit);
    grab.arc=dragArcLock(hit);   // ★R131-19b：杆宿主被抓 ⇒ 弧线拖拽参数
  }
});
// right-click a T-rod on the canvas: the rod has no letter glyphs, so the menu opens for
// the BODY itself (参数 = rod length via v/rodlen). Only T is routed here — field sources
// B/E/q/I and formula bodies are handled by their own letter contextmenu.
// R67：**命中优先级按类型分层（三趟扫描）**，不能按 bodies 的数组顺序「先到先得」。
// 旧实现一趟循环里对同一个 body 依次判 W→S→T、命中即 return，于是**先建的弹簧会抢走后建
// 物体的右键**：bodies=[W,S,W]（先画盒子 A → 再画弹簧 → 后画盒子 B 并把弹簧另一端挂上去）
// 时，右键 B 的墨线（正好贴着弹簧端点）弹出的是**弹簧**菜单，参数只剩 2 条（k / L₀），
// B 自己的 3 条（质量/摩擦/弹性）被挡住 —— 用户原话「参数没有之前那么多了，去哪里了」。
// 规则：**物体永远优先于弹簧**（贴着物体的那段线圈归物体；弹簧中段仍归弹簧自己可右键）。
// 左键拖拽**不改**（后者覆盖 = 后建的弹簧优先）—— 拖弹簧是刚需，贴着物体时抓弹簧正是
// 「拖整体」的手感，改成物体优先会让弹簧在物体附近拖不动。
cv.addEventListener('contextmenu',function(e){
  e.preventDefault();
  var ci,CB;
  // ① 画出来的物体（W）—— 只在墨线上响应，空心内部不弹菜单（与悬浮/抓取一致）
  for(ci=0;ci<bodies.length;ci++){
    CB=bodies[ci];
    if(CB.kind!=='W')continue;
    if(nearInk(CB,pointer.x,pointer.y)){openMenu(e.clientX,e.clientY,CB,null);return;}
  }
  // ② 弹簧（S）—— 整条线圈 ±SPR_GRAB 都是可点区，但只在没有物体命中时才轮到它
  for(ci=0;ci<bodies.length;ci++){
    CB=bodies[ci];
    if(CB.kind!=='S')continue;
    if(segPointDist(CB.e0.x,CB.e0.y,CB.e1.x,CB.e1.y,pointer.x,pointer.y)<SPR_GRAB){
      openMenu(e.clientX,e.clientY,CB,null);return;
    }
  }
  // ③ 细杆（T）—— 没有字母，右键弹本体菜单（参数 = 杆长）
  for(ci=0;ci<bodies.length;ci++){
    CB=bodies[ci];
    if(CB.kind!=='T')continue;
    var dx2=pointer.x-CB.x,dy2=pointer.y-CB.y;
    var thT=CB.th||0,ctT=Math.cos(thT),stT=Math.sin(thT);
    var lxT=ctT*dx2+stT*dy2,lyT=-stT*dx2+ctT*dy2;
    if(Math.abs(lxT)<=CB.len/2+8&&Math.abs(lyT)<=8){
      openMenu(e.clientX,e.clientY,CB,null);return;
    }
  }
});
DD.addEventListener('pointermove',function(e){
  pointer.x=e.clientX;pointer.y=e.clientY;
  /* ★★R131-55e（**根治"抓两次才动/时能拖时不能拖"的竞态**）：实测同一段合成手势
   *  两次运行一次成功一次失败 ⇒ 说明"按下建立了 grab、但移动时 grab 已被清掉"存在竞态。
   *  这里做**自愈**：指针按着、上一帧又没有生效的抓取、且本次按下确实命中过一个自由字符
   *  ⇒ 立刻重建 letter 抓取（只补 letter，不碰其它语义）。 */
  /* ★R131-55f：自愈条件扩展到「**不是 letter 抓取**」（残留的 body/rodlen 等也会挡住字符
   *  拖动——实测同一手势 3 次里 2 次失败就是这个原因）。只要本次按下确实命中了一个自由
   *  字符、且当前抓取不是针对它的 letter ⇒ 重建。 */
  if(false&&window.__lastDownLetter){   /* ★R131-57：自愈抓取已撤销（它可能加重竞态） */
    var _ld=window.__lastDownLetter;
    if(_ld.d&&!_ld.d.dead&&_ld.d.state!=='dock'&&(performance.now()-_ld.t)<3000){
      if(_ld.d.state!=='grab')_ld.d.state='free';
      grab={kind:'letter',obj:_ld.d,gx:_ld.x-_ld.d.wx,gy:_ld.y-_ld.d.wy,
            lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
      window.__healCount=(window.__healCount||0)+1;
    }
  }
  /* ★R131-27 触摸版：一旦移动就不是长按（长按=右键的语义要求手指不动） */
  if(TOUCH_LP){clearTimeout(TOUCH_LP);TOUCH_LP=null;}
  /* ★R131-28b：面板符号「按住拖」——待定手势移动超 12px ⇒ 执行原 dock 拖出 */
  if(window.TOUCH_PENDING){
    var _tp=window.TOUCH_PENDING;
    if(Math.hypot(e.clientX-_tp.x,e.clientY-_tp.y)>12){
      window.TOUCH_PENDING=null;
      gdDown({clientX:_tp.x,clientY:_tp.y,button:0,pointerType:'mouse'},_tp.d);
      /* 拖出后把 grab 的锚点校正到当前指针（拖出瞬间指针已移动） */
      if(grab&&grab.kind==='letter'){pointer.x=e.clientX;pointer.y=e.clientY;}
    }
    return;
  }
  // R96：器件从面板拖出 —— 优先级最高：这是唯一「按下发生在面板、移动发生在画布」的手势，
  // 后面那些分支全都是「抓画布上的东西」，一旦让它落进去就会被当成 grab。
  if(TOOL.devDrag){moveDeviceOut(e);return;}
  // R57：W 体的悬浮命中**不再在这里算**。原因见 refreshHover()：这里的判定只在 pointermove
  // 里跑，而画笔落笔期间它被 TOOL.stroke 挡掉，松手后又没有新的 pointermove —— 于是刚画完的
  // 东西指针停在上面也不亮（用户：「画笔模式下鼠标悬浮没有效果」）。改由每帧都跑的
  // refreshHover() 统一负责。
  if(TOOL.stroke){TOOL.stroke.pts.push([pointer.x,pointer.y]);return;}
  if(TOOL.drag){TOOL.drag.x1=pointer.x;TOOL.drag.y1=pointer.y;return;}
  if(trashDrag.active){
    trash.style.left=(pointer.x-17)+'px';
    trash.style.top=(pointer.y-17)+'px';
    eraseUnderTrash();
    return;
  }
  var onT=(grab.kind==='letter'||grab.kind==='body')&&inTrash(pointer.x,pointer.y);
  trash.classList.toggle('on',onT);
  if(grab.kind==='body'){
    var B=grab.obj;
    // R57 弹簧：拖动 = 平移整条弹簧 + 它拴住的宿主（用户规格④「一起拖动这个整体」）。
    // 必须在这里早退：下面那段 B.x=pointer.x-grab.gx 只认「= 指针位置」的模型，弹簧的两端
    // 由 e0/e1 决定，直接改中心会把两端信息丢掉。
    if(B.kind==='S'){
      var sdx=pointer.x-grab.lx,sdy=pointer.y-grab.ly;
      if(sdx||sdy)springMoveRig(B,sdx,sdy);
      grab.lx=pointer.x;grab.ly=pointer.y;grab.t=performance.now();
      grab.svx=0;grab.svy=0;
      cv.style.cursor='grabbing';
      return;
    }
    // R94：轴向约束（见 dragAxisLock / dragPtrAxis）。指针位置先投影成**等效指针** (epx,epy)，
    // 后半段的位置与「抓取速度」全部走等效指针 —— 否则松手那一刻会把丢掉的**法向**分量
    // 当成真实速度抛出去（位置被约束了、速度没有 = 自己打自己脸）。
    // ★stepMatter 里每帧还有一处摆放（grab.obj.kind==='W'）必须用**同一个** dragPtrAxis()，
    //   否则那处会用未投影的指针覆盖这里 —— R94 第一版就是这么失效的。
    var ep=dragPtrAxis(),epx=ep.x,epy=ep.y;
    B.x=epx-grab.gx;B.y=epy-grab.gy;
    if(B.kind==='T'){
      // R103-5（用户：「拖动杆，不能带动物体一起动？杆是连接物体的啊」）：
      // 杆是**刚体** —— 拖杆 = 平移整个装配体（已锚定的宿主跟走），与弹簧的 springMoveRig
      // 同一手感。旧实现只动杆自己：锚定端下一帧被 rodSyncAnchors 拽回宿主表面，
      // 松手后杆绕锚点甩到悬挂位 —— 用户看到的「拖不动/杆自己动」都是它。
      // ★R105-4：原来这里按「本帧指针位移」把宿主搬一次（增量跟随）。增量对**事件**负责、
      //   对**时间**不负责：指针停住不动时一个 pointermove 都没有，宿主的位姿归 Matter，
      //   于是它在子步里被重力带下去 ⇒ 实测停顿 1.5s 残差 231px（方块落地、杆留在半空），
      //   松手才被 rodSyncAnchors 拉回 = 用户报的「脱离下落 / 松手才回弹」。
      //   改成**精确投影**（rodDragPinHosts）：宿主摆到「锚点正好落在杆端」的唯一解，
      //   幂等、可重复调用 —— pointermove 与 stepMatter 的 240Hz 子步共用它，两处同一份实现。
      rodDragPinHosts(B);
      if(B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th||0);}
      grab.svx=0;grab.svy=0;
      cv.style.cursor='grabbing';
      return;
    }
    if(B.kind==='W'){
      // a boundary is dragged, never thrown: keep it reachable, kill every trace of momentum
      B.x=clamp(B.x,-B.hw*0.6,W+B.hw*0.6);
      B.y=clamp(B.y,-B.hh*0.6,groundY+B.hh*0.9);
      B.vx=0;B.vy=0;B.om=0;grab.svx=0;grab.svy=0;
      // R71⑩ 真因：原来只有「圆形」在这里累计指针速度，其它边界体每帧都被清成 0，
      // 于是 pointerup 里读到的 grab.svx 恒为 0 —— 松开带初速度的分支无论怎么写都拿不到速度。
      // 「拖拽中不攒动量」（B.vx=0）与「记录指针速度」（grab.svx）是两件事：
      // 前者保证被拖的物体老实跟手，后者只是给松开那一刻留个记录。所有边界体一律累计。
      var dtc=(performance.now()-grab.t)/1000||0.016;
      if(dtc>0){grab.svx=(epx-grab.lx)/dtc;grab.svy=(epy-grab.ly)/dtc;}
      grab.lx=epx;grab.ly=epy;grab.t=performance.now();
      cv.style.cursor='grabbing';
      return;
    }
    var dt=(performance.now()-grab.t)/1000||0.016;
    if(dt>0){
      var spx=(epx-grab.lx)/dt,spy=(epy-grab.ly)/dt;
      grab.svx=spx;grab.svy=spy;
      B.vx=spx;B.vy=spy;
    }
    grab.lx=epx;grab.ly=epy;grab.t=performance.now();
    var ft=findFreeLetterTarget(B);
    cv.style.cursor=ft?'copy':'grabbing';
  }else if(grab.kind==='letter'){
    var L=grab.obj;
    L.wx=pointer.x-grab.gx;L.wy=pointer.y-grab.gy;
    placeLetter(L);
    var dtt=(performance.now()-grab.t)/1000||0.016;
    if(dtt>0){grab.svx=(pointer.x-grab.lx)/dtt;grab.svy=(pointer.y-grab.ly)/dtt;}
    grab.lx=pointer.x;grab.ly=pointer.y;grab.t=performance.now();
    var h=findMergeTarget(L);
    cv.style.cursor=h?'copy':'default';
  }else if(grab.kind==='rot'){
    var Rb=grab.obj,s=tAnchor(Rb);
    // ABSOLUTE angle from the press point (not incremental) -> live snapping is possible:
    // within ±SNAP_DEG of a multiple of 90° the angle locks to it, and as soon as the user
    // drags out of the band it follows freely again. (Incremental snapping pinned the angle.)
    var a0=(grab.a0!=null)?grab.a0:Math.atan2(grab.ly-s.y,grab.lx-s.x);
    var th0=(grab.th0!=null)?grab.th0:(Rb.th||0);
    var a1=Math.atan2(pointer.y-s.y,pointer.x-s.x);
    var raw=th0+shortAng(a1-a0);
    var tgt=shortAng(snapAngle90(raw));   // LIVE snap while the button is still held
    // R84（用户：「高中模式下，弹簧和物体连接后，则不可再旋转弹簧，除非拆分」）：
    //   高中不能取「raw 最近的 90° 倍数」（raw 与 th0 夹角 <45° 时算回原角度 ⇒ dth=0 ⇒ 拖不动），
    //   改用「以按下时角度 th0 为基准跨一格」。推导与实测见 springRotTargetHigh。
    /* ★★R132-9m（用户：「高中模式下，怎么器件杆还是只能旋转那几个角度？是不是没和弹簧分清楚？」
     *  以及「绳子的模型改成高中模式和大学模式一样，不需要高中模式单独对绳子模型进行约束了」）：
     *  **真因就是这一行没和弹簧分清楚** —— 旧版对**所有 kind** 都用 `springRotTargetHigh`，
     *  于是高中模式下「任何**被旋转手柄操作的**物体」（器件杆 T、绳 S+rope、圆弧、圆、方块…）
     *  的目标角都被量化成 90° 整数倍 ⇒ 全场只有 4 个朝向。
     *  这与 R132-9g 在 `springRotate` 里那条 `!B.rope` 是**同一类口径错误**的两处：
     *  那边守的是「旋转手柄松手时不再吸 90°」，这边守的是「拖拽过程中目标角不被量化」。
     *  ⇒ 与 `springRotate` 完全同口径：**只有真弹簧（kind==='S' 且不是绳）**才受高中模式的
     *    轴向约束。绳、杆、弧、圆等一切其它物体在大/高中模式下行为一致。 */
    if(PHYS_MODE==='high'&&Rb.kind==='S'&&!Rb.rope)tgt=springRotTargetHigh(th0,raw);
    // R58：弹簧不认 B.th（派生量），要把角度写进端点
    // R65：seed 属于含方向锁弹簧的装配体 -> 旋转落到整个整体（含导轨朝向），返回 false 才走单体力学的旧路径
    // R101③：带子（传送带）走**量化角度**（BELT_ANG_SNAP=45° 的整数倍）+ setBeltAngle 咽喉。
    // 放在 springAssemblyRotate 之前：带子不是弹簧装配体，但它也是 W 体，必须先被认出来。
    // 拖拽期间 stepMatter 每帧还会 setAngle 兜一次姿态（那条通道保持不变）。
    /* R108：地面/墙面按用户要求吸 **45°** 整数倍（带子 BELT_ANG_SNAP 的先例同款）。
     *   面板里改角度不吸附（那是数值输入，用户说了算）。 */
    if(Rb.kind==='W'&&Rb.gnd){
      setGroundAngle(Rb,shortAng(snapAngleDeg(raw,45)));
    }else if(Rb.kind==='W'&&Rb.belt){
      setBeltAngle(Rb,shortAng(snapAngleDeg(raw,BELT_ANG_SNAP)),null);
    }else if(!springAssemblyRotate(Rb,tgt,s)){
      if(Rb.kind==='S')springRotate(Rb,tgt);else Rb.th=tgt;
    }
    grab.lx=pointer.x;grab.ly=pointer.y;
  }else if(grab.kind==='arcedit'){
    // R56：拖圆弧端点手柄——指针相对椭圆中心的角度（椭圆参数角）直接成为该端点的角度
    var Ab=grab.obj;
    if(Ab&&!Ab.dead&&Ab.ell){
      var wcA=arcWorldCenter(Ab);
      var dxA=pointer.x-wcA.x,dyA=pointer.y-wcA.y;
      // R75（用户⑫：「每 90 度倍数的角度吸附偏移了」）—— 吸附必须在**世界系**里做。
      // 旧版把 body 本地的参数角 paA=atan2(ly/ry,lx/rx) 直接喂给 snapAngle90，于是弧一旦
      // 自己转过 th（自由体落地翻滚 / 被旋转手柄拧过），吸的就是「跟着体一起斜过去的
      // 0/90/180/270」：实测 th=30° 时「世界角 − 参数角 = 恰好 30.000°」，用户看着屏幕把
      // 端点拖到正下方一点都不吸（`_diag_r76_arcsnap.py` 用例 B 全组不触发）。
      // 旋转手柄吸的是 th 本身（世界系，见上面 `grab.kind==='rot'`），两边本就该一致；
      // 且 R69 起弧恒为正圆 rx==ry，「椭圆自己那四个极值点」对圆没有意义。
      // 现在：先把指针的**世界方向角**吸附到 90° 整数倍，再换算回该椭圆上的参数角
      // —— t = atan2(sinβ/ry, cosβ/rx) 正是 pa=atan2(ly/ry,lx/rx) 的逆（rx==ry 时 t=β）。
      var waA=Math.atan2(dyA,dxA);                       // 指针相对椭圆圆心的世界方向角
      arcSetAngle(Ab,grab.end,arcParamFromWorldAng(Ab,snapAngle90(waA)));
    }
    grab.lx=pointer.x;grab.ly=pointer.y;
  }else if(grab.kind==='rodlen'){
    // R98-3：拖杆端长度手柄 —— 固定端用按下时锁存的 (fx,fy)，拖拽端 = 指针。
    // force=false：只在长度漂移超过 ROD_MIRROR_TOL 时才重建镜像板（逐像素重建会每帧造一个体）。
    var Rb2=grab.obj;
    if(Rb2&&!Rb2.dead){
      // R100⑤：宿主分派 —— 带子走 setBeltEnds（pts 实时改 + 容差重建 W 体），杆走 rodPlaceEnds。
      // ★杆**必须**走 rodPlaceEnds（索引序）而不是 setRodEnds：后者按「角色」摆（slot0=钉死端），
      //   会让**编号**在被拖的是 1 号端时左右互换。带子没有 per-end 状态、且 setBeltEnds 的长度
      //   clamp 就认「slot1 = 被拖端」这个角色，所以带子这条**保持原样**（改了反而夹错端）。
      if(Rb2.belt)setBeltEnds(Rb2,grab.fx,grab.fy,pointer.x,pointer.y,false);
      else if(Rb2.gnd)groundDragEnds(Rb2,grab,pointer.x,pointer.y,false);   // R108
      
      else rodDragEnds(Rb2,grab,pointer.x,pointer.y,false);
      Rb2.vx=0;Rb2.vy=0;Rb2.om=0;         // 位姿归指针，速度必须跟着清（否则一松手就飞）
    }
    grab.lx=pointer.x;grab.ly=pointer.y;
  }else if(grab.kind==='resizeE'||grab.kind==='resizeB'){
    var RB=grab.obj;
    if(RB.kind==='E'){
      // E: SYMMETRIC resize — the field stays centred on E. Dragging ANY edge moves the
      // OPPOSITE edge by the same amount, so both sides grow/shrink together (never a
      // lopsided box). Min 30px, max 900px per half-extent.
      var er=RB.er||{l:160,r:160,t:160,b:160};
      var ev;
      if(grab.rszSide==='l')ev=clamp(RB.x-pointer.x,30,900);
      else if(grab.rszSide==='r')ev=clamp(pointer.x-RB.x,30,900);
      else if(grab.rszSide==='t')ev=clamp(RB.y-pointer.y,30,900);
      else ev=clamp(pointer.y-RB.y,30,900);
      if(grab.rszSide==='l'||grab.rszSide==='r'){er.l=ev;er.r=ev;}
      else{er.t=ev;er.b=ev;}
      RB.er=er;
      RB.fieldR=er.l+er.r;   // keep the alias in sync (used by copy/refresh fallbacks)
    }else{
      // B: fieldR IS the circle radius — pointer distance from centre is the new radius.
      RB.fieldR=clamp(Math.hypot(pointer.x-RB.x,pointer.y-RB.y),60,700);
    }
    grab.lx=pointer.x;grab.ly=pointer.y;
  }
});
DD.addEventListener('pointerup',function(e){
  pointer.x=e.clientX;pointer.y=e.clientY;
  window.__lastDownLetter=null;
  /* ★★R131-30（用户：「物体中心移到杆端有红点但吸附不了——移动杆到中心才吸」）：
   *  松手时对**未锚定的杆端**统一跑一次吸附检测——不管这次拖的是杆还是物体，
   *  只要杆端此刻靠近某宿主就吸上（红点预览与吸附从此一致）。 */
  setTimeout(function(){
    if(grab&&grab.kind)return;
    for(var _ri=0;_ri<bodies.length;_ri++){
      var _R=bodies[_ri];
      if(_R.kind==='T'&&!_R.dead&&_R.anc&&(!_R.anc[0]||!_R.anc[1])){
        if(_R._snapCool&&performance.now()<_R._snapCool)continue;   // ★R131-32g：解除冷却
        try{rodTryAnchor(_R);}catch(_e){}
      }
    }
  },0);
  /* ★R131-27 触摸版：① 松手即取消长按计时；② **点选放置**——这一次按下没怎么动
   *  （tap）时：若已有选中体 ⇒ 把它搬到本次 tap 的位置；否则把本次 tap 命中的体
   *  标记为「已选中」（手指粗，精细拖拽难 ⇒ 用「选中→点目的地」的两步放置）。 */
  if(uiTouch()&&e.pointerType==='touch'){
    if(TOUCH_LP){clearTimeout(TOUCH_LP);TOUCH_LP=null;}
    /* ★★R132-9：`_moved` 必须量**二维距离**。原来只取 `|Δx|` ⇒ **纯竖直拖动恒被当成 tap**
     *  （Δx=0 ⇒ _moved=0 < 8 ⇒ 走「点选放置」分支、把 grab 抹掉），用户看到的就是
     *  「竖着拖物体，物体被选中了却不动」。（`_tmp_r312` 纯竖直拖 0.0px 就是这么来的。）
     * grab.x0/y0 是按下那一刻的指针（body 抓取必写）；老字段 start 兜底。 */
    var _moved=0;
    if(grab&&grab.x0!=null)_moved=Math.hypot(pointer.x-grab.x0,pointer.y-grab.y0);
    else if(grab&&grab.start!=null)_moved=Math.abs(pointer.x-grab.start);
    if(window.TOUCH_PENDING){
      /* ★R131-28b：轻点面板符号 ⇒ 面板内选中态（框+背景变色） */
      var _tpd=window.TOUCH_PENDING.d;window.TOUCH_PENDING=null;
      if(TOUCH_LETTER===_tpd){TOUCH_LETTER=null;if(_tpd.el)_tpd.el.classList.remove('touch-pick');}
      else{
        if(TOUCH_LETTER&&TOUCH_LETTER.el)TOUCH_LETTER.el.classList.remove('touch-pick');
        TOUCH_LETTER=_tpd;
        if(_tpd.el)_tpd.el.classList.add('touch-pick');
      }
      if(grab){grab.kind=null;grab.obj=null;}
      return;
    }
    /* ★R131-28b：面板符号已选中 ⇒ 点画布 = **放置到点击位置**（专用：直接 place 到
     *  pointer，不再复用 gdDown 的 dock 分支——那会把符号放在面板字符原位置旁，
     *  实测「放置在符号的旁边」✗） */
    if(TOUCH_LETTER&&!TOUCH_LETTER.dead!==false&&TOUCH_LETTER.el){
      var _dl2=TOUCH_LETTER;TOUCH_LETTER=null;
      _dl2.el.classList.remove('touch-pick');
      if(_dl2.state==='dock'){
        gdDown({clientX:pointer.x,clientY:pointer.y,button:0,pointerType:'mouse'},_dl2);
        /* gdDown 会把符号放在面板位置并进入 grab——立刻把它搬到点击位置 */
        if(grab&&grab.kind==='letter'&&grab.obj){
          place(grab.obj,pointer.x,pointer.y,0,1,true);
          grab.obj.wx=pointer.x;grab.obj.wy=pointer.y;
        }
      }
      return;
    }
    if(!(grab&&grab.kind)||_moved<8){
      if(TOUCH_SEL&&!TOUCH_SEL.dead){touchMoveSelTo(pointer.x,pointer.y);}
      else{
        var _tgt=hoverB||(typeof hit!=='undefined'?hit:null);
        if(!_tgt){
          for(var _ti=0;_ti<bodies.length;_ti++){
            var _B3=bodies[_ti];
            if(_B3&&!_B3.dead&&_B3.kind==='W'&&distToHost(_B3,pointer.x,pointer.y)<15){_tgt=_B3;break;}
          }
        }
        if(_tgt&&!_tgt.dead){
          TOUCH_SEL=_tgt;
          if(_tgt.el&&_tgt.el.classList)_tgt.el.classList.add('touch-sel');
          if(_tgt.mb)Matter.Sleeping.set(_tgt.mb,false);
        }
      }
      if(grab){grab.kind=null;grab.obj=null;}
    }
    /* ★R132-9：真正拖过（≥8px）⇒ 这次手势是「直接拖动」，把上一次 tap 留下的选中态丢掉，
       否则松手后那个旧高亮还挂着，下一次随手一点又会把旧物体搬过去（用户会以为"见鬼了"）。 */
    else if(TOUCH_SEL){touchClearSel();}
  }
  // R96：器件拖出的收尾（落点生效 / 丢回面板取消）。必须排在 trash/stroke 之前 ——
  // devDrag 与它们互斥，这里是唯一知道「这一次松手属于器件拖出」的地方。
  if(TOOL.devDrag){endDeviceOut();return;}
  if(TOOL.stroke){finishStroke();return;}
  if(TOOL.drag){finishShapeDrag();return;}
  if(trashDrag.active){
    trash.style.left='';trash.style.top='';
    trash.style.right='24px';trash.style.bottom='24px';
    trash.classList.remove('on');
    trashDrag.active=false;
    grab.kind=null;grab.obj=null;
    return;
  }
  trash.classList.remove('on');
  if(grab.kind==='body'){
    var B=grab.obj;
    if(inTrash(pointer.x,pointer.y)){
      if(B.bh){explodeBlackHole(B);}   // a live black hole dropped in the trash DETONATES
      else{killBody(B);}
      grab.kind=null;grab.obj=null;
      return;
    }
    /* ★★R132-9ze（用户 2026-10-03 的录屏 `rec_2026-10-03-05-57-33.json` 定案：
     *   「把 q 放到物体上**根本没反应**」）。
     *   画布上那个"q"其实是**场源体**（`spawnField('q')` 造的 `kind:'q'` 体），
     *   它在 `bodies[]` 里、有 `hw/hh` ⇒ 画布按下走 `grab={kind:'body'}` ⇒ **抓到的是场源体**，
     *   松手只会把它**重新摆位**，永远不会走字符的赋予分支 ⇒ 实测 `charge=undef`、毫无反应。
     *   （顺带解释了几轮定位不动的盲区：场源体**没有 Matter 体** ⇒ 录制器 `if(!mb)continue;`
     *     把它整类跳过 ⇒ 录屏里从来看不见它，只看得见那个"凭空多出来的矩形"和几次落点。）
     *   修：场源体丢到**可赋予的物体**上时执行赋予（q 给电荷 / v 给速度），并把场源体清掉；
     *   丢在空处仍然照旧「就地摆位成场源体」（原行为不变）。 */
    /* ★★R132-9zi（用户 2026-10-03：「那个符号 E 怎么又出现 bug 了，我放到物体上怎么被融合进去了？
     *   那个是场啊，还有 B 也是」）——**我上一版的 9ze 写得太宽**：把 `B/E/q/I` 都送进
     *   `attach(target, glyph)`。对 `q` 那是「赋予电荷」（对的），但 **E/B 是场**，
     *   `attach` 对它们走的是**并入 mem**（它们在公式里是合法的质量字母）⇒
     *   **场被融合进物体、场源体消失**。⇒ 收窄成**只有 q 走赋予**；
     *   E/B/I 一律落回原来的「就地摆位成场源体」语义（用户把它们放下去就是要一个场）。 */
    if(B.kind==='q'&&B.glyphs&&B.glyphs.length){
      var _tg=typeof findSolidBodyAt==='function'?findSolidBodyAt(pointer.x,pointer.y):null;
      if(_tg&&_tg!==B){
        var _gl=B.glyphs[0];
        try{
          /* ★★R132-9zp：`attach` 可能**什么都没做**（比如目标形状不在电荷白名单里 ⇒
             `R132-9zm` 的闸直接 return）—— 原来这里**无条件** `killFieldBody` ⇒
             场源体被清掉、电荷也没赋上，屏幕上「q 消失了但物体没变」（录屏 f226/f504 里
             `#1 q` 的出现→消失就是这个）。⇒ **只有 attach 真的生效了才清场源体**。 */
          var _before=bodies.length;
          attach(_tg,_gl);
          var _gave=(_gl.body===_tg)||(_tg.mem&&_tg.mem.indexOf(_gl)>=0)||(_tg.charge!=null);
          if(!_gave){/* 没生效 ⇒ 不动场源体，落回原来的摆位行为 */}
          else{killFieldBody(B,bodies.indexOf(B));grab.kind=null;grab.obj=null;return;}
        }catch(e){/* 赋予失败 ⇒ 落回原来的摆位行为 */}
      }
    }
    if(inPanel(pointer.x,pointer.y)&&!B.kind){
      // drop a formula body back onto the panel box -> its letters dock into the box
      for(var pi2=B.glyphs.length-1;pi2>=0;pi2--){if(B.glyphs[pi2].stk)killG(B.glyphs[pi2]);}
      var rl=[];if(B.massG)rl.push(B.massG);
      for(var mi3=0;mi3<B.mem.length;mi3++){if(B.mem[mi3]!==B.massG)rl.push(B.mem[mi3]);}
      for(var ri=0;ri<rl.length;ri++){
        var LG=rl[ri];
        if(LG.body===B){LG.body=null;LG.inBody=false;}
        LG.pop=0;
        dockLetter(LG);
      }
      killBody(B);
      grab.kind=null;grab.obj=null;
      return;
    }
    if(B.kind){
      // F（用户：「双击弹簧与物体的连接处可以完成二者断联」）：在任何分支的双击/解散/拆分
      // 之前，先拦截 —— 若这是同一物体的第二次点击（位移<14、间隔<500ms）且点击位置落在
      // 某个弹簧已锚定端点 SPR_PAD 范围内，就解除那一端锚定，不走默认动作。
      // W/T 分支原本无双击逻辑，下面各分支末尾会补记 dblState.t，让此拦截对它们也生效。
      var dsF=dblState,nowF=performance.now();
      /* ★★R131-32b（用户：「杆固定一端后双击无法解除」）：**T/W 分支历来不补记 dblState**
       *  ⇒ 下面的双击拦截永远看不到「第二下」（dsF.t 恒 0）⇒ 解除永不触发。先补记。 */
      if(dsF.body!==B){dsF.t=nowF;dsF.body=B;dsF.x=pointer.x;dsF.y=pointer.y;dsF.g=null;}
      window.__dblHit=(window.__dblHit||0)+1;   // 调试：双击拦截进入次数
      if(dsF.body===B&&dsF.t>0&&nowF-dsF.t<500){
        var mvdF=Math.hypot(pointer.x-dsF.x,pointer.y-dsF.y);
        if(mvdF<14&&springDisconnectAtPoint(pointer.x,pointer.y)){
          dsF.t=0;dsF.body=null;dsF.g=null;
          grab.kind=null;grab.obj=null;
          return;
        }
      }
      if(B.kind==='S'){
        // R57 弹簧：规格⑥ 双击整体 -> 解散回 k/x；规格② 非双击时松开这一刻才判定「两端
        // 端点是否碰到了别的物体」，碰到了就固定（拴住）。
        // 双击判定必须在这里自己走一遍：弹簧下面那个公共双击分支在 `if(B.kind){...}` 之外，
        // 而 S 分支历来无条件 return，于是「双击解散」这条规格永远不触发（实测实测 sp=1
        // 一直不动）。又不能顺手把 return 去掉 —— 后面的公共分支会按「普通刚体」语义给这
        // 根轻质弹簧加初速度、还会试图把它吸附到字母上。
        var dsS=dblState,nowS=performance.now();
        if(dsS.body===B){
          var mvdS=Math.hypot(pointer.x-dsS.x,pointer.y-dsS.y);
          if(mvdS<14&&dsS.t>0&&nowS-dsS.t<500){
            dsS.t=0;dsS.body=null;dsS.g=null;
            dissolveSpring(B);
            grab.kind=null;grab.obj=null;
            return;
          }
          if(mvdS<14)dsS.t=nowS;
          else{dsS.t=0;dsS.body=null;}
        }
        // 用户规格②说得很明确：只有**两端端点处**接触才算，所以判定点就是两个端点本身，
        // 线圈中段压到什么都不算（那只是支撑，不是锚）。
        springTryAnchor(B);
        B.vx=0;B.vy=0;B.om=0;
        if(inPanel(pointer.x,pointer.y)){killBody(B);grab.kind=null;grab.obj=null;return;}
        grab.kind=null;grab.obj=null;
        return;
      }
      if(B.kind==='W'){
        // 圆形像真实球：松开时若指针有速度就带着初速度滚出去（真刚体，Matter 接着算）
        if(B.wshape==='circle'&&B.rad){
          var spc=Math.hypot(grab.svx,grab.svy);
          if(spc>20){var f2c=clamp(1-spc/6000,0.5,1);B.vx=grab.svx*f2c;B.vy=grab.svy*f2c;}
          else{B.vx=0;B.vy=0;}
          // 把初速度注入 Matter 体（B.vx 只是自定义物理的变量，Matter 自己不知道）
          if(B.mb&&MW){
            Matter.Body.setVelocity(B.mb,{x:B.vx/60,y:B.vy/60});
            // R121（用户：「小球运动时的急刹」/「按照真实世界的物理规律来进行修改，符合真实物理
            //   现象就行，反正真实世界肯定不是会突然急刹这样的事儿发生的」）：
            //   松手时**必须同时**把与平动一致的**滚动自旋** ω=v/R 一起注入。
            //   为什么原来会急刹：拖拽期间产品每帧写 setVelocity(0,0)+setAngularVelocity(0)
            //   （拖体冻结），松手这一支只写线速度 ⇒ 球是**纯滑动**发射的；真实世界里用鼠标
            //   沿地面把球拖出去再松手，球是**滚**着出去的（球在地上不可能只滑不转）。
            //   纯滑动发射的球随后被接触摩擦强行拉进纯滚动 —— `_diag_r120d.py` 实测大学模式
            //   438→147px/s（只保留 **33.5%**）、80ms 内刹完，那就是用户看到的「急刹」。
            //   补上 ω 之后接触点滑移为 0 ⇒ 摩擦无事可做 ⇒ 同夹具 S2 臂实测保留 **100.0%**。
            //   ① 单位：B.vx 是 px/s（手写通道口径），Matter 的 angularVelocity = rad/帧
            //      ⇒ ω = (B.vx/60)/R（MU-01）。
            //   ② R 取**圆半径** `mb.circleRadius`（= B.rad+BND_INK，含墨迹半厚）——与
            //      10195 的 ω 镜像、5383 传带通道的 R 同一个口径，不另立常数。
            //   ③ 符号：屏幕 y 向下时「向右滚」= 正 ω（与 vx 同号，`_diag_r120d` S2 臂已实测）。
            //   ④ 空中甩出也照此注入：球的渲染只有一条 arc（12371）、**没有任何自旋标记**，
            //      所以视觉上无副作用；而落地时「已经带着匹配自旋」比「零自旋砸地再打滑」
            //      更接近人手抛出（后者正是要靠摩擦刹车的那条通道）。
            //   ⑤ 只在**圆**这一支补：其它 W 体（方块/杆/槽）没有「滚」这个自由度的对应关系，
            //      保持 ω=0 才是对的。
            var _Rv=B.mb.circleRadius||(B.rad+BND_INK);
            Matter.Body.setAngularVelocity(B.mb,B.vx/60/_Rv);
            B.om=B.vx/_Rv;                  // 同步产品侧镜像（10195 每帧会再写一遍，这里不留帧缝）
            Matter.Sleeping.set(B.mb,false);
          }
          springTryAnchorByHost(B);   // F：物体拖到弹簧端点旁也连
          if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
          grab.kind=null;grab.obj=null;
          return;
        }
      // R71⑩（用户：「除了圆形，其他的物体好像都不接受我鼠标赋予他们的速度」）：把「松开带初
        // 速度」从圆形扩到**所有**边界体。原来这一支硬写 B.vx=0;B.vy=0，注释理由是「其它边界体
        // 没有惯性，只能被拖动」—— 但 R70 起 W 体**全部**由 Matter 积分（stepPhysics 里
        // `if(B.kind==='W')continue`），它们有 mass/inertia，只是这里把指针速度丢掉了。
        // 顺带修掉用户⑨「非圆形摩擦调 0 也滑不动」：初速度恒为 0，μ 再小也无从谈起 ——
        // 两条反馈是同一个根因（抛出去 0 速度）。
        // 单位：B.vx 是 px/s（手写通道口径），Matter 的 velocity 是 px/帧 → /60，与圆形同口径。
        var spW=Math.hypot(grab.svx,grab.svy);
        if(spW>20){var f2w=clamp(1-spW/6000,0.5,1);B.vx=grab.svx*f2w;B.vy=grab.svy*f2w;}
        else{B.vx=0;B.vy=0;}
        releaseConstrainVel(B);     // R104-5/9：速度先落在绳/铰链的可行域里（见该函数）
        // R71⑯（用户：「黏附功能：弧/手绘线条接近地面且即将水平时自动吸附成与地面平滑相接」）：
        // 松手那一刻做一次「落地吸附」——满足「够近 + 够平」就把这条线的接触段转成严格水平、
        // 墨迹下缘精确贴住地面，于是它不会以某个小倾角斜戳在地上（那种姿态下一端悬空、
        // 另一端扎进地面，既不好看也让它自己慢慢滑走）。只在**低速松手**时吸附，
        // 免得把用户沿地面甩出去的弧/线当场按住（见 snapWToGround 的 spd 守卫）。
        // R73-E：force=true —— 固定过的弧/线被拖到地面附近时同样吸附（旧版被 B.fixed 挡掉）。
        /* ★★R132-9i（用户 2026-10-02：「那个圆弧自动吸附地面的功能给删了，吸附不准确，
         *  还是会卡顿，所以不要这个功能了」）：**整个功能删除**。两个调用点都已移除。 */
        if(B.mb&&MW){
          Matter.Body.setVelocity(B.mb,{x:B.vx/60,y:B.vy/60});
          Matter.Sleeping.set(B.mb,false);   // 睡着的体设速度不生效，必须先唤醒
        }
        if(inPanel(pointer.x,pointer.y)){killBody(B);grab.kind=null;grab.obj=null;return;}
        springTryAnchorByHost(B);   // F：物体拖到弹簧端点旁也连
        if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
        grab.kind=null;grab.obj=null;
        return;
      }
      // ★R104-6：杆的**另一个**自有入口 —— 拖动一根已经存在的杆，松手那一刻扫自己的两个端点。
      //   与 placeDevice 里那一句互为对称（一条管「刚放下」，一条管「拖完松手」），
      //   合起来才把「杆↔物体」两个方向都补全（旧代码只有物体→杆 那一半）。
      if(B.kind==='T'){
        rodTryAnchor(B);
        if(inPanel(pointer.x,pointer.y)){killBody(B);grab.kind=null;grab.obj=null;return;}
        // ★R104-6b（回归 `_probe_r102` D2 抓到的自伤）：这一支**必须**与上面 W / S 各支一样
        //   补记 dblState.t。双击解除的拦截在 4390（`if(B.kind){…}` 里、各 kind 分支**之前**），
        //   它的门是 `dsF.body===B && dsF.t>0 && nowF-dsF.t<500` —— t 是靠**上一次松手**在这里
        //   装填的（pointerdown 只在 body 变化时才清 t，所以同一物体的第二次点击 t 还在）。
        //   本支 6a 第一版直接 return 掉，t 永远为 0 ⇒ 杆的双击解除**永远不触发**
        //   （实测 r102 D2：双击锚定端后 anc 仍剩 1 条）。W 支在 4470 有这句、S 支在 4410
        //   自走一遍，只有新加的 T 支漏了 —— 「新增分支要跟着复制收尾动作」的典型。
        if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
        grab.kind=null;grab.obj=null;
        return;
      }
      // spawned field symbol (B/q/I) dragged back onto the panel box -> remove it
      if(inPanel(pointer.x,pointer.y)){
        killBody(B);
        grab.kind=null;grab.obj=null;
        return;
      }
      var sp2=Math.hypot(grab.svx,grab.svy);
      if(sp2>20){var f2=clamp(1-sp2/6000,0.5,1);B.vx=grab.svx*f2;B.vy=grab.svy*f2;}
      else{B.vx=0;B.vy=0;}
      releaseConstrainVel(B);       // R104-5/9：速度先落在绳/铰链的可行域里（见该函数）
      springTryAnchorByHost(B);   // F：物体拖到弹簧端点旁也连（弧/字母/标尺等）
      if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
      grab.kind=null;grab.obj=null;
      return;
    }
    var ds=dblState;
    var didSplit=false;
    if(ds.body===B){
      var mvd=Math.hypot(pointer.x-ds.x,pointer.y-ds.y);
      var now=performance.now();
      if(mvd<14){
        if(ds.t>0&&now-ds.t<500){
          // F：双击弹簧与物体的连接处断联 —— 先检查是否落在已锚定端点附近
          if(springDisconnectAtPoint(pointer.x,pointer.y)){
            ds.t=0;ds.body=null;ds.g=null;
            grab.kind=null;grab.obj=null;
            return;
          }
          // R57 弹簧：双击整体 -> 解散变回 k / x（其余物体维持原有的「双击拆分」语义）
          if(B.kind==='S')dissolveSpring(B);else splitOne(B,ds.g);
          ds.t=0;ds.body=null;ds.g=null;
          didSplit=true;
        }else{
          ds.t=now;ds.x=pointer.x;ds.y=pointer.y;
        }
      }else{
        ds.t=0;ds.body=null;
      }
    }
    if(didSplit){
      grab.kind=null;grab.obj=null;
      return;
    }
    if(Math.abs(grab.svx)>20||Math.abs(grab.svy)>20){
      var f=clamp(1-Math.hypot(grab.svx,grab.svy)/6000,0.5,1);
      B.vx=grab.svx*f;B.vy=grab.svy*f;
    }else{
      B.vx=0;B.vy=0;
    }
    var fl=findFreeLetterTarget(B);
    if(fl){attach(B,fl);}
  }else if(grab.kind==='letter'){
    dblState.t=0;
    var L=grab.obj;
    if(inTrash(pointer.x,pointer.y)){
      killLetter(L);
      grab.kind=null;grab.obj=null;
      return;
    }
    if(inPanel(pointer.x,pointer.y)){
      // dropped back onto the panel box -> returns to box and disappears
      killLetter(L);
      grab.kind=null;grab.obj=null;
      return;
    }
    /* ★★R131-38（用户：「q 放到物体上没反应、不能赋予电荷」）：q 原本**被场源分支抢先**
     *  （B/E/q/I 松手即 spawnField 生成场源体）⇒ 永远走不到赋予。修：**q 落在实心物体上
     *  优先赋予电荷**；只有落在空白处时才生成场源（原行为不变）。 */
    /* ★★R132 BOSS：**光速 v** 落到 ½mv² 上 ⇒ 走 bossPlace（前两次排斥、第三次融合）。
     *  必须放在 findSolidBodyAt 之前 —— ½mv² 是动态体，会被 findSolidBodyAt 命中并送进
     *  attach()，而 attach 对「表达式」目标是**无条件并入 mem**（½mv² 的 mem 已是 3 项，
     *  v 一进去公式就毁了）。这里按 bossIsEk() 精确判型后抢在它前面分流。 */
    if(L.ch==='v'&&L.vLight&&typeof bossFindEkNear==='function'){
      var _ek=bossFindEkNear(pointer.x,pointer.y);
      if(_ek){bossPlace(_ek,L);grab.kind=null;grab.obj=null;return;}
    }
    if(L.ch==='q'&&typeof findSolidBodyAt==='function'){
      var _qb=findSolidBodyAt(pointer.x,pointer.y);
      /* ★R132-9zl：命中了但**形状不在电荷白名单**（圆轨/凹槽/手绘笔画…）⇒ 不赋予，
         落到下面的场源体分支（生成 q 场源体）—— 绝不并进物体（见 attach 里的 R132-9zm）。 */
      if(_qb&&qGiveable(_qb)){attach(_qb,L);grab.kind=null;grab.obj=null;return;}
      /* ★★R132-9zc（用户 2026-10-03：「你对比一下字符 q 和字符 v，为什么 v 可以，而 q 不行」——
         对比出来的**结构性不对称**就在这里）：命中失败后 **v 会继续往下走**
         （`findTComboTarget` → `findKXCombo` → 再判一次实心命中 → `findMergeTarget`
         → `findFreeMassTarget`），而 **q 在下面那个 `spawnField('q')` 分支里被直接 `return`
         截断** ⇒ `findMergeTarget` 这条通道 **q 永远走不到** ⇒ 同一个落点、同一类目标，
         **v 融得进去、q 融不进去**。
         修：q 在生成场源体**之前**先拿一次 `findMergeTarget`（与 v 完全同序）。
         ★场源体那条兜底**保留**：真的没有任何目标时，q 仍然照旧变成场源体（原行为不变）。 */
      var _qm=(typeof findMergeTarget==='function')?findMergeTarget(L):null;
      if(_qm){attach(_qm,L);grab.kind=null;grab.obj=null;return;}
    }
    if(L.ch==='B'||L.ch==='q'||L.ch==='I'||L.ch==='E'){
      spawnField(L.ch,L.wx,L.wy,grab.svx||0,grab.svy||0);
      killLetter(L);
      grab.kind=null;grab.obj=null;
      return;
    }
    // 't' combos: qt -> I, gt -> v, vt -> rod (hijacks a simple body)
    var tc=findTComboTarget(L);
    if(tc){applyTCombo(L,tc);grab.kind=null;grab.obj=null;return;}
    // R57（用户 #7/#8）：k 与 x 拼起来 = 弹簧（不分先后，见 findKXCombo）
    var sc=findKXCombo(L);
    if(sc){applyKXCombo(L,sc);grab.kind=null;grab.obj=null;return;}
    /* ★R131-36：**赋予型字符（v/q）**拖到实心物体上就生效——纯形状（没有质量字母的
     *  方块/圆）在 canMerge 规则下不接收参数字母（实测 canMerge=false ⇒ 拖上去毫无反应），
     *  但「赋予」不需要并入物体 ⇒ 单独按**实心区域命中**判定。 */
    if((L.ch==='v'||L.ch==='q'||L.ch==='a')&&typeof findSolidBodyAt==='function'){
      var _sb=findSolidBodyAt(pointer.x,pointer.y);
      if(_sb){attach(_sb,L);grab.kind=null;grab.obj=null;return;}
    }
    var B2=findMergeTarget(L);
    if(B2){
      attach(B2,L);
    }else{
      // shatter/split leaves letters FREE on the canvas. A loose mass (m/M) must still work
      // as a base: promote it to a body right here, then merge the dragged letter into it.
      // (mc, mg, mv, mG, Mm … all assemble again without a manual nudge.)
      var FM=findFreeMassTarget(L);
      if(FM){
        var fi3=freeL.indexOf(FM);if(fi3>=0)freeL.splice(fi3,1);
        var nb3=BODY(FM.wx,FM.wy);
        FM.pop=0;FM.body=nb3;FM.inBody=true;
        nb3.massG=FM;nb3.glyphs=[FM];
        refresh(nb3);
        if(canMerge(nb3,L)){
          attach(nb3,L);
          ringGo(nb3.x,nb3.y);
        }else{
          // not a valid merge after all — undo the promotion and keep the old behaviour
          var ri3=bodies.indexOf(nb3);if(ri3>=0)bodies.splice(ri3,1);
          FM.body=null;FM.inBody=false;FM.pop=0;
          if(freeL.indexOf(FM)<0)freeL.push(FM);
          placeLetter(FM);
          if(isMass(L)||L.type==='G'){
            var nb=BODY(L.wx,L.wy);
            L.pop=0;L.body=nb;L.inBody=true;
            if(isMass(L)){ nb.massG=L; nb.glyphs=[L]; refresh(nb); }
            else { nb.glyphs=[L]; attach(nb,L); }
            ringGo(nb.x,nb.y);
          }else{
            L.state='free';
            var spd=Math.hypot(grab.svx,grab.svy);
            if(spd>40){L.vx=grab.svx*clamp(1-spd/8000,0.4,1);L.vy=grab.svy*clamp(1-spd/8000,0.4,1);}
            else{L.vx=0;L.vy=0;}
            if(freeL.indexOf(L)<0)freeL.push(L);
            placeLetter(L);
          }
        }
      }else if(isMass(L)||L.type==='G'){
      // no body nearby accepts it -> spawn a fresh body here.
      // Masses become the base (massG); G is routed through attach() so it lands in
      // mem (setF/layoutGrav read G from mem, not massG).
      var nb=BODY(L.wx,L.wy);
      L.pop=0;L.body=nb;L.inBody=true;
      if(isMass(L)){ nb.massG=L; nb.glyphs=[L]; refresh(nb); }
      else { nb.glyphs=[L]; attach(nb,L); }
      ringGo(nb.x,nb.y);
    }else{
      L.state='free';
      var spd=Math.hypot(grab.svx,grab.svy);
      if(spd>40){L.vx=grab.svx*clamp(1-spd/8000,0.4,1);L.vy=grab.svy*clamp(1-spd/8000,0.4,1);}
      else{L.vx=0;L.vy=0;}
      if(freeL.indexOf(L)<0)freeL.push(L);
      placeLetter(L);
    }
    }
    cv.style.cursor='default';
  }else if(grab.kind==='rot'){
    // release: snap the angle to the nearest 90° multiple if within the snap band.
    // (Snapping only on RELEASE avoids freezing the drag — per-step snapping would pin
    // the angle at the initial multiple when dragging in small increments.)
    if(grab.obj){
      var RbU=grab.obj;
      // R65：方向锁装配体 -> 松手吸附也落到整个整体（同一套 springAssemblyRotate，幂等）
      if(springLockedAsmOf(RbU)){
        springAssemblyRotate(RbU,shortAng(snapAngle90(RbU.th)),tAnchor(RbU));
      }else{
        RbU.th=shortAng(snapAngle90(RbU.th));
        // R58：弹簧松手时同样要落到端点上（B.th 是派生量，改它没用）
        if(RbU.kind==='S')springRotate(RbU,RbU.th);
      }
      // R56：W 边界的角度必须写进 Matter 本体——stepMatter 每帧用 mb.angle 覆写 B.th，
      // 不写回的话松手时的 90° 吸附会被弹回旧角度。
      if(RbU.kind==='W'&&RbU.mb){
        Matter.Body.setAngle(RbU.mb,RbU.th);
        Matter.Body.setAngularVelocity(RbU.mb,0);
        Matter.Sleeping.set(RbU.mb,false);
      }
    }
  }else if(grab.kind==='arcedit'){
    // R57：松开弧端点手柄——解除「编辑固定」。如果用户之前右键固定过（B.fixed）就继续保持
    // static，否则恢复动态，让弧继续按重力/碰撞正常运动。_snap 复位，静置检测重新计时。
    var Ab3=grab.obj;
    if(Ab3&&!Ab3.dead){
      Ab3.editLock=false;
      // R62：松手时再吸附一次（和旋转手柄同一约定），保证「拖到 90° 整数倍附近松手」一定落正。
      // 拖动中已经实时吸附过，这里是幂等兜底 —— 覆盖「最后一次 pointermove 落在带外/带内
      // 边界」这类只在松手那一刻才确定的时序。
      // R75：兜底同样走**世界系**（arcEndWorldAng/arcParamFromWorldAng）—— 旧版在这里吸
      // 本地的 a0/a1，th≠0 时会把拖动中已经吸正的世界方向又拧回去。
      if(Ab3.ell)arcSetAngle(Ab3,grab.end,
                             arcParamFromWorldAng(Ab3,
                               snapAngle90(arcEndWorldAng(Ab3,grab.end))));
      if(Ab3.mb){
        if(!Ab3.fixed)Matter.Body.setStatic(Ab3.mb,false);
        Matter.Sleeping.set(Ab3.mb,false);
      }
      Ab3._snap=null;
    }
  }else if(grab.kind==='rodlen'){
    // R98-3：松手 —— 按最后一次指针位置**无条件重建**镜像板（force=true），
    // 保证「松手瞬间的长度」就是碰撞板的真实长度（拖动中为省开销允许 6px 容差漂移）。
    var Rb4=grab.obj;
    if(Rb4&&!Rb4.dead){
      if(Rb4.belt)setBeltEnds(Rb4,grab.fx,grab.fy,pointer.x,pointer.y,true);
      else if(Rb4.gnd)groundDragEnds(Rb4,grab,pointer.x,pointer.y,true);   // R108：地面器件
      else rodDragEnds(Rb4,grab,pointer.x,pointer.y,true);      // 同 pointermove：杆按索引摆
      Rb4.vx=0;Rb4.vy=0;Rb4.om=0;
      if(Rb4.mb&&Matter.Sleeping)Matter.Sleeping.set(Rb4.mb,false);
    }
  }else if(grab.kind==='resizeE'||grab.kind==='resizeB'){
    // release: nothing cached — fieldR already applied live during move
  }
  grab.kind=null;grab.obj=null;
});
DD.addEventListener('pointercancel',function(){
  if(grab.kind==='letter'&&grab.obj){
    var L=grab.obj;
    L.state='free';
    if(freeL.indexOf(L)<0)freeL.push(L);
    placeLetter(L);
  }
  rszHandle.classList.remove('on');
  cv.classList.remove('cur-ew','cur-ns');
  grab.kind=null;grab.obj=null;cv.style.cursor='default';
});
