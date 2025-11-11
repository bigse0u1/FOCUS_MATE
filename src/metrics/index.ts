/**
 * metrics/index.ts
 * - fm:vision 이벤트(눈 좌표 6점/좌·우)를 받아 EAR/PERCLOS/깜빡임/시선편차 계산
 * - fm:metrics 이벤트로 지표 송출
 * - runCalibration(seconds): EAR 베이스라인 캘리브레이션 제공
 */

type Pt = { x: number; y: number };

type VisionFrame = {
  ts: number;                 // ms
  fps?: number;
  left: { pts: Pt[] };
  right: { pts: Pt[] };
  conf: number;               // 0~1
  valid: boolean;
};

// ======= 설정(필요시 조정) =======

// PERCLOS 윈도우(초)
const PERCLOS_WINDOW_SEC = 60;

// 깜빡임 하한/상한(초) — 이 범위를 벗어나면 깜빡임으로 보지 않음
const BLINK_MIN_DUR = 0.05;   // 50ms
const BLINK_MAX_DUR = 0.8;    // 800ms

// EAR 임계 배율 (캘리브레이션한 EAR0 * 이 값 이하이면 '감김'으로 간주)
const EAR_THRESH_RATIO = 0.72;

// 시선편차 정규화용 최대 반경(화면 중심에서 거리)
const GAZE_MAX_RADIUS = 0.35; // 0.35 ~ 0.45 사이 추천

// 지표 노이즈 제거용 EMA(지수 이동 평균) 알파
const EMA_ALPHA = 0.25;

// ======= 내부 상태 =======
let inited = false;
let earBaseline = 0;          // 캘리브레이션 결과
let earThresh = 0;            // earBaseline * EAR_THRESH_RATIO

// PERCLOS용 히스토리 (isClosed = true/false)
type CloseFlag = { ts: number; closed: boolean; valid: boolean };
const closeHistory: CloseFlag[] = [];

// Blink 검출 상태
let wasClosed = false;
let closeStartTs = 0;
let blinkTimes: number[] = []; // 최근 60초 내 깜빡임 발생 시각(ms)

// EMA 상태
let emaEarAvg = 0;
let emaGazeDev = 0;

// ======= 유틸 =======

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function dist2D(a: Pt, b: Pt) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// Soukupová & Čech (2016) EAR 2D
function calcEAR6(pts: Pt[]): number {
  // 입력은 [p1,p2,p3,p4,p5,p6] 순서를 가정(vision에서 동일 인덱스 순서로 매핑)
  if (pts.length < 6) return NaN;
  const p1 = pts[0], p2 = pts[1], p3 = pts[2], p4 = pts[3], p5 = pts[4], p6 = pts[5];
  const num = dist2D(p2, p6) + dist2D(p3, p5);
  const den = 2 * dist2D(p1, p4);
  if (!isFinite(num) || !isFinite(den) || den === 0) return NaN;
  return num / den;
}

function ema(prev: number, value: number, alpha: number) {
  if (!isFinite(prev) || prev === 0) return value;
  return prev + alpha * (value - prev);
}

function eyeCenter(pts: Pt[]): Pt {
  let sx = 0, sy = 0, n = 0;
  for (const p of pts) {
    sx += p.x; sy += p.y; n++;
  }
  if (n === 0) return { x: 0.5, y: 0.5 };
  return { x: sx / n, y: sy / n };
}

function normGazeDev(left: Pt[], right: Pt[]) {
  // 두 눈 중심 평균과 화면 중앙(0.5,0.5)의 거리
  const lc = eyeCenter(left), rc = eyeCenter(right);
  const cx = (lc.x + rc.x) / 2, cy = (lc.y + rc.y) / 2;
  const d = Math.hypot(cx - 0.5, cy - 0.5);
  return clamp01(d / GAZE_MAX_RADIUS);
}

function pruneOld<T extends { ts: number }>(arr: T[], now: number, windowMs: number) {
  const cut = now - windowMs;
  while (arr.length && arr[0].ts < cut) arr.shift();
}

// ======= PERCLOS & Blink =======

function updatePerclosAndBlink(now: number, earAvg: number, valid: boolean) {
  // 1) PERCLOS 플래그 히스토리 갱신
  const closed = valid && earAvg <= earThresh && earThresh > 0;
  closeHistory.push({ ts: now, closed, valid });
  pruneOld(closeHistory, now, PERCLOS_WINDOW_SEC * 1000);

  // 2) Blink 검출 (닫힘→열림 전환, 지속시간 BLINK_MIN~MAX)
  if (!wasClosed && closed) {
    wasClosed = true;
    closeStartTs = now;
  } else if (wasClosed && !closed) {
    const dur = (now - closeStartTs) / 1000; // s
    wasClosed = false;
    if (dur >= BLINK_MIN_DUR && dur <= BLINK_MAX_DUR) {
      blinkTimes.push(now);
    }
  }
  pruneOld(blinkTimes.map(ts => ({ ts } as any)), now, 60 * 1000);
  blinkTimes = blinkTimes.filter(ts => ts >= now - 60_000);

  // 3) PERCLOS 계산 (유효 프레임 기준)
  const windowFrames = closeHistory.filter(f => f.valid);
  const closedFrames = windowFrames.filter(f => f.closed);
  const perclos = windowFrames.length ? (closedFrames.length / windowFrames.length) : 0;

  // 4) Blink rate (/min)
  const blinkRate = blinkTimes.length; // 최근 60초 내 갯수

  return { perclos, blinkRate };
}

