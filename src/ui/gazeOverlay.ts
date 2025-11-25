// src/ui/gazeOverlay.ts
// 카메라 위에 시선 방향 화살표/점/텍스트를 더 이상 그리지 않도록 정리한 버전

const video = document.getElementById("videoEl") as HTMLVideoElement | null;
const canvas = document.getElementById("overlay") as HTMLCanvasElement | null;

let ctx: CanvasRenderingContext2D | null = null;

if (canvas) {
  ctx = canvas.getContext("2d");
}

// 비디오 크기에 맞게 캔버스 리사이즈
function resizeOverlay() {
  if (!video || !canvas) return;

  const w = video.clientWidth || video.videoWidth;
  const h = video.clientHeight || video.videoHeight;
  if (!w || !h) return;

  canvas.width = w;
  canvas.height = h;
}

window.addEventListener("resize", resizeOverlay);
video?.addEventListener("loadedmetadata", resizeOverlay);

// 🔹 fm:vision은 그대로 듣지만, 이제 아무 것도 그리지 않고 캔버스만 정리
window.addEventListener("fm:vision", () => {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

export {};
