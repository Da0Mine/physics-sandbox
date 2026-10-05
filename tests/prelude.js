/* Deterministic environment for regression runs: virtual clock, seeded RNG, manual frame stepping. */
(function(){
  try{localStorage.clear();sessionStorage.clear();}catch(e){}
  var seed=0x9E3779B9;
  Math.random=function(){seed=(seed+0x6D2B79F5)|0;var t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
  var now=1000,raf=[],rid=0,timers=[],tid=0;
  performance.now=function(){return now;};
  var RD=Date,BASE=1700000000000;
  Date.now=function(){return BASE+Math.round(now);};
  window.Date=function(a,b,c,d,e,f,g){ if(!(this instanceof window.Date))return new RD(BASE+now).toString(); return arguments.length?new (Function.prototype.bind.apply(RD,[null].concat([].slice.call(arguments))))():new RD(BASE+Math.round(now)); };
  window.Date.now=Date.now; window.Date.UTC=RD.UTC; window.Date.parse=RD.parse; window.Date.prototype=RD.prototype;
  window.requestAnimationFrame=function(cb){raf.push({id:++rid,cb:cb});return rid;};
  window.cancelAnimationFrame=function(id){raf=raf.filter(function(r){return r.id!==id;});};
  function addTimer(cb,ms,args,rep){timers.push({id:++tid,t:now+Math.max(0,+ms||0),ms:+ms||0,cb:cb,a:args,rep:rep});return tid;}
  window.setTimeout=function(cb,ms){return addTimer(cb,ms,[].slice.call(arguments,2),false);};
  window.setInterval=function(cb,ms){return addTimer(cb,ms,[].slice.call(arguments,2),true);};
  window.clearTimeout=window.clearInterval=function(id){timers=timers.filter(function(x){return x.id!==id;});};
  function runTimers(){
    for(;;){var due=timers.filter(function(x){return x.t<=now;}); if(!due.length)return;
      due.sort(function(a,b){return a.t-b.t||a.id-b.id;}); var x=due[0];
      if(x.rep)x.t+=Math.max(1,x.ms); else timers=timers.filter(function(y){return y!==x;});
      if(typeof x.cb==='function'){try{x.cb.apply(window,x.a);}catch(e){console.error('timer exception: '+(e&&e.message));}}}
  }
  function fnv(h,s){for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function canvasHash(){var cv=document.getElementById('cv');if(!cv||!cv.width)return 0;
    var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data,h=2166136261;
    for(var i=0;i<d.length;i+=4){h^=d[i]|(d[i+1]<<8)|(d[i+2]<<16)|(d[i+3]<<24);h=Math.imul(h,16777619);}return h>>>0;}
  function domHash(){var b=document.body.cloneNode(true);var c=b.querySelector('#cv');if(c)c.remove();
    b.querySelectorAll('script').forEach(function(s){s.remove();});return fnv(2166136261,b.innerHTML.replace(/>\s+</g,'><').trim());}
  window.__H={
    frame:function(){now+=1000/60;runTimers();var q=raf;raf=[];for(var i=0;i<q.length;i++){try{q[i].cb(now);}catch(e){console.error('frame exception: '+(e&&e.message));}}},
    step:function(n,every){var out=[];for(var i=0;i<n;i++){this.frame();if(every&&(i+1)%every===0)out.push(canvasHash()+':'+domHash());}return out;},
    sample:function(){return canvasHash()+':'+domHash();},
    dom:function(){var b=document.body.cloneNode(true);var c=b.querySelector('#cv');if(c)c.remove();b.querySelectorAll('script').forEach(function(s){s.remove();});return b.innerHTML;},
    now:function(){return now;}
  };
  var st=document.createElement('style');st.textContent='*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';
  document.documentElement.appendChild(st);
})();
