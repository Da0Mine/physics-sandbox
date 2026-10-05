/* 粒子与屏幕震动 */
import { particles } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { cvx } from '../render/render.js';

export let shakeAmp=0, shakeDur=0, shakeT=0, shakeOn=false;
export function shake(a,d){shakeAmp=Math.max(shakeAmp,a);shakeDur=Math.max(shakeDur,d);shakeT=0;shakeOn=true;}
export function stepParticles(dt){
  for(var i=particles.length-1;i>=0;i--){
    var p=particles[i];
    p.age+=dt;
    var damp=Math.pow(0.35,dt);
    p.vx*=damp;p.vy*=damp;
    p.x+=p.vx*dt;p.y+=p.vy*dt;
    p.alpha=Math.max(0,1-p.age/p.life);
    if(p.age>=p.life)particles.splice(i,1);
  }
}
export function spawnExplosion(cx,cy){
  var N=240;
  for(var i=0;i<N;i++){
    var ang=Math.random()*6.2832;
    var sp=120+Math.random()*820;
    var r=1+Math.random()*2.4;
    particles.push({x:cx+(Math.random()*10-5),y:cy+(Math.random()*10-5),vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,age:0,life:0.9+Math.random()*1.1,r:r,alpha:1});
  }
}
export function burstParticles(cx,cy,n,sp){
  for(var i=0;i<n;i++){
    var ang=Math.random()*6.2832;
    var v=140+Math.random()*320*sp;
    particles.push({x:cx+(Math.random()*16-8),y:cy+(Math.random()*16-8),vx:Math.cos(ang)*v,vy:Math.sin(ang)*v,age:0,life:0.7+Math.random()*0.8,r:1.2+Math.random()*2.2,alpha:1});
  }
}
export function drawParticles(){
  for(var i=0;i<particles.length;i++){
    var p=particles[i];
    cvx.fillStyle=p.hot?('rgba(255,224,150,'+p.alpha+')'):('rgba(38,34,28,'+p.alpha+')');
    cvx.beginPath();cvx.arc(p.x,p.y,p.r,0,6.2832);cvx.fill();
  }
}
export function stepShake(dt){
  if(!shakeOn)return;
  shakeT+=dt;
  var k=clamp(1-shakeT/shakeDur,0,1);
  var a=shakeAmp*k;
  var dx=(Math.random()*2-1)*a;
  var dy=(Math.random()*2-1)*a;
  document.body.style.transform='translate('+dx+'px,'+dy+'px)';
  if(shakeT>=shakeDur){document.body.style.transform='';shakeOn=false;shakeAmp=0;shakeDur=0;}
}
