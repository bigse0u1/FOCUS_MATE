/**
 * fm:metrics → 상태판정(집중/전환/산만/피로/졸음) → fm:state
 * 악화상태만 토스트 알림(쿨다운 5분)
 */
import { notify, toastByState } from "../ui/toast";
type FMState='focus'|'transition'|'distract'|'fatigue'|'drowsy';
let cur:FMState='transition';
let lastEmit=0;

window.addEventListener("fm:metrics",(e:any)=>{
  const det=e.detail;
  const now=Date.now();
  if(now-lastEmit<900)return; // ~1Hz
  lastEmit=now;

  const ear=det.ear?.avg||0;
  const T=det.ear?.T||0.22;
  const P=det.perclos?.ratio||0;
  const BD=det.blink?.durationSec||0;

  let next:FMState='transition',score=60;
  if(ear<T && P>0.3){ next='drowsy'; score=20; }
  else if(P>=0.4 || BD>=0.45){ next='fatigue'; score=40; }
  else{
    const fix=(1-P)*100;
    if(fix>=70){ next='focus'; score=85; }
    else if(fix>=40){ next='transition'; score=65; }
    else{ next='distract'; score=45; }
  }

  cur=next;
  const payload={ts:now,state:cur,score,reason:{ear,P,BD}};
  window.dispatchEvent(new CustomEvent("fm:state",{detail:payload}));

  if(['distract','fatigue','drowsy'].includes(cur)){
    const t=toastByState[cur];
    if(t) notify(t.msg,t.color,cur,5*60*1000);
  }
});
