// src/metrics/index.ts
import type { VisionFrame, MetricsSnapshot, XY, BlinkEvent } from "../types";

function dist(a: XY, b: XY) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// EAR 계산: (수직) / (수평*2). Mediapipe 단순 4점 버전
function earFromEye(eye: XY[]): number {
  if (eye.length < 4) return NaN;
  const V = dist(eye[0], eye[1]);   // 수직
  const H = dist(eye[2], eye[3]);   // 수평
  return V / (2 * H);
}

export class Metrics {
  private T = 0.0; // EAR 임계 (개인화)
  private calibrated = false;
  private calibSamples: number[] = [];

  private perclosWindow: { t: number; closed: 0 | 1 }[] = []; // 최근 60s
  private lastEAR = 0;

  private blinkActive = false;
  private blinkStart = 0;

  private idtWindow: { t: number; p: XY }[] = []; // 150ms
  private dwellStart = 0;
  private lastRoi = "";

  // 빠른 3초 캘리브레이션(수업 시연용)
  async calibrate(seconds = 3) {
    this.T = 0;
    this.calibrated = false;
    this.calibSamples = [];
    await new Promise((r) => setTimeout(r, seconds * 1000));
    if (this.calibSamples.length) {
      const avg = this.calibSamples.reduce((s, v) => s + v, 0) / this.calibSamples.length;
      this.T = avg * 0.72; // 개인 EAR × 0.72
      this.calibrated = true;
    }
  }

  pushFrame(f: VisionFrame): MetricsSnapshot | null {
    const { t, eyes, iris, conf } = f;
    if (conf < 0.5 || eyes.l.length < 4 || eyes.r.length < 4) return null;

    const earL = earFromEye(eyes.l);
    const earR = earFromEye(eyes.r);
    const earAvg = (earL + earR) / 2;

    // 캘리브레이션 중이면 샘플 누적
    if (!this.calibrated) this.calibSamples.push(earAvg);

    // Blink 검출
    let blink: BlinkEvent | undefined;
    if (this.calibrated) {
      const under = earAvg < this.T;
      if (under && !this.blinkActive) {
        this.blinkActive = true;
        this.blinkStart = t;
      }
      if (!under && this.blinkActive) {
        this.blinkActive = false;
        const duration = t - this.blinkStart;
        blink = {
          start: this.blinkStart,
          end: t,
          duration,
          // 간단 속도 근사 (임계선 대비 변화량 / 반주기 시간)
          closingSpeed: (this.lastEAR - this.T) / (duration / 2 || 1),
          openingSpeed: (earAvg - this.T) / (duration / 2 || 1),
        };
      }
    }

    // PERCLOS(60s)
    const now = t;
    const cutoff = now - 60000;
    const closed = this.calibrated && earAvg < this.T ? 1 : 0;
    this.perclosWindow.push({ t: now, closed });
    while (this.perclosWindow.length && this.perclosWindow[0].t < cutoff) {
      this.perclosWindow.shift();
    }
    const perclos = this.perclosWindow.length
      ? this.perclosWindow.reduce((s, v) => s + v.closed, 0) / this.perclosWindow.length
      : 0;

    // I-DT(150ms)로 fixation 판정
    const idtCut = now - 150;
    this.idtWindow.push({ t: now, p: iris.l });
    while (this.idtWindow.length && this.idtWindow[0].t < idtCut) {
      this.idtWindow.shift();
    }
    const xs = this.idtWindow.map((v) => v.p.x);
    const ys = this.idtWindow.map((v) => v.p.y);
    const disp = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys)
    );
    const isFixed = disp <= 0.01; // 화면 짧은 변 1% ≈ 정규화 0.01

    // ROI 3x3 그리드
    const rx = Math.min(2, Math.max(0, Math.floor(iris.l.x * 3)));
    const ry = Math.min(2, Math.max(0, Math.floor(iris.l.y * 3)));
    const roiKey = `${rx},${ry}`;

    if (isFixed) {
      if (this.lastRoi !== roiKey) {
        this.lastRoi = roiKey;
        this.dwellStart = now;
      }
    } else {
      this.dwellStart = now; // 움직였으니 다시 카운트
    }
    const dwellMs = now - (this.dwellStart || now);

    // stability(표준편차 근사)
    const meanX = xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
    const meanY = ys.reduce((s, v) => s + v, 0) / (ys.length || 1);
    const stability = Math.sqrt(
      (xs.reduce((s, v) => s + (v - meanX) ** 2, 0) +
        ys.reduce((s, v) => s + (v - meanY) ** 2, 0)) / ((xs.length + ys.length) || 1)
    );

    this.lastEAR = earAvg;

    return {
      t,
      earL,
      earR,
      earAvg,
      blink,
      perclos,
      fixation: { isFixed, dwellMs, stability, roiKey },
    };
  }
}