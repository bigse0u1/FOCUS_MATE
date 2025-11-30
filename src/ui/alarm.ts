// src/ui/alarm.ts
// ------------------------------------
// 최근 5분 상태를 보고 집중이 많이 깨지면
// 5분에 한 번만 팝업 + (옵션) 소리 알림
// ------------------------------------

import type { FMState } from "../db";

declare global {
  interface Window {
    fmAlarmMuted?: boolean; // true면 소리 끔
  }
}

type Sample = {
  ts: number;
  state: FMState;
};

const WINDOW_MS = 5 * 60 * 1000;     // 최근 5분
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 알람 최소 간격 5분
const TARGET_FPS = 15;

const samples: Sample[] = [];
let lastAlarmTs = 0;

// ========================
// 외부에서 호출: UI + 리스너 초기화
// ========================
export function initAlarmUI() {
  const btnSound = document.getElementById(
    "btnAlarmSound"
  ) as HTMLButtonElement | null;
  const popup = document.getElementById("alarmPopup") as HTMLElement | null;
  const btnClose = document.getElementById(
    "btnAlarmClose"
  ) as HTMLButtonElement | null;

  // 기본값: 소리 켜짐
  if (window.fmAlarmMuted === undefined) {
    window.fmAlarmMuted = false;
  }

  if (btnSound) {
    updateSoundButton(btnSound);
    btnSound.addEventListener("click", () => {
      window.fmAlarmMuted = !window.fmAlarmMuted;
      updateSoundButton(btnSound);
    });
  }

  btnClose?.addEventListener("click", () => {
    popup?.classList.add("hidden");
  });

  // fm:state 이벤트를 계속 보고 5분 윈도우 계산
  window.addEventListener("fm:state", (e: any) => {
    const { ts, state } = e.detail as { ts: number; state: FMState; score: number };
    onNewState(ts, state);
  });
}

function updateSoundButton(btn: HTMLButtonElement) {
  const muted = !!window.fmAlarmMuted;
  btn.textContent = muted ? "알람 소리 OFF" : "알람 소리 ON";
}

// ========================
// 상태 수신 로직
// ========================
function onNewState(ts: number, state: FMState) {
  // 샘플 버퍼에 추가
  samples.push({ ts, state });

  // 오래된 샘플 제거 (5분보다 이전)
  const cutoff = ts - WINDOW_MS;
  while (samples.length && samples[0].ts < cutoff) {
    samples.shift();
  }

  // 알람 쿨타임: 5분 안에 이미 울렸으면 무시
  if (ts - lastAlarmTs < MIN_INTERVAL_MS) return;

  // 현재 상태가 "focus"면 알람 X
  if (state === "focus") return;

  if (!samples.length) return;

  // 최근 5분 동안 상태별 시간 계산 (ts 차이 기반)
  let focusMs = 0;
  let distractMs = 0;
  let drowsyMs = 0;
  let fatigueMs = 0;

  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    const nextTs =
      i < samples.length - 1
        ? samples[i + 1].ts
        : cur.ts + 1000 / TARGET_FPS;
    const dt = Math.max(0, nextTs - cur.ts);

    if (cur.state === "focus") focusMs += dt;
    else if (cur.state === "distract") distractMs += dt;
    else if (cur.state === "drowsy") drowsyMs += dt;
    else if (cur.state === "fatigue") fatigueMs += dt;
    // transition 은 여기선 중립으로 취급
  }

  const totalMs = focusMs + distractMs + drowsyMs + fatigueMs;
  if (totalMs < 60_000) {
    // 데이터가 1분 미만이면 아직 너무 짧으니까 패스
    return;
  }

  const badMs = distractMs + drowsyMs + fatigueMs;
  const badRatio = badMs / totalMs;

  // 규칙:
  // - 최근 5분 중 "산만/졸음/피로" 비율이 40% 이상
  // - 현재 상태도 focus 가 아님
  //  → 집중 흐트러졌다고 판단하고 알람
  if (badRatio >= 0.4) {
    triggerAlarm(ts);
  }
}

// ========================
// 실제 알람 표시 + 소리 재생
// ========================
function triggerAlarm(ts: number) {
  lastAlarmTs = ts;

  const popup = document.getElementById("alarmPopup");
  popup?.classList.remove("hidden");

  if (!window.fmAlarmMuted) {
    const audioEl = document.getElementById("alarmSound") as HTMLAudioElement | null;
    audioEl
      ?.play()
      .catch(() => {
        // 자동재생 제한 등으로 실패해도 그냥 무시
      });
  }
}
