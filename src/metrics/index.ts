// src/metrics/index.ts
// ---------------------------------------
// 1) fm:vision → EAR / PERCLOS / gazeDev / zoneScore / focusScore 계산
// 2) fm:metrics 이벤트 송출 (디버그 패널용)
// 3) fm:state 이벤트 송출 (focus / transition / distract / drowsy 등)
// 4) runCalibration(seconds): EAR 기준선 캘리브레이션
// 5) fmSessionActive 플래그로 "세션 시작/종료"에 따라 측정 ON/OFF 제어
// ---------------------------------------

import type { VisionFrameDetail } from "../vision";

export type FocusZone = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

declare global {
  interface Window {
    fmFocusZone?: FocusZone | null;
    fmSessionId?: string;
    fmSessionActive?: boolean; // 세션 on/off 플래그 (main.ts에서 true/false로 제어)
  }
}

// ===============================
// 내부 상태
// ===============================

let baselineEarL = 0.28;
let baselineEarR = 0.28;
let baselineEarAvg = 0.28;

// PERCLOS: 최근 60초(= 60 * 15fps = 900프레임) 윈도우
const PERCLOS_WINDOW_SEC = 60;
const TARGET_FPS = 15;
const PERCLOS_WINDOW_SIZE = PERCLOS_WINDOW_SEC * TARGET_FPS;
const eyeClosedBuffer: boolean[] = [];
let perclos = 0;

// EMA(지수 이동 평균)로 부드럽게
let gazeDevEma = 0;
let focusScoreEma = 0;

// 🔹 머리 움직임 추적용
let prevPose: { yaw: number; pitch: number; roll: number } | null = null;
let headMoveEma = 0;

// 상태머신
type StateLabel = "focus" | "transition" | "distract" | "fatigue" | "drowsy";
let currentState: StateLabel = "transition";
let candidateState: StateLabel = "transition";
let candidateCount = 0;
const STATE_HOLD_FRAMES = TARGET_FPS * 2; // 2초 정도 유지되면 상태 확정

let lastTs = 0;

// ===============================
// 공용 API: initMetrics()
// ===============================
export function initMetrics() {
  // 중복 등록 방지
  // @ts-ignore
  if ((window as any)._fmMetricsInitialized) return;
  // @ts-ignore
  (window as any)._fmMetricsInitialized = true;

  // 기본값: 앱 처음 켜질 때는 측정 ON 상태
  if (window.fmSessionActive === undefined) {
    window.fmSessionActive = true;
  }

  window.addEventListener("fm:vision", onVisionFrame);
  console.log("[Metrics] initMetrics: fm:vision listener registered");
}

// ===============================
// 공용 API: runCalibration(durationSec)
// ===============================
export function runCalibration(durationSec: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const samples: number[] = [];
    const start = performance.now();
    const timeoutMs = durationSec * 1000;

    const handler = (e: Event) => {
      const ev = e as CustomEvent<VisionFrameDetail>;
      const { valid, left, right } = ev.detail;
      if (!valid) return;
      if (!left?.pts || left.pts.length < 6 || !right?.pts || right.pts.length < 6)
        return;

      const earL = computeEAR(left.pts);
      const earR = computeEAR(right.pts);
      const earAvg = (earL + earR) / 2;
      samples.push(earAvg);

      if (performance.now() - start >= timeoutMs) {
        window.removeEventListener("fm:vision", handler);
        if (!samples.length) {
          reject(new Error("no samples"));
          return;
        }
        const avg =
          samples.reduce((a, b) => a + b, 0) / samples.length || baselineEarAvg;

        baselineEarAvg = avg;
        baselineEarL = avg;
        baselineEarR = avg;

        console.log("[Metrics] calibration done. baselineEAR =", avg.toFixed(3));
        resolve(avg);
      }
    };

    window.addEventListener("fm:vision", handler);

    // 안전 timeout
    setTimeout(() => {
      try {
        window.removeEventListener("fm:vision", handler);
      } catch {}
      if (!samples.length) reject(new Error("calibration timeout"));
    }, timeoutMs * 2);
  });
}

