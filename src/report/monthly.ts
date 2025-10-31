import { getFramesInRange, avgFocus } from "./aggregate";
import Chart from "chart.js/auto";

export async function renderMonthly(now=new Date()){
  const y = now.getFullYear(), m = now.getMonth();
  const start = new Date(y,m,1,0,0,0,0);
  const end   = new Date(y,m+1,0,23,59,59,999);
  const days = end.getDate();

  const labels = Array.from({length:days},(_,i)=>`${i+1}일`);
  const scores:number[] = [];
  for(let d=1; d<=days; d++){
    const s = new Date(y,m,d,0,0,0,0).getTime();
    const e = new Date(y,m,d,23,59,59,999).getTime();
    const frames = await getFramesInRange(s, e);
    scores.push(avgFocus(frames));
  }

  const ctx = (document.getElementById('monthlyLine') as HTMLCanvasElement).getContext('2d')!;
  // @ts-ignore
  if((ctx as any).__chart) (ctx as any).__chart.destroy();
  // @ts-ignore
  (ctx as any).__chart = new Chart(ctx, { type:'line', data:{ labels, datasets:[{ label:'일자별 평균 집중 점수', data:scores }]}, options:{ scales:{y:{suggestedMax:100}} } });
}
