// src/dev.ts
import { createVision } from "./vision";          // 폴더 index.ts 자동 인식
import { Metrics } from "./metrics";              // 폴더 index.ts 자동 인식
import { StateMachine } from "./state/index";     // 명시 경로 (안전)
import type { VisionFrame, XY } from "./types";

// number[] → {x,y} 변환
function toXY(pt: number[]): XY {
  return { x: pt[0], y: pt[1] };
}

// Vision(1-1) 프레임을 Metrics가 기대하는 타입으로 어댑트
function adaptFrame(f: any): VisionFrame {
  return {
    t: f.t,
    conf: f.conf,
    eyes: {
      l: f.eyes.l.map(toXY),
      r: f.eyes.r.map(toXY),
    },
    iris: { l: toXY(f.iris.l), r: toXY(f.iris.r) },
  };
}

async function main() {
  const vision = await createVision();
  const metrics = new Metrics();
  const ctrl = new StateMachine(); // 1-3 상태 머신

  // 화면 좌상단 상태 패널
  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:fixed",
    "left:12px",
    "top:12px",
    "padding:8px 12px",
    "background:rgba(0,0,0,.6)",
    "color:#fff",
    "font:12px/1.4 monospace",
    "border-radius:8px",
    "z-index:9999",
    "white-space:pre", // 줄바꿈 유지
  ].join(";");
  document.body.appendChild(panel);

  // 3초 후 자동 임계치(T) 설정 (프레임 수집은 계속)
  metrics.calibrate(3);

  let last = 0;
  vision.onFrame((raw: any) => {
    const now = performance.now();
    if (now - last < 100) return; // 10fps로 패널 갱신
    last = now;

    const f = adaptFrame(raw);
    const snap = metrics.pushFrame(f);
    if (!snap) return;

    // 1-3 상태 머신에 메트릭 전달
    const out = ctrl.update(snap);
    if (out) {
      // 패널 업데이트 + 로그
      panel.textContent =
        `STATE: ${out.state} | score:${out.score ?? 0}\n` +
        `EAR:${snap.earAvg.toFixed(3)}  PERCLOS:${(snap.perclos * 100).toFixed(0)}%\n` +
        `FIX:${snap.fixation.isFixed ? "Y" : "N"}@${snap.fixation.roiKey}  ` +
        `dwell:${Math.round(snap.fixation.dwellMs)}ms` +
        (out.reason
          ? `\nreason: ${
              Array.isArray(out.reason) ? out.reason.join(" | ") : out.reason
            }`
          : "");

      console.log("[STATE]", out);
    } else {
      // 상태 변화가 없을 때도 기본 지표는 표시
      panel.textContent =
        `STATE: ${(panel.dataset.state as string) ?? "FOCUSED"}\n` +
        `EAR:${snap.earAvg.toFixed(3)}  PERCLOS:${(snap.perclos * 100).toFixed(0)}%\n` +
        `FIX:${snap.fixation.isFixed ? "Y" : "N"}@${snap.fixation.roiKey}  ` +
        `dwell:${Math.round(snap.fixation.dwellMs)}ms`;
    }
  });

  await vision.start(); // ← 여기서 실제 카메라 권한 팝업이 뜸
}

main();