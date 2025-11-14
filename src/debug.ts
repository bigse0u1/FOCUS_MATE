/**
 * src/debug.ts
 * - 환경설정 탭용 디버그 시각화 및 실시간 측정값 표시
 *   (EAR / PERCLOS / Gaze dev / Confidence 등)
 */

type VisionFrameDetail = {
  ts: number;
  fps: number;
  conf: number;
  valid: boolean;
  left: { pts: { x: number; y: number }[] };
  right: { pts: { x: number; y: number }[] };
};

const lmCanvas = document.getElementById("lmCanvas") as HTMLCanvasElement | null;
const debugVideo = document.getElementById("debugVideo") as HTMLVideoElement | null;
const toggle = document.getElementById("toggleLm") as HTMLInputElement | null;

let lmCtx: CanvasRenderingContext2D | null = null;
let canvasW = 520;
let canvasH = 390;

if (lmCanvas) {
  lmCanvas.width = canvasW;
  lmCanvas.height = canvasH;
  lmCtx = lmCanvas.getContext("2d");
}

// ========= 카메라 스트림 연결 =========
window.addEventListener("fm:camera-stream", (e: any) => {
  const { stream } = e.detail || {};
  if (debugVideo && stream) {
    debugVideo.srcObject = stream;
  }
});

// ========= 랜드마크 표시 =========
window.addEventListener("fm:vision", (e: Event) => {
  if (!toggle?.checked) return;
  if (!lmCanvas || !lmCtx) return;

  const ev = e as CustomEvent<VisionFrameDetail>;
  const { left, right, conf, valid } = ev.detail;

  lmCtx.clearRect(0, 0, canvasW, canvasH);
  if (!valid) return;

  lmCtx.fillStyle = "red";
  lmCtx.globalAlpha = 0.9;

  const pts = [...(left?.pts ?? []), ...(right?.pts ?? [])];
  for (const p of pts) {
    const x = p.x * canvasW;
    const y = p.y * canvasH;
    lmCtx.beginPath();
    lmCtx.arc(x, y, 3, 0, Math.PI * 2);
    lmCtx.fill();
  }

  // 상단 기본 값 (Confidence / Valid / FPS)
  const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

  $("dbgConf") && (($("dbgConf")!.innerText = conf.toFixed(2)));
  $("dbgValid") && (($("dbgValid")!.innerText = String(valid)));
  $("dbgFps") && (($("dbgFps")!.innerText = "15")); // 지금은 고정 15fps 기준
});

// ========= fm:metrics → 표에 값 표시 =========
window.addEventListener("fm:metrics", (e: any) => {
  const detail = e.detail || {};
  const {
    earL,
    earR,
    earAvg,
    perclos,
    gazeDev,
    zoneScore,
    focusScore,
    gazeDirLabel,
  } = detail;

  // 디버그 로그 (원하면 콘솔에서 확인)
  // console.log("[Debug] metrics", detail);

  const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

  // EAR(L/R/avg)
  if ($("dbgEAR")) {
    if (
      earL != null &&
      earR != null &&
      earAvg != null &&
      !Number.isNaN(earAvg)
    ) {
      $("dbgEAR")!.textContent = `${earL.toFixed(3)} / ${earR.toFixed(3)} / ${earAvg.toFixed(3)}`;
    } else {
      $("dbgEAR")!.textContent = "-";
    }
  }

  // PERCLOS(1m)
  if ($("dbgPERCLOS")) {
    if (perclos != null && !Number.isNaN(perclos)) {
      $("dbgPERCLOS")!.textContent = `${(perclos * 100).toFixed(1)}%`;
    } else {
      $("dbgPERCLOS")!.textContent = "-";
    }
  }

  // Gaze dev
  if ($("dbgGaze")) {
    if (gazeDev != null && !Number.isNaN(gazeDev)) {
      $("dbgGaze")!.textContent = gazeDev.toFixed(3);
    } else {
      $("dbgGaze")!.textContent = "-";
    }
  }

  // (원하면 zoneScore/focusScore/gazeDir도 표시 가능)
  if ($("dbgPose")) {
    $("dbgPose")!.textContent = `zone=${zoneScore?.toFixed?.(2) ?? "-"}, focus=${focusScore?.toFixed?.(
      1
    ) ?? "-"}, dir=${gazeDirLabel ?? "-"}`;
  }
});

// ========= 토글 변경 시 캔버스 초기화 =========
toggle?.addEventListener("change", () => {
  if (lmCtx && lmCanvas) {
    lmCtx.clearRect(0, 0, lmCanvas.width, lmCanvas.height);
  }
});
