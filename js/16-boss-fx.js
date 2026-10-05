/* 碎片精确飞向槽位，到达时点亮对应字符 */
(function(){
  var FRAGS=[], G=2600, started=false, ph2="idle", SHOCKS=[];
  var asmQ=[], asmActive=[], asmT=0, INTV=0.012, DUR=1.5;
  var css=document.createElement("style");
  css.textContent=".bossfrag{position:fixed;z-index:39;pointer-events:none;left:0;top:0;transform:translate(-50%,-50%) rotate(var(--r,0deg));opacity:1;white-space:nowrap;font-family:Georgia,Times New Roman,serif;color:#26221C;text-shadow:0 1px 0 rgba(255,255,255,.25)}"
    +".bossshock{position:fixed;z-index:38;pointer-events:none;border-radius:50%;left:0;top:0;transform:translate(-50%,-50%);border:3px solid rgba(0,0,0,.7);box-shadow:0 0 20px rgba(0,0,0,.25),inset 0 0 10px rgba(0,0,0,.12)}"
    +".boss-notrans .bcharg{transition:none!important}";
  document.head.appendChild(css);
  function measure(){
    document.body.classList.add("boss-notrans");
    for(var i=0;i<BOSS.chars.length;i++){var ce=BOSS.chars[i];
      if(ce.classList.contains("on"))continue;
      ce.style.setProperty("--dx","0px");ce.style.setProperty("--dy","0px");}
    void document.body.offsetWidth;
    var slots=[];
    for(i=0;i<BOSS.chars.length;i++){
      if(BOSS.chars[i].classList.contains("on")){slots.push(null);continue;}
      var r=BOSS.chars[i].getBoundingClientRect();
      slots.push({x:r.left+r.width/2,y:r.top+r.height/2,fs:getComputedStyle(BOSS.chars[i]).fontSize});}
    return slots;
  }
  function startShrapnel(){
    var slots=measure(),i,cx=W/2,cy=BOSS.y||BOSS.y1||(H*0.25);
    var gy=groundY;
    for(i=0;i<slots.length;i++){
      var ce=BOSS.chars[i];
      if(ce.classList.contains("on")||!slots[i]){FRAGS.push({ce:ce,hasFrag:false});continue;}
      if(Math.random()>=0.28){FRAGS.push({ce:ce,hasFrag:false});continue;}
      var _u=Math.max(1e-10,Math.random()),_v=Math.random();
      var _z=Math.sqrt(-2*Math.log(_u))*Math.cos(2*Math.PI*_v);
      var tx=cx+_z*380; if(tx<20)tx=20; if(tx>W-20)tx=W-20;
      var ty=gy-8-Math.random()*26;
      var el=document.createElement("div");el.className="bossfrag";
      el.textContent=(ce.textContent||"");el.style.fontSize=slots[i].fs;
      el.style.setProperty("--r","0deg");document.body.appendChild(el);
      FRAGS.push({el:el,ce:ce,x:cx,y:cy,vx:(tx-cx)*(0.95+Math.random()*0.15)/0.78,
        vy:-(240+Math.random()*200),rot:0,vr:(Math.random()*2-1)*460,
        bounces:0,settled:false,tx:tx,ty:ty,
        sr:(Math.random()<0.5?-1:1)*(18+Math.random()*57),hasFrag:true});
    }
    BOSS.__fragT=0;
    startShockwave(cx,cy);
  }
  function startShockwave(cx,cy){
    var rings=[{dur:0.45,maxR:240,op:0.85,bw:4,delay:0},
      {dur:0.75,maxR:420,op:0.55,bw:3,delay:0.06},
      {dur:1.05,maxR:600,op:0.30,bw:2,delay:0.14}];
    for(var i=0;i<rings.length;i++){var c=rings[i];
      var el=document.createElement("div");el.className="bossshock";
      el.style.left=cx+"px";el.style.top=cy+"px";
      el.style.width="0px";el.style.height="0px";el.style.opacity=0;
      document.body.appendChild(el);
      SHOCKS.push({el:el,t:0,dur:c.dur,maxR:c.maxR,op:c.op,bw:c.bw,delay:c.delay});}
  }
  function stepShockwave(dt){
    for(var i=SHOCKS.length-1;i>=0;i--){var s=SHOCKS[i];
      s.t+=dt; if(s.t<s.delay)continue;
      var p=Math.min(1,(s.t-s.delay)/s.dur);
      var e=1-Math.pow(1-p,3);
      var r=s.maxR*e,d=r*2;
      s.el.style.width=d.toFixed(1)+"px";s.el.style.height=d.toFixed(1)+"px";
      s.el.style.opacity=((1-p)*s.op).toFixed(3);
      s.el.style.borderWidth=(s.bw*(1-p*0.6)).toFixed(2)+"px";
      if(p>=1){if(s.el.parentNode)s.el.parentNode.removeChild(s.el);SHOCKS.splice(i,1);}}
  }
  function stepShrapnel(dt){
    var T=1.8;BOSS.__fragT+=dt;
    stepShockwave(dt);
    for(var i=0;i<FRAGS.length;i++){var f=FRAGS[i];
      if(!f.hasFrag||f.settled)continue;
      f.vy+=G*dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.rot+=f.vr*dt;
      var floor=f.ty-6;
      if(f.y>=floor){f.y=floor;
        if(f.bounces<2&&Math.abs(f.vy)>60){f.bounces++;f.vy=-f.vy*0.25;f.vx*=0.40;f.vr*=-0.2;}
        else{f.settled=true;f.x+=(f.tx-f.x)*0.45;f.y=f.ty;f.rot=f.sr;f.vx=0;f.vy=0;f.vr=0;}}
      f.el.style.left=f.x.toFixed(1)+"px";f.el.style.top=f.y.toFixed(1)+"px";
      f.el.style.setProperty("--r",f.rot.toFixed(1)+"deg");}
    if(BOSS.__fragT>=T){document.body.classList.remove("boss-notrans");buildAsmQueue();ph2="assemble";BOSS.ph="assemble";BOSS.t=0;}
  }
  function buildAsmQueue(){
    var gy=groundY;
    for(var i=0;i<BOSS.chars.length;i++){
      var ce=BOSS.chars[i];
      if(ce.classList.contains("on"))continue;
      var frag=null;
      for(var j=0;j<FRAGS.length;j++)if(FRAGS[j].ce===ce&&FRAGS[j].hasFrag){frag=FRAGS[j];break;}
      if(frag){var _fx=frag.x,_fy=frag.y;
        if(!isFinite(_fx))_fx=W/2; if(_fx<-400)_fx=-400; if(_fx>W+400)_fx=W+400;
        if(!isFinite(_fy))_fy=gy; if(_fy<0)_fy=0; if(_fy>H)_fy=H;
        asmQ.push({ce:ce,fromX:_fx,fromY:_fy,fromRot:frag.rot,fs:frag.el.style.fontSize,el:frag.el});}
      else{var fromLeft=Math.random()<0.5;
        asmQ.push({ce:ce,fromX:fromLeft?-(200+Math.random()*180):(W+200+Math.random()*180),
          fromY:gy-20-Math.random()*40,fromRot:0,fs:getComputedStyle(ce).fontSize,el:null});}
    }
    asmT=0;
  }
  function stepAssemble(dt){
    asmT+=dt;
    while(asmQ.length>0&&asmT>=INTV){
      asmT-=INTV;var item=asmQ.shift();
      var r=item.ce.getBoundingClientRect();var tx=r.left+r.width/2,ty=r.top+r.height/2;
      if(!isFinite(tx))tx=W/2; if(!isFinite(ty))ty=groundY;
      var el=item.el;
      if(!el){el=document.createElement("div");el.className="bossfrag";
        el.textContent=(item.ce.textContent||"");el.style.fontSize=item.fs;
        el.style.setProperty("--r","0deg");document.body.appendChild(el);}
      el.style.left=item.fromX.toFixed(1)+"px";el.style.top=item.fromY.toFixed(1)+"px";
      el.style.setProperty("--r",item.fromRot.toFixed(1)+"deg");
      asmActive.push({el:el,ce:item.ce,fromX:item.fromX,fromY:item.fromY,
        fromRot:item.fromRot,tx:tx,ty:ty,t:0,dur:DUR});
    }
    for(var i=asmActive.length-1;i>=0;i--){
      var f=asmActive[i];f.t+=dt;
      var p=Math.min(1,f.t/f.dur);
      var e=p<0.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
      var _nx=f.fromX+(f.tx-f.fromX)*e,_ny=f.fromY+(f.ty-f.fromY)*e;
      if(!isFinite(_nx))_nx=f.fromX; if(!isFinite(_ny))_ny=f.fromY;
      f.el.style.left=_nx.toFixed(1)+"px";f.el.style.top=_ny.toFixed(1)+"px";
      f.el.style.setProperty("--r",(f.fromRot*(1-e)).toFixed(1)+"deg");
      if(p>=1){f.ce.classList.add("on");
        if(f.el.parentNode)f.el.parentNode.removeChild(f.el);
        asmActive.splice(i,1);BOSS.reveal=(BOSS.reveal||0)+1;}
    }
    if(asmQ.length===0&&asmActive.length===0){
      BOSS.reveal=BOSS.chars.length;ph2="done";BOSS.ph="platform";BOSS.t=0;
      for(var k=0;k<FRAGS.length;k++)if(FRAGS[k].el&&FRAGS[k].el.parentNode)FRAGS[k].el.parentNode.removeChild(FRAGS[k].el);
      for(var m=0;m<SHOCKS.length;m++)if(SHOCKS[m].el&&SHOCKS[m].el.parentNode)SHOCKS[m].el.parentNode.removeChild(SHOCKS[m].el);
      FRAGS=[];asmActive=[];asmQ=[];SHOCKS=[];started=false;document.body.classList.remove("boss-notrans");}
    BOSS.platT+=dt;
    bossPlatLayout();
  }
  function myStep(){
    if(!BOSS){
      for(var i=0;i<FRAGS.length;i++)if(FRAGS[i].el&&FRAGS[i].el.parentNode)FRAGS[i].el.parentNode.removeChild(FRAGS[i].el);
      for(var j=asmActive.length-1;j>=0;j--)if(asmActive[j].el.parentNode)asmActive[j].el.parentNode.removeChild(asmActive[j].el);
      for(var m=0;m<SHOCKS.length;m++)if(SHOCKS[m].el&&SHOCKS[m].el.parentNode)SHOCKS[m].el.parentNode.removeChild(SHOCKS[m].el);
      FRAGS=[];asmActive=[];asmQ=[];SHOCKS=[];started=false;ph2="idle";document.body.classList.remove("boss-notrans");return;}
    if(!started&&BOSS.ph==="shake"&&BOSS.chars&&BOSS.chars.length){
      started=true;startShrapnel();ph2="shrapnel";}
    if(ph2==="shrapnel"){BOSS.ph="shrapnel";stepShrapnel(1/60);}
    else if(ph2==="assemble"){BOSS.ph="assemble";stepAssemble(1/60);}
  }
  function loop(){requestAnimationFrame(loop);myStep();}
  loop();
})();
