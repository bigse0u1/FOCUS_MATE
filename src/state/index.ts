/**
 * state/index.ts
 * - fm:metrics를 받아 집중도 점수와 상태 배지 산정
 * - 히스테리시스로 상태 출렁임 완화
 * - fm:state 이벤트 송출
 */

type Metrics = {
  ts: number;
  valid: boolean;
  conf: number;
  earL: number | null;
  earR: number | null;
  earAvg: number | null;
  ear0: number | null;
  earThresh: number | null;
  perclos: number;       // 0~1
  blinkRate: number;     // /min
  gazeDev: number;       // 0~1
};

// ======= 설정 =======

// 점수식 가중치
const W_PERCLOS = 0.42;  // p
const W_BLINK   = 0.18;  // b
const W_GAZE    = 0.40;  // g

// blinkRate 정규화 기준치(분당)
const BLINK_NORM = 30;

// 점수 EMA
const SCORE_EMA_ALPHA = 0.2;

// 상태 히스테리시스 임계
const THRESH_FOCUS_ENTER = 72;
const THRESH_FOCUS_EXIT  = 68;

const THRESH_DISTRACT_ENTER = 50;
const THRESH_DISTRACT_EXIT  = 55;

const THRESH_DROWSY_ENTER = 30;
const THRESH_DROWSY_EXIT  = 35;

// ======= 내부 상태 =======
let inited = false;
let emaScore = 0;
let currState: 'focus' | 'transition' | 'distract' | 'drowsy' = 'transition';

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function ema(prev: number, value: number, alpha: number) {
  if (!isFinite(prev) || prev === 0) return value;
  return prev + alpha * (value - prev);
}

function computeScore(m: Metrics) {
  const p = clamp01(m.perclos);                          // 0..1
  const b = clamp01(m.blinkRate / BLINK_NORM);           // 0..1
  const g = clamp01(m.gazeDev);                          // 0..1
  let score = 100 - (W_PERCLOS * p + W_BLINK * b + W_GAZE * g) * 100;
  if (!isFinite(score)) score = 0;
  return clamp01(score / 100) * 100;
}

function nextStateFrom(score: number) {
  // 히스테리시스 적용
  switch (currState) {
    case 'focus':
      if (score < THRESH_FOCUS_EXIT) return 'transition';
      return 'focus';
    case 'transition':
      if (score >= THRESH_FOCUS_ENTER) return 'focus';
      if (score < THRESH_DISTRACT_ENTER) return 'distract';
      return 'transition';
    case 'distract':
      if (score >= THRESH_DISTRACT_EXIT) return 'transition';
      if (score < THRESH_DROWSY_ENTER) return 'drowsy';
      return 'distract';
    case 'drowsy':
      if (score >= THRESH_DROWSY_EXIT) return 'distract';
      return 'drowsy';
  }
}

export function initState() {
  if (inited) return;
  inited = true;

  window.addEventListener('fm:metrics', (ev: any) => {
    const m = ev.detail as Metrics;

    // 점수 계산 (+ EMA 평활)
    const rawScore = computeScore(m);
    emaScore = ema(emaScore, rawScore, SCORE_EMA_ALPHA);

    // 상태 산정 (EMA 점수 기준)
    const state = nextStateFrom(emaScore);
    currState = state as any;

    // 송출
    const detail = {
      ts: m.ts,
      score: emaScore,                // 0~100
      state,                          // 'focus' | 'transition' | 'distract' | 'drowsy'
      perclos: m.perclos,             // 0~1
      blinkRate: m.blinkRate,         // /min
      gazeDev: m.gazeDev,             // 0~1
      earAvg: m.earAvg,
      ear0: m.ear0,
      earThresh: m.earThresh,
      valid: m.valid,
      conf: m.conf
    };
    window.dispatchEvent(new CustomEvent('fm:state', { detail }));
  });
}
