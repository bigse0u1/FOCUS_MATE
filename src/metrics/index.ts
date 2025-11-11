/**
 * metrics/index.ts
 * - Mediapipe Vision으로부터 fm:vision 이벤트 수신
 * - EAR / PERCLOS / GazeDev 계산 후 fm:metrics 이벤트 송출
 * - runCalibration()으로 EAR0 기준값 설정 가능
 */

type Pt = { x: number; y: number };
type VisionFrame = {
  ts: number;
  fps?: number;
  left: { pts: Pt[] };
  right: { pts: Pt[] };
  conf: number;
  valid: boolean;
};

// === 설정값 ===
const PERCLOS_WINDOW_SEC = 60; // 1분 창
const EAR_THRESH_RATIO = 0.72; // EAR0의 72% 이하 → 눈 감김으로 판단
const EMA_ALPHA = 0.25;        // 이동평균 강도
const GAZE_MAX_R = 0.35;       // 시선편차 정규화 기준
const BLINK_MIN = 0.05;        // s
const BLINK_MAX = 0.80;        // s

// === 내부 상태 ===
let initialized = false;
let ear0 = 0;
let earThresh = 0;
let emaEAR = 0;
let emaGaze = 0;

type CloseFlag = { ts: number; closed: boolean; valid: boolean };
const closeHist: CloseFlag[] = [];
let blinkOpen = true;
let closeStart = 0;
let blinkTimes: number[] = [];

// === 유틸 ===
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const eyeCenter = (pts: Pt[]) => {
  const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
};
const ema = (prev: number, val: number, a: number) =>
  !isFinite(prev) || prev === 0 ? val : prev + a * (val - prev);
const prune = <T extends { ts: number }>(arr: T[], now: number, winMs: number) => {
  const cut = now - winMs;
  while (arr.length && arr[0].ts < cut) arr.shift();
};

// === EAR 계산 (6포인트) ===
function calcEAR6(pts: Pt[]): number {
  if (pts.length < 6) return NaN;
  const [p1, p2, p3, p4, p5, p6] = pts;
  const num = dist(p2, p6) + dist(p3, p5);
  const den = 2 * dist(p1, p4);
  return den ? num / den : NaN;
}

// === 시선 편차 ===
function gazeDeviation(l: Pt[], r: Pt[]): number {
  const lc = eyeCenter(l), rc = eyeCenter(r);
  const cx = (lc.x + rc.x) / 2;
  const cy = (lc.y + rc.y) / 2;
  return clamp01(Math.hypot(cx - 0.5, cy - 0.5) / GAZE_MAX_R);
}

// === PERCLOS/깜빡임률 ===
function updatePerclosBlink(now: number, earAvg: number, valid: boolean) {
  const closed = valid && earThresh > 0 && earAvg <= earThresh;
  closeHist.push({ ts: now, closed, valid });
  prune(closeHist, now, PERCLOS_WINDOW_SEC * 1000);

  if (blinkOpen && closed) {
    blinkOpen = false;
    closeStart = now;
  } else if (!blinkOpen && !closed) {
    const dur = (now - closeStart) / 1000;
    blinkOpen = true;
    if (dur >= BLINK_MIN && dur <= BLINK_MAX) {
      blinkTimes.push(now);
    }
  }

  blinkTimes = blinkTimes.filter(t => t >= now - 60_000);

  const validFrames = closeHist.filter(f => f.valid);
  const perclos = validFrames.length
    ? validFrames.filter(f => f.closed).length / validFrames.length
    : 0;
  const blinkRate = blinkTimes.length;
  return { perclos, blinkRate };
}

// === 캘리브레이션 (10초 응시 평균 EAR) ===
export async function runCalibration(seconds = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const samples: number[] = [];
    const start = Date.now();

    const onVision = (ev: any) => {
      const f: VisionFrame = ev.detail;
      if (!f?.valid) return;
      const l = calcEAR6(f.left.pts), r = calcEAR6(f.right.pts);
      if (!isFinite(l) || !isFinite(r)) return;
      samples.push((l + r) / 2);
      if (Date.now() - start > seconds * 1000) {
        cleanup();
        if (!samples.length) return reject(new Error("no samples"));
        ear0 = samples.reduce((a, b) => a + b, 0) / samples.length;
        earThresh = ear0 * EAR_THRESH_RATIO;
        resolve(ear0);
      }
    };
    const cleanup = () => window.removeEventListener("fm:vision", onVision as any);
    window.addEventListener("fm:vision", onVision as any);
    setTimeout(() => {
      cleanup();
      if (!samples.length) reject(new Error("timeout"));
      else {
        ear0 = samples.reduce((a, b) => a + b, 0) / samples.length;
        earThresh = ear0 * EAR_THRESH_RATIO;
        resolve(ear0);
      }
    }, seconds * 1000 + 300);
  });
}

// === 메트릭 초기화 ===
export function initMetrics() {
  if (initialized) return;
  initialized = true;

  window.addEventListener("fm:vision", (ev: any) => {
    const f: VisionFrame = ev.detail;
    const now = f?.ts ?? Date.now();
    const valid = !!f?.valid && f.left?.pts?.length >= 6 && f.right?.pts?.length >= 6;

    const earL = valid ? calcEAR6(f.left.pts) : NaN;
    const earR = valid ? calcEAR6(f.right.pts) : NaN;
    let earAvg = (isFinite(earL) && isFinite(earR)) ? (earL + earR) / 2 : NaN;

    // EAR0 자동 추정 (2초)
    if (ear0 === 0 && isFinite(earAvg)) {
      if (!(initMetrics as any)._tmp) {
        (initMetrics as any)._tmp = { sum: 0, n: 0, t0: now };
      }
      const t = (initMetrics as any)._tmp;
      if (now - t.t0 < 2000) { t.sum += earAvg; t.n++; }
      else if (t.n > 0 && ear0 === 0) {
        ear0 = t.sum / t.n;
        earThresh = ear0 * EAR_THRESH_RATIO;
      }
    }

    let gazeDev = valid ? gazeDeviation(f.left.pts, f.right.pts) : NaN;

    if (isFinite(earAvg)) emaEAR = ema(emaEAR, earAvg, EMA_ALPHA);
    if (isFinite(gazeDev)) emaGaze = ema(emaGaze, gazeDev, EMA_ALPHA);

    const { perclos, blinkRate } = updatePerclosBlink(
      now,
      isFinite(earAvg) ? earAvg : emaEAR,
      valid
    );

    // === 이벤트 송출 ===
    window.dispatchEvent(
      new CustomEvent("fm:metrics", {
        detail: {
          ts: now,
          conf: f?.conf ?? 0,
          valid,
          earL: isFinite(earL) ? earL : null,
          earR: isFinite(earR) ? earR : null,
          earAvg: isFinite(earAvg) ? earAvg : (isFinite(emaEAR) ? emaEAR : null),
          ear0: ear0 || null,
          earThresh: earThresh || null,
          perclos, // 0~1
          blinkRate,
          gazeDev: isFinite(gazeDev) ? gazeDev : (isFinite(emaGaze) ? emaGaze : 0),
        },
      })
    );
  });
}
