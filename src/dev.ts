// src/dev.ts
import { createVision } from "./vision";
import { Metrics } from "./metrics";
import { StateMachine } from "./state/index";
import type { VisionFrame, XY } from "./types";

// helpers
const toXY = (pt: number[]): XY => ({ x: pt[0], y: pt[1] });
const pair = (p: any): [number, number] =>
  Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y];

// Vision(1-1) → Metrics 가 기대하는 타입으로 어댑트
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

// raw(vision 결과)에서 가능한 모든 위치에서 전체 랜드마크를 찾아냄
function extractLandmarks(raw: any): [number, number][] {
  const maybe =
    raw?.landmarks ??
    raw?.faceLandmarks?.[0] ??
    raw?.mesh ??
    raw?.points ??
    [];
  return Array.isArray(maybe) ? maybe.map(pair) : [];
}

async function main() {
  const vision = await createVision();

  // 📌 index.html의 #cam 자리를 vision.video로 교체해서 DOM에 부착
  const cam = document.getElementById("cam");
  if (cam && cam.parentElement) {
    vision.video.setAttribute("id", "cam");
    vision.video.setAttribute("playsinline", "true");
    vision.video.setAttribute("autoplay", "true");
    vision.video.setAttribute("muted", "true");
    cam.parentElement.replaceChild(vision.video, cam);
  }

  const metrics = new Metrics();
  const ctrl = new StateMachine();

  // 개발용 텍스트 패널(숨겨도 OK)
  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:fixed","left:12px","top:12px","padding:8px 12px",
    "background:rgba(0,0,0,.6)","color:#fff","font:12px/1.4 monospace",
    "border-radius:8px","z-index:9999","white-space:pre",
  ].join(";");
  document.body.appendChild(panel);

  metrics.calibrate(3);

  let currentState = "FOCUSED";
  let currentScore = 0;
  let last = 0;

  vision.onFrame((raw: any) => {
    const now = performance.now();
    if (now - last < 100) return; // UI 10fps
    last = now;

    // 1) 비전 프레임 어댑트
    const f = adaptFrame(raw);

    // 2) 전체 랜드마크 (없을 수 있으니 방어적으로)
    const landmarks = extractLandmarks(raw);

    // 3) 미니 얼굴용 이벤트 (항상 송신)
    window.dispatchEvent(
      new CustomEvent("fm:vision", {
        detail: {
          landmarks, // ★ 전체 얼굴 랜드마크(정규화 [x,y])
          eyes: { l: f.eyes.l.map(pair), r: f.eyes.r.map(pair) },
          iris: { l: pair(f.iris.l), r: pair(f.iris.r) },
          conf: f.conf,
          t: f.t,
        },
      })
    );

    // 4) 메트릭 계산 & 표 갱신
    const snap = metrics.pushFrame(f);
    if (snap) {
      window.dispatchEvent(new CustomEvent("fm:metrics", { detail: snap }));

      // 5) 상태머신
      const out = ctrl.update(snap);
      if (out) {
        currentState = out.state;
        currentScore = out.score ?? 0;
        window.dispatchEvent(new CustomEvent("fm:state", { detail: out }));
        panel.textContent =
          `STATE: ${out.state} | score:${out.score ?? 0}\n` +
          `EAR:${snap.earAvg.toFixed(3)}  PERCLOS:${(snap.perclos * 100).toFixed(0)}%\n` +
          `FIX:${snap.fixation.isFixed ? "Y" : "N"}@${snap.fixation.roiKey}  ` +
          `dwell:${Math.round(snap.fixation.dwellMs)}ms` +
          (out.reason
            ? `\nreason: ${Array.isArray(out.reason) ? out.reason.join(" | ") : out.reason}`
            : "");
      } else {
        panel.textContent =
          `STATE: ${currentState} | score:${currentScore}\n` +
          `EAR:${snap.earAvg.toFixed(3)}  PERCLOS:${(snap.perclos * 100).toFixed(0)}%\n` +
          `FIX:${snap.fixation.isFixed ? "Y" : "N"}@${snap.fixation.roiKey}  ` +
          `dwell:${Math.round(snap.fixation.dwellMs)}ms`;
      }
    }
  });

  await vision.start(); // 카메라 권한
}

main();
