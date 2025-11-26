// src/debug.ts
// - 환경설정 탭에서 랜드마크 / 카메라 / 측정값 보여주는 스크립트

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

// === 랜드마크 표시 ===
window.addEventListener("fm:vision", (e: any) => {
  if (!ctx) return;

  const { allPts, left, right, iris, conf, valid } = e.detail || {};

  ctx.clearRect(0, 0, W, H);

  // 기본 디버그 텍스트 업데이트
  (document.getElementById("dbgConf") as HTMLElement).innerText =
    typeof conf === "number" ? conf.toFixed(2) : "-";
  (document.getElementById("dbgValid") as HTMLElement).innerText = String(
    Boolean(valid)
  );
  (document.getElementById("dbgFps") as HTMLElement).innerText = "15";

  if (!valid) {
    return;
  }

  // 1) 얼굴 전체 랜드마크 (회색 작은 점)
  if (Array.isArray(allPts) && allPts.length > 0) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "red";

    for (const p of allPts) {
      const x = p.x * W;
      const y = p.y * H;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 2) 눈 주변 6포인트 (좌/우) - 빨간 점 (조금 더 크게)
  const eyePts = [
    ...(left?.pts ?? []),
    ...(right?.pts ?? []),
  ] as { x: number; y: number }[];

  if (eyePts.length > 0) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "red";

    for (const p of eyePts) {
      const x = p.x * W;
      const y = p.y * H;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 3) 홍채 위치 표시
  //    - 왼/오 홍채: 파란 점
  //    - 양쪽 중앙(center): 초록 점
  if (iris) {
    ctx.save();
    ctx.globalAlpha = 0.75;

    // 왼 홍채
    if (iris.L) {
      ctx.fillStyle = "#44aaff";
      ctx.beginPath();
      ctx.arc(iris.L.x * W, iris.L.y * H, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 오른 홍채
    if (iris.R) {
      ctx.fillStyle = "#44aaff";
      ctx.beginPath();
      ctx.arc(iris.R.x * W, iris.R.y * H, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 중앙점
    if (iris.center) {
      ctx.fillStyle = "#44ff66";
      ctx.beginPath();
      ctx.arc(iris.center.x * W, iris.center.y * H, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
});

// === fm:metrics → 측정 값 표 채우기 ===
window.addEventListener('fm:metrics', (e: any) => {
  const {
    earL,
    earR,
    earAvg,
    perclos,
    gazeDev,
    poseYaw,
    posePitch,
    poseRoll,
  } = e.detail || {};

  const $ = (id: string) => document.getElementById(id) as HTMLElement;

  // EAR
  if ($('dbgEAR'))
    $('dbgEAR').textContent =
      earL != null && earR != null && earAvg != null
        ? `${earL.toFixed(3)} / ${earR.toFixed(3)} / ${earAvg.toFixed(3)}`
        : '-';

  // PERCLOS
  if ($('dbgPERCLOS'))
    $('dbgPERCLOS').textContent =
      perclos != null ? `${(perclos * 100).toFixed(1)}%` : '-';

  // Gaze dev
  if ($('dbgGaze'))
    $('dbgGaze').textContent =
      gazeDev != null ? gazeDev.toFixed(3) : '-';

  // 🔹 새로 추가: Pose (yaw/pitch/roll)
  if ($('dbgPose')) {
    if (
      typeof poseYaw === 'number' &&
      typeof posePitch === 'number' &&
      typeof poseRoll === 'number'
    ) {
      $('dbgPose').textContent =
        `${poseYaw.toFixed(1)} / ${posePitch.toFixed(1)} / ${poseRoll.toFixed(1)}`;
    } else {
      $('dbgPose').textContent = '-';
    }
  }
});


export {};
