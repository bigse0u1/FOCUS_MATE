import { getFramesInRange } from "./aggregate";

export async function renderRecommend(now=new Date()){
  const end = now.getTime();
  const start = end - 7*24*60*60*1000;
  const frames = await getFramesInRange(start, end);

  const buckets = Array(1440).fill(0).map(()=>({sum:0,cnt:0}));
  for(const f of frames){
    const d = new Date(f.ts);
    const idx = d.getHours()*60 + d.getMinutes();
    buckets[idx].sum += (f as any).focusScore || 0;
    buckets[idx].cnt += 1;
  }
  const avgByMin = buckets.map(b=> b.cnt? b.sum/b.cnt : 0);

  function windowSum(i:number){ let s=0; for(let k=0;k<120;k++) s += avgByMin[(i+k)%1440]; return s; }
  const cand = Array(1440).fill(0).map((_,i)=>({i,score:windowSum(i)})).sort((a,b)=>b.score-a.score);
  const picks:number[] = [];
  for(const c of cand){
    if(picks.every(p=> Math.abs(c.i-p) > 120 )) picks.push(c.i);
    if(picks.length===3) break;
  }

  const tbody = document.getElementById("recBody")!;
  tbody.innerHTML = picks.map((startIdx,rank)=>{
    const hhmm = (n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
    const label = `${hhmm(startIdx)} ~ ${hhmm((startIdx+120)%1440)}`;
    const total = Math.round(cand.find(x=>x.i===startIdx)!.score);
    const icon = ["🥇","🥈","🥉"][rank];
    return `<tr><td>${icon} ${rank+1}</td><td><b>${label}</b></td><td>${total} 점</td></tr>`;
  }).join("");
}
