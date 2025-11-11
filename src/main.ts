// main.ts (clean, working)

// Tabs / Debug
import "./ui/tabs";
import "./debug";

// Core modules
import { db } from "./db";
import { notify } from "./ui/toast";
import { renderDaily } from "./report/daily";
import { renderWeekly } from "./report/weekly";
import { renderMonthly } from "./report/monthly";
import { renderRecommend } from "./report/recommend";
import { runCalibration, initMetrics } from "./metrics/index";
import { initState } from "./state/index";
import { Vision } from "./vision";

// 1) App start: Vision + Metrics + State
window.addEventListener("DOMContentLoaded", () => {
  const vision = new Vision();
  vision
    .start()
    .then(() => console.log("[Vision] Started"))
    .catch((err) => {
      console.error("[Vision] start error:", err);
      alert("카메라를 불러오지 못했습니다. 브라우저 주소창 왼쪽 🔒 → Camera: 허용");
    });

  initMetrics(); // fm:vision -> fm:metrics
  initState();   // fm:metrics -> fm:state

  renderDaily(); // initial 24h view
});

// 2) Session management
let currentSessionId = "";

export function startSession() {
  currentSessionId = `S${Date.now()}`;
  (window as any).fmSessionId = currentSessionId;
  notify("세션을 시작했어요.");
}

export async function endSession() {
  const id = currentSessionId;
  if (!id) return;

  const now = Date.now();
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);

  const frames = await db.frames
    .where("ts")
    .between(today0.getTime(), now, true, true)
    .toArray();

  const avg = frames.length
    ? Math.round(frames.reduce((a: number, b: any) => a + b.focusScore, 0) / frames.length)
    : 0;

  const focusMin = Math.round(frames.filter((f: any) => f.state === "focus").length / 60);
  const drowsyMin = Math.round(frames.filter((f: any) => f.state === "drowsy").length / 60);
  const distractMin = Math.round(frames.filter((f: any) => f.state === "distract").length / 60);

  await db.sessions.put({
    id,
    startedAt: today0.getTime(),
    endedAt: now,
    summary: { avgFocus: avg, totalFocusMin: focusMin, drowsyMin, distractMin },
  });

  notify("세션 요약을 저장했어요.");
  currentSessionId = "";
}

// 3) Header buttons
document.getElementById("btnStart")?.addEventListener("click", startSession);
document.getElementById("btnEnd")?.addEventListener("click", endSession);

document.getElementById("btnCalib")?.addEventListener("click", async () => {
  const dot = document.getElementById("calibDot")!;
  dot.classList.remove("hidden");
  notify("캘리브레이션 시작 — 중앙 점을 10초 응시하세요.");

  try {
    const avg = await runCalibration(10);
    notify(`캘리브레이션 완료: EAR0=${avg.toFixed(3)}`);
  } catch {
    notify("캘리브레이션 실패");
  } finally {
    dot.classList.add("hidden");
  }
});

// 4) Daily report range toggle
document.getElementById("btnDaily1h")?.addEventListener("click", () => {
  document.getElementById("btnDaily1h")?.classList.add("active");
  document.getElementById("btnDaily24h")?.classList.remove("active");
  renderDaily(new Date(), "1h");
});
document.getElementById("btnDaily24h")?.addEventListener("click", () => {
  document.getElementById("btnDaily24h")?.classList.add("active");
  document.getElementById("btnDaily1h")?.classList.remove("active");
  renderDaily(new Date(), "24h");
});

// 5) fm:state -> DB + live KPIs
window.addEventListener("fm:state", (e: any) => {
  const { ts, state, score } = e.detail;

  db.frames.put({ ts, state, focusScore: score });

  (document.getElementById("stateBadge") as HTMLElement).innerText = mapKor(state);
  (document.getElementById("focusScore") as HTMLElement).innerText = String(Math.round(score));

  updateLiveCounters();
});

async function updateLiveCounters() {
  const now = Date.now();
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);

  const frames = await db.frames
    .where("ts")
    .between(today0.getTime(), now, true, true)
    .toArray();

  const drowsyMin = Math.round(frames.filter((f: any) => f.state === "drowsy").length / 60);
  const distractMin = Math.round(frames.filter((f: any) => f.state === "distract").length / 60);

  (document.getElementById("drowsyMin") as HTMLElement).innerText = String(drowsyMin);
  (document.getElementById("distractMin") as HTMLElement).innerText = String(distractMin);
}

function mapKor(s: string) {
  return (
    {
      focus: "집중",
      transition: "전환",
      distract: "산만",
      fatigue: "피로",
      drowsy: "졸음",
    } as any
  )[s] || s;
}

// 6) Render on tab switch
window.addEventListener("fm:tab", (e: any) => {
  const tab = e.detail as string;
  if (tab === "daily") renderDaily();
  else if (tab === "weekly") renderWeekly();
  else if (tab === "monthly") renderMonthly();
  else if (tab === "recommend") renderRecommend();
});
