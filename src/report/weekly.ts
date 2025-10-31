import { getFramesInRange, avgFocus } from "./aggregate";
import Chart from "chart.js/auto";

export async function renderWeekly(now=new Date()){
  const day = now.getDay();
  const monday = new Date(now); monday.setDate(now.getDate() - ((day+6)%7)); monday.setHours(0,0,0,0);

  const labels = ['월','화','수','목','금','토','일'];
  const scores:number[] = [];
  for(let i=0;i<7;i++){
    const s = new Date(monday); s.setDate(monday.getDate()+i);
    const e = new Date(s); e.setDate(s.getDate()+1);
    const frames = await getFramesInRange(s.getTime(), e.getTime()-1);
    scores.push(avgFocus(frames));
  }

  const ctx = (document.getElementById('weeklyBar') as HTMLCanvasElement).getContext('2d')!;
  // @ts-ignore
  if((ctx as any).__chart) (ctx as any).__chart.destroy();
  // @ts-ignore
  (ctx as any).__chart = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{ label:'평균 집중 점수', data:scores }]}, options:{ scales:{y:{suggestedMax:100}} } });
}