// ===============================
// fm:vision 이벤트 핸들러 (핵심)
// ===============================
function onVisionFrame(e: Event) {
  // 📌 세션이 종료 상태면 "측정 자체를 멈춤"
  //   - EAR/PERCLOS/gaze/state 계산도 멈춤
  //   - fm:metrics, fm:state 이벤트도 안 쏨 → 그래프와 KPI 업데이트 정지
  if (window.fmSessionActive === false) {
    return;
  }

  const ev = e as CustomEvent<VisionFrameDetail>;
  const frame = ev.detail;
  lastTs = frame.ts;

  const { valid, left, right, iris, conf, pose } = frame;

  // 🔴 얼굴/눈이 안 잡히거나 신뢰도 낮으면 → 산만 + 집중도 0
  if (!valid || conf < 0.5) {
    const zoneScore = 0;
    const focusScore = 0;
  
    // 집중도 EMA도 0으로 리셋
    focusScoreEma = 0;
    // 🔹 머리 움직임도 리셋
    prevPose = null;
    headMoveEma = 0;

    updateStateMachine("distract", {
      perclos,
      gazeDev: gazeDevEma,
      zoneScore,
      focusScore,
    });

    dispatchMetricsEvent({
      earL: 0,
      earR: 0,
      earAvg: 0,
      perclos,
      gazeDev: gazeDevEma,
      zoneScore,
      focusScore,
      gazeDirLabel: "N/A",
    });
    return;
  }

  // 1) EAR 계산
  let earL = 0,
    earR = 0,
    earAvg = 0;

  if (left?.pts && left.pts.length >= 6 && right?.pts && right.pts.length >= 6) {
    earL = computeEAR(left.pts);
    earR = computeEAR(right.pts);
    earAvg = (earL + earR) / 2;
  }

  const earRatio = baselineEarAvg > 0 ? earAvg / baselineEarAvg : 1;
  const isClosed = earAvg > 0 ? earRatio < 0.7 || earAvg < 0.18 : false;
  updatePerclos(isClosed);

  // 2) 시선 벡터 / gazeDev
  const centerL = eyeCenter(left?.pts ?? []);
  const centerR = eyeCenter(right?.pts ?? []);
  const irisL = iris?.L ?? null;
  const irisR = iris?.R ?? null;

  const vL =
    irisL && centerL
      ? { x: irisL.x - centerL.x, y: irisL.y - centerL.y }
      : null;
  const vR =
    irisR && centerR
      ? { x: irisR.x - centerR.x, y: irisR.y - centerR.y }
      : null;
  const v = averageVector(vL, vR);

  let gazeDirLabel = "중앙";
  let gazeDev = 0;
  if (v) {
    gazeDev = Math.sqrt(v.x * v.x + v.y * v.y);
    const alphaG = 0.15;
    gazeDevEma = gazeDevEma * (1 - alphaG) + gazeDev * alphaG;

    gazeDirLabel = classifyDirection(v.x, v.y);
  }

  // 3) 집중 구역 점수
  const irisCenter =
    iris?.center ??
    (irisL && irisR
      ? { x: (irisL.x + irisR.x) / 2, y: (irisL.y + irisR.y) / 2 }
      : centerL && centerR
      ? { x: (centerL.x + centerR.x) / 2, y: (centerL.y + centerR.y) / 2 }
      : null);

  const { zoneScore } = computeZoneScore(
    irisCenter ? { x: irisCenter.x, y: irisCenter.y } : null
  );

  // 4) 축별 점수
  let eyeScore = 1 - clamp01(perclos / 0.5); // PERCLOS 0.5 → 0점
  if (isClosed) eyeScore *= 0.8;             // 프레임 단위 눈감음 페널티

  let gazeScore = 1 - clamp01(gazeDevEma / 0.25); // 시선 벗어남 정도

  const locScore = zoneScore; // 집중 zone 안/밖

  // 🔹 4.5) 머리 움직임 기반 headScore (0~1)
  let headScore = 1;
  if (pose) {
    if (prevPose) {
      const dyaw = pose.yaw - prevPose.yaw;
      const dpitch = pose.pitch - prevPose.pitch;
      const droll = pose.roll - prevPose.roll;
      const move = Math.sqrt(dyaw * dyaw + dpitch * dpitch + droll * droll); // 한 프레임에서의 회전 변화량

      const alphaH = 0.1; // EMA
      headMoveEma = headMoveEma * (1 - alphaH) + move * alphaH;
    }
    prevPose = pose;
  }

  // 움직임이 커질수록 점수 감소 (8deg 정도 넘으면 강한 패널티)
  headScore = 1 - clamp01(headMoveEma / 4);

  // 🔥 구역 밖 + 움직이면 집중도 급하락
  const rapidDrop =
  zoneScoreEma < 0.9 && (gazeDevEma > 0.12 || headMoveEma > 0.7);

  if (rapidDrop) {
  focusScoreEma = focusScoreEma * 0.6; // 집중도 즉시 깎기
  }

  // 5) 최종 집중도 (0~100)
  const rawFocus =
    0.40 * eyeScore +   // 눈 상태
    0.20 * gazeScore +  // 시선
    0.25 * locScore +   // 집중 구역
    0.15 * headScore;   // 머리 움직임

  const focus0to100 = clamp01(rawFocus) * 100;
  const alphaF = 0.2;
  focusScoreEma = focusScoreEma * (1 - alphaF) + focus0to100 * alphaF;

  // 6) 상태 분류 + 상태머신 반영
  const derivedState = classifyState({
    focusScore: focusScoreEma,
    perclos,
    gazeDev: gazeDevEma,
    zoneScore,
  });

  updateStateMachine(derivedState, {
    perclos,
    gazeDev: gazeDevEma,
    zoneScore,
    focusScore: focusScoreEma,
  });

  // 7) 디버그용 fm:metrics 이벤트 송출
  dispatchMetricsEvent({
    earL,
    earR,
    earAvg,
    perclos,
    gazeDev: gazeDevEma,
    zoneScore,
    focusScore: focusScoreEma,
    gazeDirLabel,
    poseYaw: pose?.yaw,
    posePitch: pose?.pitch,
    poseRoll: pose?.roll,
  });
}

