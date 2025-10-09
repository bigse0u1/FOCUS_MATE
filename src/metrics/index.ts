// src/metrics/index.ts
import type { VisionFrame, MetricsSnapshot, XY, BlinkEvent } from "../types";

/** 두 점 거리 */
function dist(a: XY, b: XY) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }

/** EAR 계산: (수직) / (수평*2) — 4점(상/하, 좌/우) 버전 */
function earFromEye(eye: XY[]): number {
  if (eye.length < 4) return NaN;
  const V = dist(eye[0], eye[1]); // 위–아래
  const H = dist(eye[2], eye[3]); // 좌–우
  return V / (2 * H || 1);
}

/** 보조: clamp */
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export class Metrics {
  /** 개인화 임계 T(EAR) */
  private T = 0;
  private calibrated = false;
  private calibSamples: number[] = [];

  /** PERCLOS: 최근 60s 프레임 윈도우 */
  private perclosWindow: { t: number; closed: 0 | 1 }[] = [];

  /** Blink 검출 상태 */
  private blinkActive = false;
  private blinkStart = 0;
  private lastEAR = 0;

  /** I-DT용 150ms 창 */
  private idtWindow: { t: number; p: XY }[] = [];

  /** ROI/dwell */
  private dwellStart = 0;
  private lastRoi = "";

  /**
   * 3초 캘리브레이션: 그동안 들어오는 EAR 평균×0.72를 임계로 사용
   * (주의: 호출 즉시 프레임 수집은 계속 진행해야 하므로 await 하지 않아도 됨)
   */
  async calibrate(seconds = 3) {
    this.T = 0; this.calibrated = false; this.calibSamples = [];
    await new Promise((r) => setTimeout(r, seconds * 1000));
    if (this.calibSamples.length >= 5) {
      const avg = this.calibSamples.reduce((s, v) => s + v, 0) / this.calibSamples.length;
      // 너무 낮게 잡히는 것 방지(하한선)
      this.T = clamp(avg * 0.72, 0.08, 0.3);
      this.calibrated = true;
    }
  }

  pushFrame(f: VisionFrame): MetricsSnapshot | null {
    const { t, eyes, iris, conf } = f;
    if (conf < 0.5 || eyes.l.length < 4 || eyes.r.length < 4) return null;

    // ---- EAR / Blink --------------------------------------------------------
    const earL = earFromEye(eyes.l);
    const earR = earFromEye(eyes.r);
    const earAvg = (earL + earR) / 2;

    // 캘리브레이션 샘플 누적
    if (!this.calibrated && Number.isFinite(earAvg)) this.calibSamples.push(earAvg);

    // Blink: 임계선(T) 아래로 내려갔다가 다시 올라올 때
    let blink: BlinkEvent | undefined;
    if (this.calibrated && Number.isFinite(earAvg)) {
      const under = earAvg < this.T;
      if (under && !this.blinkActive) { this.blinkActive = true; this.blinkStart = t; }
      if (!under && this.blinkActive) {
        this.blinkActive = false;
        const duration = t - this.blinkStart;
        blink = {
          start: this.blinkStart,
          end: t,
          duration,
          closingSpeed: (this.lastEAR - this.T) / (duration / 2 || 1),
          openingSpeed: (earAvg - this.T) / (duration / 2 || 1),
        };
      }
    }
    this.lastEAR = earAvg;

    // ---- PERCLOS(60s 슬라이딩) ---------------------------------------------
    const now = t, cutoff = now - 60000;
    const closed = (this.calibrated && Number.isFinite(earAvg) && earAvg < this.T) ? 1 : 0;
    this.perclosWindow.push({ t: now, closed });
    while (this.perclosWindow.length && this.perclosWindow[0].t < cutoff) this.perclosWindow.shift();

    let perclos = 0;
    if (this.perclosWindow.length) {
      const sumClosed = this.perclosWindow.reduce((s, v) => s + v.closed, 0);
      perclos = sumClosed / this.perclosWindow.length; // 0~1
    }
    // 부드럽게(가벼운 EMA 30s 느낌) — 선택 사항
    // perclos = 0.8 * perclosPrev + 0.2 * perclos;  // 구현 단순화를 위해 생략

    // ---- I-DT(150ms): 분산 + 평균속도 기반 고정 판정 -------------------------
    const idtCut = now - 150;
    this.idtWindow.push({ t: now, p: iris.l });
    while (this.idtWindow.length && this.idtWindow[0].t < idtCut) this.idtWindow.shift();

    const xs = this.idtWindow.map(v => v.p.x);
    const ys = this.idtWindow.map(v => v.p.y);
    const disp = Math.max((Math.max(...xs) - Math.min(...xs)), (Math.max(...ys) - Math.min(...ys))); // 분산 근사
    // 평균 속도(프레임 간 거리)
    let avgSpeed = 0;
    if (this.idtWindow.length >= 2) {
      let sum = 0;
      for (let i = 1; i < this.idtWindow.length; i++) {
        sum += dist(this.idtWindow[i - 1].p, this.idtWindow[i].p);
      }
      avgSpeed = sum / (this.idtWindow.length - 1);
    }
    // 임계: 화면 짧은 변의 약 0.8% + 속도 0.25%/step
    const isFixed = (disp <= 0.008) && (avgSpeed <= 0.0025);

    // ---- ROI 3×3 & dwell ----------------------------------------------------
    const rx = Math.min(2, Math.max(0, Math.floor(iris.l.x * 3)));
    const ry = Math.min(2, Math.max(0, Math.floor(iris.l.y * 3)));
    const roiKey = `${rx},${ry}`;

    if (isFixed) {
      if (this.lastRoi !== roiKey) { this.lastRoi = roiKey; this.dwellStart = now; }
    } else {
      this.dwellStart = now; // 움직였으니 리셋
    }
    const dwellMs = now - (this.dwellStart || now);

    // ---- stability(표준편차 근사) -------------------------------------------
    const meanX = xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
    const meanY = ys.reduce((s, v) => s + v, 0) / (ys.length || 1);
    const stability = Math.sqrt(
      (xs.reduce((s, v) => s + (v - meanX) ** 2, 0) + ys.reduce((s, v) => s + (v - meanY) ** 2, 0)) /
      ((xs.length + ys.length) || 1)
    );

    // ---- 결과 ---------------------------------------------------------------
    return {
      t, earL, earR, earAvg, blink, perclos,
      fixation: { isFixed, dwellMs, stability, roiKey },
    };
  }
}
