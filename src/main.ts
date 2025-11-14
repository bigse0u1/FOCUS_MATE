// src/main.ts
// =========================
// 메인 엔트리: 랜딩 → 중앙 카메라 + 3x3 → 측정 화면
// =========================

import "./ui/tabs";
import "./debug";
import "./ui/gazeOverlay"; // 동공 방향 시각화 쓰고 있으면 유지

import { db } from "./db";
import { notify } from "./ui/toast";
import { renderDaily } from "./report/daily";
import { renderWeekly } from "./report/weekly";
import { renderMonthly } from "./report/monthly";
import { renderRecommend } from "./report/recommend";
import { initMetrics, runCalibration } from "./metrics/index";
import { Vision } from "./vision";

declare global {
  interface Window {
    fmFocusZone?: import("./metrics").FocusZone | null;
    fmSessionId?: string;
    fmSessionActive?: boolean;
  }
}

let vision: Vision | null = null;
let appStarted = false;

// =========================
// 1️⃣ 앱 시작 플로우
// =========================
async function startApp() {
  if (appStarted) return;
  appStarted = true;

  console.log("[App] startApp called");

  // 랜딩 숨기고, setup 화면 보이기
  document.getElementById("landingOverlay")?.classList.add("hidden");
  document.getElementById("setupScreen")?.classList.remove("hidden");

  // 카메라 + Mediapipe 시작 (왼쪽 main 화면의 #videoEl 기반)
  vision = new Vision();
  try {
    await vision.start();
    console.log("[App] Vision started");
  } catch (err) {
    console.error("[App] Vision start error", err);
    alert("카메라를 불러오지 못했습니다. 브라우저 주소창 왼쪽 🔒 → Camera: 허용");
    appStarted = false;
    return;
  }

  // 메트릭 초기화 (fm:vision → fm:metrics / fm:state)
  initMetrics();

  // 기본 일 리포트 24h 그리기
  renderDaily();
}

// =========================
// 2️⃣ DOM 바인딩
// =========================
function initDomBindings() {
  console.log("[App] initDomBindings");

  // 랜딩 화면 버튼
  const landingBtn = document.getElementById("btnLandingStart");
  landingBtn?.addEventListener("click", () => {
    console.log("[App] btnLandingStart clicked");
    void startApp();
  });

  setupHeaderButtons();
  setupDailyToggle();
  setupCameraStreamBridge();
  setupFocusZoneHandlers();

  // 초기 일 리포트(24h)
  renderDaily();
}

// DOMContentLoaded 시점에 바인딩
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initDomBindings);
} else {
  initDomBindings();
}

// =========================
// 3️⃣ 세션 관리 (버튼으로 ON/OFF)
// =========================
export function startSession() {
  window.fmSessionActive = true;
  window.fmSessionId = `S${Date.now()}`;
  notify("세션을 시작했어요.");
}

export async function endSession() {
  window.fmSessionActive = false;

  const id = window.fmSessionId || `S${Date.now()}`;
  const now = Date.now();
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);

  const frames = await db.frames
    .where("ts")
    .between(today0.getTime(), now, true, true)
    .toArray();

  const avg = frames.length
    ? Math.round(
        frames.reduce((a: number, b: any) => a + (b.focusScore ?? 0), 0) /
          frames.length
      )
    : 0;

  const focusMin = Math.round(
    frames.filter((f: any) => f.state === "focus").length / 60
  );
  const drowsyMin = Math.round(
    frames.filter((f: any) => f.state === "drowsy").length / 60
  );
  const distractMin = Math.round(
    frames.filter((f: any) => f.state === "distract").length / 60
  );

  await db.sessions.put({
    id,
    startedAt: today0.getTime(),
    endedAt: now,
    summary: { avgFocus: avg, totalFocusMin: focusMin, drowsyMin, distractMin },
  });

  notify("세션 요약을 저장했어요.");
  window.fmSessionId = undefined;
}

// =========================
// 4️⃣ 헤더 버튼 / 캘리브레이션
// =========================
function setupHeaderButtons() {
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
}

// =========================
// 5️⃣ 일 리포트 1h/24h 토글
// =========================
function setupDailyToggle() {
  document
    .getElementById("btnDaily1h")
    ?.addEventListener("click", () => {
      document.getElementById("btnDaily1h")?.classList.add("active");
      document.getElementById("btnDaily24h")?.classList.remove("active");
      renderDaily(new Date(), "1h");
    });

  document
    .getElementById("btnDaily24h")
    ?.addEventListener("click", () => {
      document.getElementById("btnDaily24h")?.classList.add("active");
      document.getElementById("btnDaily1h")?.classList.remove("active");
      renderDaily(new Date(), "24h");
    });
}

