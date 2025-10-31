/**
 * fm:vision → EAR/깜빡임/PERCLOS 계산 → fm:metrics
 * + 10초 캘리브레이션(runCalibration)
 */
type Pt = {x:number,y:number};
type VisionEvt = { ts:number; fps:number; left:{pts:Pt[]}; right:{pts:Pt[]}; conf:number; valid:boolean };

const S = {
  ear0: Number(localStorage.getItem('fm_ear0')||0) || 0,
  lastEAR: 0,
  blinkOn: false,
  blinkStart: 0,
  perclosBuf: [] as number[],
};

function dist(a:Pt,b:Pt){const dx=a.x-b.x,dy=a.y-b.y;return Math.hypot(dx,dy);}
function eyeEAR(pts:Pt[]){if(pts.length<6)return 0;const [p1,p2,p3,p4,p5,p6]=pts;return (dist(p2,p6)+dist(p3,p5))/(2*dist(p1,p4)+1e-6);}
function smooth(p:number,c:number,a=0.6){return p?a*p+(1-a)*c:c;}

window.addEventListener("fm:vision",(e:any)=>{
  const v:VisionEvt=e.detail;
  if(!v.valid||v.conf<0.5)return;

  const earL=eyeEAR(v.left.pts), earR=eyeEAR(v.right.pts);
  const ear=(earL+earR)/2;
  S.lastEAR=smooth(S.lastEAR,ear);

  const T=S.ear0?S.ear0*0.72:0.22;
  const closed=S.lastEAR<T;

  const ts=v.ts;
  let blinkDuration=0, blinkSpeed=0, isBlinking=false;
  if(closed && !S.blinkOn){ S.blinkOn=true; S.blinkStart=ts; }
  if(!closed && S.blinkOn){
    const dur=(ts-S.blinkStart)/1000;
    blinkDuration=dur; blinkSpeed=dur>0?Math.min(1/dur,10):0;
    S.blinkOn=false; isBlinking=true;
  }

  S.perclosBuf.push(closed?1:0);
  if(S.perclosBuf.length>60) S.perclosBuf.shift();
  const perclos=S.perclosBuf.reduce((a,b)=>a+b,0)/Math.max(1,S.perclosBuf.length);

  window.dispatchEvent(new CustomEvent("fm:metrics",{detail:{
    ts,
    ear:{L:earL,R:earR,avg:S.lastEAR,T},
    blink:{isBlinking,durationSec:blinkDuration,speed:blinkSpeed},
    perclos:{ratio:perclos,win:"60s"}
  }}));
});

export async function runCalibration(seconds=10){
  return new Promise<number>((resolve)=>{
    const vals:number[]=[];
    const handler=(e:any)=>{
      const v=e.detail as VisionEvt;
      if(!v.valid||v.conf<0.5)return;
      const ear=(eyeEAR(v.left.pts)+eyeEAR(v.right.pts))/2;
      vals.push(ear);
    };
    window.addEventListener("fm:vision",handler);
    const start=Date.now();
    const id=setInterval(()=>{
      if(Date.now()-start>=seconds*1000){
        clearInterval(id);
        window.removeEventListener("fm:vision",handler);
        const avg=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length):0.3;
        S.ear0=avg; localStorage.setItem("fm_ear0",String(avg));
        resolve(avg);
      }
    },200);
  });
}