// ======= 캘리브레이션 =======

export async function runCalibration(seconds = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const samples: number[] = [];
    const start = Date.now();
    let timeoutId: number | undefined;

    const onVision = (ev: any) => {
      const f: VisionFrame = ev.detail;
      if (!f?.valid) return;
      const earL = calcEAR6(f.left.pts);
      const earR = calcEAR6(f.right.pts);
      if (!isFinite(earL) || !isFinite(earR)) return;
      samples.push((earL + earR) / 2);
      if (Date.now() - start > seconds * 1000) {
        cleanup();
        if (!samples.length) return reject(new Error('no samples'));
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        earBaseline = avg;
        earThresh = earBaseline * EAR_THRESH_RATIO;
        resolve(avg);
      }
    };

    const cleanup = () => {
      window.removeEventListener('fm:vision', onVision as any);
      if (timeoutId) window.clearTimeout(timeoutId);
    };

    window.addEventListener('fm:vision', onVision as any);
    timeoutId = window.setTimeout(() => {
      cleanup();
      if (!samples.length) reject(new Error('timeout'));
      else {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        earBaseline = avg;
        earThresh = earBaseline * EAR_THRESH_RATIO;
        resolve(avg);
      }
    }, seconds * 1000 + 500);
  });
}

export function getEarBaseline() { return earBaseline; }
export function setEarBaseline(v: number) {
  earBaseline = v;
  earThresh = earBaseline * EAR_THRESH_RATIO;
}

// ======= 초기화 =======

export function initMetrics() {
  if (inited) return;
  inited = true;

  window.addEventListener('fm:vision', (ev: any) => {
    const frame: VisionFrame = ev.detail;
    const now = frame?.ts ?? Date.now();

    // conf/valid 체크
    const valid = !!frame?.valid && Array.isArray(frame.left?.pts) && Array.isArray(frame.right?.pts)
      && frame.left.pts.length >= 6 && frame.right.pts.length >= 6;

    // EAR 계산
    const earL = valid ? calcEAR6(frame.left.pts) : NaN;
    const earR = valid ? calcEAR6(frame.right.pts) : NaN;
    let earAvg = (isFinite(earL) && isFinite(earR)) ? (earL + earR) / 2 : NaN;

    // 캘리브레이션 전이면 귀찮더라도 러프하게 베이스를 '처음 2초 평균'으로 추정(임시 구동)
    if ((earBaseline === 0 || !isFinite(earBaseline)) && isFinite(earAvg)) {
      // 간단한 누적 평균(2초분만)
      if (!('_tmpEar' in (initMetrics as any))) {
        (initMetrics as any)._tmpEar = { sum: 0, n: 0, t0: now };
      }
      const t = (initMetrics as any)._tmpEar;
      if (now - t.t0 < 2000) { t.sum += earAvg; t.n++; }
      else if (t.n > 0 && earBaseline === 0) {
        earBaseline = t.sum / t.n;
        earThresh = earBaseline * EAR_THRESH_RATIO;
      }
    }

    // 시선 편차(0~1)
    let gazeDev = valid ? normGazeDev(frame.left.pts, frame.right.pts) : 0;

    // EMA로 노이즈 안정화
    if (isFinite(earAvg)) emaEarAvg = ema(emaEarAvg, earAvg, EMA_ALPHA);
    if (isFinite(gazeDev)) emaGazeDev = ema(emaGazeDev, gazeDev, EMA_ALPHA);

    // PERCLOS/BLINK
    const { perclos, blinkRate } = updatePerclosAndBlink(now, isFinite(earAvg) ? earAvg : emaEarAvg, valid);

    // fm:metrics 송출
    const detail = {
      ts: now,
      conf: frame?.conf ?? 0,
      valid,
      earL: isFinite(earL) ? earL : null,
      earR: isFinite(earR) ? earR : null,
      earAvg: isFinite(earAvg) ? earAvg : (isFinite(emaEarAvg) ? emaEarAvg : null),
      ear0: earBaseline || null,
      earThresh: earThresh || null,
      perclos,                // 0~1
      blinkRate,              // /min
      gazeDev: isFinite(gazeDev) ? gazeDev : (isFinite(emaGazeDev) ? emaGazeDev : 0), // 0~1
    };
    window.dispatchEvent(new CustomEvent('fm:metrics', { detail }));
    // 디버그 패널 숫자 갱신을 원한다면 위 detail을 debug.ts에서 수신해 표시 가능
  });
}