// ===== 보조 함수들 =====

function computeEAR(pts: { x: number; y: number }[]): number {
  if (!pts || pts.length < 6) return 0;

  const p1 = pts[0];
  const p2 = pts[1];
  const p3 = pts[2];
  const p4 = pts[3];
  const p5 = pts[4];
  const p6 = pts[5];

  const v1 = dist2D(p2, p6);
  const v2 = dist2D(p3, p5);
  const v3 = dist2D(p1, p4);

  if (v3 === 0) return 0;
  return (v1 + v2) / (2 * v3);
}

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function updatePerclos(isClosed: boolean) {
  eyeClosedBuffer.push(isClosed);
  if (eyeClosedBuffer.length > PERCLOS_WINDOW_SIZE) {
    eyeClosedBuffer.shift();
  }
  if (!eyeClosedBuffer.length) {
    perclos = 0;
    return;
  }
  const closedCount = eyeClosedBuffer.filter((b) => b).length;
  perclos = closedCount / eyeClosedBuffer.length;
}

// 🔥 구역 기반 EMA
let zoneScoreEma = 0.5;

function computeZoneScore(
  irisCenter: { x: number; y: number } | null
): { zoneScore: number } {
  const zone = window.fmFocusZone;

  const alphaInside = 0.02;   // 구역 안에서 천천히 상승
  const alphaOutside = 0.001;  // 구역 밖에서는 더 느리게 상승
  const alphaDrop = 0.15;     // 구역 밖 + 움직임 -> 급락

  // 좌표 없음 → 점수 유지 (중간값 0.5로 복귀)
  if (!zone || !irisCenter) {
    zoneScoreEma = zoneScoreEma * 0.9 + 0.5 * 0.1;
    return { zoneScore: clamp01(zoneScoreEma) };
  }

  const { xMin, xMax, yMin, yMax } = zone;

  const inZone =
    irisCenter.x >= xMin &&
    irisCenter.x <= xMax &&
    irisCenter.y >= yMin &&
    irisCenter.y <= yMax;

  // 목표 값
  const target = inZone ? 1.0 : 0.7;

  // ---------- EMA 적용 ----------
  if (inZone) {
    // 구역 안: 천천히 올라감
    zoneScoreEma = zoneScoreEma * (1 - alphaInside) + target * alphaInside;
  } else {
    // 구역 밖: 느리게 상승
    zoneScoreEma = zoneScoreEma * (1 - alphaOutside) + target * alphaOutside;

    // 🔥 구역 밖 + 시선/머리 움직임 → 급격히 하락
    if (gazeDevEma > 0.12 || headMoveEma > 0.6) {
      zoneScoreEma = zoneScoreEma * (1 - alphaDrop);
    }
  }

  return { zoneScore: clamp01(zoneScoreEma) };
}



