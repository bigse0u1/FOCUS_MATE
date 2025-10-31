import { setupTabs } from "./ui/tabs";
import { db } from "./db";
import { notify } from "./ui/toast";
import { renderDaily } from "./report/daily";
import { renderWeekly } from "./report/weekly";
import { renderMonthly } from "./report/monthly";
import { renderRecommend } from "./report/recommend";
import { runCalibration } from "./metrics/index";

setupTabs();

// 세션 관리
let currentSessionId = "";
export function startSession(){
  currentSessionId = `S${Date.now()}`;
  (window as any).fmSessionId = currentSessionId;
  notify("세션을 시작했어요.");
}
export async function endSession(){
  const id = currentSessionId;
  if(!id) return;
  const now = Date.now();
  const today0 = new Date(); today0.setHours(0,0,0,0);
  const frames = await db.frames.where('ts').between(today0.getTime(), now, true, true).toArray();
  const avg = frames.length
    ? Math.round(frames.reduce((a:number,b:any)=>a+b.focusScore,0)/frames.length)
    : 0;
  const focusMin = Math.round(frames.filter((f:any)=>f.state==='focus').length/60);
  const drowsyMin = Math.round(frames.filter((f:any)=>f.state==='drowsy').length/60);
  const distractMin = Math.round(frames.filter((f:any)=>f.state==='distract').length/60);

  await db.sessions.put({ id, startedAt: today0.getTime(), endedAt: now,
    summary: { avgFocus: avg, totalFocusMin: focusMin, drowsyMin, distractMin }
  });
  notify("세션 요약을 저장했어요.");
  currentSessionId = "";
}

// 헤더 버튼
document.getElementById("btnStart")?.addEventListener("click", startSession);
document.getElementById("btnEnd")?.addEventListener("click", endSession);
document.getElementById("btnCalib")?.addEventListener("click", async()=>{
  const dot = document.getElementById("calibDot")!;
  dot.classList.remove("hidden");
  notify("캘리브레이션 시작 — 중앙 점을 10초 응시하세요.");
  try{
    const avg = await runCalibration(10);
    notify(`캘리브레이션 완료: EAR0=${avg.toFixed(3)}`);
  }catch{
    notify("캘리브레이션 실패");
  }finally{
    dot.classList.add("hidden");
  }
});

// ✅ 일 리포트: 1시간/24시간 토글
document.getElementById("btnDaily1h")?.addEventListener("click", ()=>{
  document.getElementById("btnDaily1h")?.classList.add("active");
  document.getElementById("btnDaily24h")?.classList.remove("active");
  renderDaily(new Date(), "1h");
});
document.getElementById("btnDaily24h")?.addEventListener("click", ()=>{
  document.getElementById("btnDaily24h")?.classList.add("active");
  document.getElementById("btnDaily1h")?.classList.remove("active");
  renderDaily(new Date(), "24h");
});

// fm:state → DB 저장 + KPI
window.addEventListener("fm:state", (e:any)=>{
  const { ts, state, score } = e.detail;
  db.frames.put({ ts, state, focusScore: score });
  (document.getElementById("stateBadge") as HTMLElement).innerText = mapKor(state);
  (document.getElementById("focusScore") as HTMLElement).innerText = String(Math.round(score));
  updateLiveCounters();
});

async function updateLiveCounters(){
  const now = Date.now();
  const today0 = new Date(); today0.setHours(0,0,0,0);
  const frames = await db.frames.where('ts').between(today0.getTime(), now, true, true).toArray();
  const drowsyMin = Math.round(frames.filter((f:any)=>f.state==='drowsy').length/60);
  const distractMin = Math.round(frames.filter((f:any)=>f.state==='distract').length/60);
  (document.getElementById("drowsyMin") as HTMLElement).innerText = String(drowsyMin);
  (document.getElementById("distractMin") as HTMLElement).innerText = String(distractMin);
}
function mapKor(s:string){ return ({focus:"집중",transition:"전환",distract:"산만",fatigue:"피로",drowsy:"졸음"} as any)[s] || s }

// 탭 전환 시 렌더
renderDaily(); // 초기 24h
window.addEventListener("fm:tab",(e:any)=>{
  const tab = e.detail as string;
  if(tab==="daily") renderDaily();          // 현재 뷰 유지(모듈 내부 변수로 저장됨)
  else if(tab==="weekly") renderWeekly();
  else if(tab==="monthly") renderMonthly();
  else if(tab==="recommend") renderRecommend();
});
