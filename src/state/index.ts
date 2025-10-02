// src/state/index.ts
import type { MetricsSnapshot, StateOutput, FocusState } from "../types";

// cfg 타입을 따로 정의 (typeof this.cfg 사용 지양)
type StateConfig = {
  perclosWarn: number;
  perclosAlert: number;
  hysteresis: number;
  cooldownMs: number;
};

export class StateMachine {
  private last: FocusState = "FOCUSED";
  private lastChange = 0;

  private cfg: StateConfig = {
    perclosWarn: 0.2,
    perclosAlert: 0.4,
    hysteresis: 5,
    cooldownMs: 60000,
  };

  setThresholds(cfg: Partial<StateConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
  }

  update(m: MetricsSnapshot): StateOutput | null {
    const reasons: string[] = [];
    let scoreSleep = 0;
    let scoreDistract = 0;

    // 졸음 판정
    if (m.perclos >= this.cfg.perclosAlert) {
      scoreSleep = 85;
      reasons.push("PERCLOS≥40%: DROWSY");
    } else if (m.perclos >= this.cfg.perclosWarn) {
      scoreSleep = 65;
      reasons.push("PERCLOS≥20%: TIRED");
    }

    // 산만 판정
    if (!m.fixation.isFixed || m.fixation.dwellMs < 1500) {
      scoreDistract = 65;
      reasons.push("dwell<1.5s: DISTRACTED");
    } else if (m.fixation.dwellMs >= 2000) {
      scoreDistract = Math.max(0, scoreDistract - 20);
    }

    // 상태 선택 (우선순위: 졸음 > 산만 > 집중)
    let state: FocusState = "FOCUSED";
    let score = 0;
    if (scoreSleep >= 75) {
      state = "DROWSY";
      score = scoreSleep;
    } else if (scoreSleep >= 60) {
      state = "TIRED";
      score = scoreSleep;
    } else if (scoreDistract >= 60) {
      state = "DISTRACTED";
      score = scoreDistract;
    }

    // 히스테리시스
    if (this.last !== state) {
      const need = this.cfg.hysteresis;
      const prevScore = 50;
      if (score < prevScore + need) state = this.last;
    }

    // 쿨다운
    const now = m.t;
    if (state === this.last && now - this.lastChange < this.cfg.cooldownMs) {
      return null;
    }

    if (state !== this.last) {
      this.last = state;
      this.lastChange = now;
    }

    return { t: m.t, state, score, reason: reasons };
  }
}
