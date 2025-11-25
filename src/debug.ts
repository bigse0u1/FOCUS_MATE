// src/debug.ts
// 환경설정 탭용 디버그 시각화 + 측정값 테이블

const lmCanvas = document.getElementById("lmCanvas") as HTMLCanvasElement | null;
const debugVideo = document.getElementById("debugVideo") as HTMLVideoElement | null;
const ctx = lmCanvas ? lmCanvas.getContext("2d") : null;

const W = 520;
const H = 390;

if (lmCanvas) {
  lmCanvas.width = W;
  lmCanvas.height = H;
}

// === 카메라 스트림 연결 ===
window.addEventListener("fm:camera-stream", (e: any) => {
  const { stream } = e.detail as { stream: MediaStream };
  if (debugVideo && !debugVideo.srcObject) {
    debugVideo.srcObject = stream;
  }
});

// === 랜드마크 표시 (항상 표시: 토글 없음) ===
window.addEventListener("fm:vision", (e: any) => {
  if (!ctx) return;

  const { left, right, conf, valid } = e.detail;
  ctx.clearRect(0, 0, W, H);

  if (!valid) {
    (document.getElementById("dbgConf") as HTMLElement).innerText =
      typeof conf === "number" ? conf.toFixed(2) : "-";
    (document.getElementById("dbgValid") as HTMLElement).innerText = "false";
    (document.getElementById("dbgFps") as HTMLElement).innerText = "15";
    return;
  }

  ctx.fillStyle = "red";
  ctx.globalAlpha = 0.9;

  const pts = [...(left?.pts ?? []), ...(right?.pts ?? [])];
  for (const p of pts) {
    const x = p.x * W;
    const y = p.y * H;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  (document.getElementById("dbgConf") as HTMLElement).innerText = conf.toFixed(2);
  (document.getElementById("dbgValid") as HTMLElement).innerText = String(valid);
  (document.getElementById("dbgFps") as HTMLElement).innerText = "15";
});

// === fm:metrics → 표 값 채우기 (EAR / PERCLOS / Gaze dev + 방향) ===
window.addEventListener("fm:metrics", (e: any) => {
  const {
    earL,
    earR,
    earAvg,
    perclos,
    gazeDev,
    gazeDirLabel,
  } = e.detail || {};

  const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

  // EAR(L/R/avg)
  const earEl = $("dbgEAR");
  if (earEl) {
    if (earL != null && earR != null && earAvg != null) {
      earEl.textContent = `${earL.toFixed(3)} / ${earR.toFixed(3)} / ${earAvg.toFixed(3)}`;
    } else {
      earEl.textContent = "-";
    }
  }

  // PERCLOS(1m)
  const perclosEl = $("dbgPERCLOS");
  if (perclosEl) {
    if (perclos != null) {
      perclosEl.textContent = `${(perclos * 100).toFixed(1)}%`;
    } else {
      perclosEl.textContent = "-";
    }
  }

  // 🔹 Gaze dev + 시선 방향(텍스트)
  const gazeEl = $("dbgGaze");
  if (gazeEl) {
    if (gazeDev != null) {
      const devText = gazeDev.toFixed(3);
      const dirText = gazeDirLabel ?? "";
      // 예: "0.042 (오른쪽 위)"
      gazeEl.textContent = dirText ? `${devText} (${dirText})` : devText;
    } else {
      gazeEl.textContent = "-";
    }
  }

  // Pose는 아직 미구현
  const poseEl = $("dbgPose");
  if (poseEl) {
    poseEl.textContent = "-";
  }
});

export {};