// =========================
// 6️⃣ fm:state → DB + UI 반영
// =========================
window.addEventListener("fm:state", (e: any) => {
  const { ts, state, score } = e.detail;

  // 세션이 꺼져 있으면 DB 기록/표시 안 함
  if (!window.fmSessionActive) return;

  db.frames.put({ ts, state, focusScore: score });

  (document.getElementById("stateBadge") as HTMLElement).innerText = mapKor(
    state
  );
  (document.getElementById("focusScore") as HTMLElement).innerText = String(
    Math.round(score)
  );

  void updateLiveCounters();
});

async function updateLiveCounters() {
  const now = Date.now();
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);

  const frames = await db.frames
    .where("ts")
    .between(today0.getTime(), now, true, true)
    .toArray();

  const drowsyMin = Math.round(
    frames.filter((f: any) => f.state === "drowsy").length / 60
  );
  const distractMin = Math.round(
    frames.filter((f: any) => f.state === "distract").length / 60
  );

  (document.getElementById("drowsyMin") as HTMLElement).innerText =
    String(drowsyMin);
  (document.getElementById("distractMin") as HTMLElement).innerText =
    String(distractMin);
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

// =========================
// 7️⃣ 탭 전환 시 리포트 렌더
// =========================
window.addEventListener("fm:tab", (e: any) => {
  const tab = e.detail as string;
  if (tab === "daily") renderDaily();
  else if (tab === "weekly") renderWeekly();
  else if (tab === "monthly") renderMonthly();
  else if (tab === "recommend") renderRecommend();
});

// =========================
// 8️⃣ 카메라 스트림 → setupVideo / debugVideo 공유
// =========================
function setupCameraStreamBridge() {
  const setupVideo = document.getElementById(
    "setupVideo"
  ) as HTMLVideoElement | null;
  const debugVideo = document.getElementById(
    "debugVideo"
  ) as HTMLVideoElement | null;

  window.addEventListener("fm:camera-stream", (e: any) => {
    const { stream } = e.detail as { stream: MediaStream };

    if (setupVideo && !setupVideo.srcObject) {
      setupVideo.srcObject = stream;
    }
    if (debugVideo && !debugVideo.srcObject) {
      debugVideo.srcObject = stream;
    }
  });
}

// =========================
// 9️⃣ 3×3 집중 구역 선택 핸들러 (setup 화면)
// =========================
function setupFocusZoneHandlers() {
  const setupScreen = document.getElementById("setupScreen");
  if (!setupScreen) return;

  const cells = Array.from(
    setupScreen.querySelectorAll<HTMLButtonElement>(".fz-cell")
  );
  const btnConfirm = document.getElementById(
    "btnFocusZoneConfirm"
  ) as HTMLButtonElement | null;
  const btnSkip = document.getElementById(
    "btnFocusZoneSkip"
  ) as HTMLButtonElement | null;

  // 셀 클릭: 선택 토글
  cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      cell.classList.toggle("selected");
    });
  });

  const finishSetup = () => {
    // setup 화면 숨기고 메인 layout 보이기
    setupScreen.classList.add("hidden");
    document.getElementById("layout")?.classList.remove("hidden");

    // 처음 시작 시에는 세션 ON 상태로 시작
    window.fmSessionActive = true;
    notify("집중 구역 설정이 완료되었습니다. 측정을 시작합니다.");
  };

  // 건너뛰기: 구역 사용 안 함
  btnSkip?.addEventListener("click", () => {
    window.fmFocusZone = null;
    finishSetup();
  });

  // 확인: 선택된 셀들로 구역 계산
  btnConfirm?.addEventListener("click", () => {
    const selected = cells.filter((c) => c.classList.contains("selected"));
    if (!selected.length) {
      alert("최소 한 칸 이상 선택해주세요.");
      return;
    }

    let minRow = 3,
      maxRow = -1,
      minCol = 3,
      maxCol = -1;

    selected.forEach((cell) => {
      const r = Number(cell.dataset.row);
      const c = Number(cell.dataset.col);
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
    });

    const cellW = 1 / 3;
    const cellH = 1 / 3;

    window.fmFocusZone = {
      xMin: minCol * cellW,
      xMax: (maxCol + 1) * cellW,
      yMin: minRow * cellH,
      yMax: (maxRow + 1) * cellH,
    };

    console.log("[FocusZone set]", window.fmFocusZone);
    finishSetup();
  });
}