function classifyDirection(dx: number, dy: number): string {
  const len = Math.sqrt(dx * dx + dy * dy);
  const EPS = 0.01;
  if (len < EPS) return "중앙";

  const nx = dx / len;
  const ny = dy / len;

  const absX = Math.abs(nx);
  const absY = Math.abs(ny);

  if (absX < 0.35 && ny < 0) return "위";
  if (absX < 0.35 && ny > 0) return "아래";
  if (absY < 0.35 && nx < 0) return "왼쪽";
  if (absY < 0.35 && nx > 0) return "오른쪽";

  if (nx < 0 && ny < 0) return "왼쪽 위";
  if (nx > 0 && ny < 0) return "오른쪽 위";
  if (nx < 0 && ny > 0) return "왼쪽 아래";
  if (nx > 0 && ny > 0) return "오른쪽 아래";

  return "중앙";
}

function eyeCenter(pts: { x: number; y: number }[]): { x: number; y: number } | null {
  if (!pts || !pts.length) return null;
  let sx = 0,
    sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const n = pts.length;
  return { x: sx / n, y: sy / n };
}

function averageVector(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null
): { x: number; y: number } | null {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return a ?? b ?? null;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function classifyState(params: {
  focusScore: number;
  perclos: number;
  gazeDev: number;
  zoneScore: number;
}): StateLabel {
  const { focusScore, perclos, gazeDev, zoneScore } = params;

  // 졸음/피로 우선
  if (perclos > 0.5) return "drowsy";
  if (perclos > 0.35) return "fatigue";

  // 집중도 낮고, zoneScore 낮고, 시선 많이 벗어난 경우 → 산만
  if (focusScore < 83 || zoneScore < 0.9 || gazeDev > 0.004) {
    return "distract";
  }

  if (focusScore < 88) return "transition";
  return "focus";
}

function updateStateMachine(
  next: StateLabel,
  _metrics: {
    perclos: number;
    gazeDev: number;
    zoneScore: number;
    focusScore: number;
  }
) {
  if (next === currentState) {
    candidateState = next;
    candidateCount = 0;
    dispatchStateEvent(currentState, focusScoreEma);
    return;
  }

  if (next !== candidateState) {
    candidateState = next;
    candidateCount = 1;
    dispatchStateEvent("transition", focusScoreEma);
    return;
  }

  candidateCount++;

  if (candidateCount >= STATE_HOLD_FRAMES) {
    currentState = candidateState;
    candidateCount = 0;
    dispatchStateEvent(currentState, focusScoreEma);
  } else {
    dispatchStateEvent("transition", focusScoreEma);
  }
}

function dispatchMetricsEvent(payload: {
  earL: number;
  earR: number;
  earAvg: number;
  perclos: number;
  gazeDev: number;
  zoneScore: number;
  focusScore: number;
  gazeDirLabel: string;
  poseYaw?: number;
  posePitch?: number;
  poseRoll?: number;
}) {
  window.dispatchEvent(
    new CustomEvent("fm:metrics", {
      detail: payload,
    })
  );
}

function dispatchStateEvent(state: StateLabel, score: number) {
  window.dispatchEvent(
    new CustomEvent("fm:state", {
      detail: {
        ts: lastTs || Date.now(),
        state,
        score,
      },
    })
  );
}

