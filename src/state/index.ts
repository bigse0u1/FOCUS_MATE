// src/state/index.ts
import type { MetricsSnapshot, StateOutput, FocusState } from "../types";

type StateConfig = {
  perclosWarn: number;     // 피곤 경고
  perclosAlert: number;    // 졸림 경고
  dwellMinMs: number;      // 산만 판단 임계(이하이면 산만)
  dwellGoodMs: number;     // 집중 가점 기준
  hysteresis: number;      // 상태 전환 민감도 억제(점수 여유)
  cooldownMs: number;      // 같은 상태 재알림 최소 간격
};

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export class StateMachine {
  private last: FocusState = "FOCUSED";
  private lastChange = 0;

  private cfg: StateConfig = {
    perclosWarn: 0.20,
    perclosAlert: 0.40,
    dwellMinMs: 1500,
    dwellGoodMs: 2000,
    hysteresis: 5,
    cooldownMs: 60000,
  };

  setThresholds(cfg: Partial<StateConfig>) { this.cfg = { ...this.cfg, ...cfg }; }

  /** 점수화: (1-PERCLOS)*0.6 + dwell(정규화)*0.4 - 안정도 패널티(소량) */
  private computeScore(m: MetricsSnapshot) {
    const f1 = (1 - clamp(m.perclos, 0, 1));                         // 눈 뜸 비율
    const f2 = clamp(m.fixation.dwellMs / this.cfg.dwellGoodMs, 0, 1); // 오래 응시할수록 +
    const penalty = clamp(m.fixation.stability * 12, 0, 0.2);        // 흔들리면 소량 감점
    const score01 = clamp(0.6 * f1 + 0.4 * f2 - penalty, 0, 1);
    return Math.round(score01 * 100); // 0~100 점수
  }

  update(m: MetricsSnapshot): StateOutput | null {
    const reasons: string[] = [];
    let state: FocusState = "FOCUSED";

    // 1) 우선순위 판정: 졸음 > 피곤 > 산만 > 집중
    if (m.perclos >= this.cfg.perclosAlert) {
      state = "DROWSY"; reasons.push(`PERCLOS≥${Math.round(this.cfg.perclosAlert*100)}%: DROWSY`);
    } else if (m.perclos >= this.cfg.perclosWarn) {
      state = "TIRED";  reasons.push(`PERCLOS≥${Math.round(this.cfg.perclosWarn*100)}%: TIRED`);
    } else if (!m.fixation.isFixed || m.fixation.dwellMs < this.cfg.dwellMinMs) {
      state = "DISTRACTED"; reasons.push(`dwell<${this.cfg.dwellMinMs}ms: DISTRACTED`);
    } else {
      state = "FOCUSED";
    }

    // 2) 점수 계산(설명 가능한 수치)
    const score = this.computeScore(m);
    reasons.push(`score=${score} (1-PERCLOS, dwell, stability 반영)`);

    // 3) 히스테리시스: 상태 전환 튐 방지
    if (this.last !== state) {
      const prevScore = 50; // 기준점
      if (score < prevScore + this.cfg.hysteresis) {
        reasons.push(`hysteresis: keep ${this.last}`);
        state = this.last;
      }
    }

    // 4) 쿨다운: 같은 상태 재알림 간격 제한
    const now = m.t;
    if (state === this.last && now - this.lastChange < this.cfg.cooldownMs) {
      return null; // 알림/이벤트 중복 방지
    }

    if (state !== this.last) { this.last = state; this.lastChange = now; }
    return { t: m.t, state, score, reason: reasons };
  }
}
