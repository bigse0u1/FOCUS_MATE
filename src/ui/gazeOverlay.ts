// src/ui/gazeOverlay.ts
// 카메라 위에 "시선 방향 벡터(화살표)"와 방향 텍스트를 그려주는 오버레이

import type { VisionFrameDetail } from "../vision";

function setupGazeOverlay() {
  // video / overlay 는 항상 있다고 가정
  const video = document.getElementById("videoEl") as HTMLVideoElement;
  const canvas = document.getElementById("overlay") as HTMLCanvasElement;

  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) {
    console.warn("[GazeOverlay] 2D context not available");
    return;
  }

  // 비디오 크기에 캔버스 맞추기
  function resizeCanvasToVideo() {
    const rect = video.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;

    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  resizeCanvasToVideo();
  window.addEventListener("resize", resizeCanvasToVideo);

  // === fm:vision → 시선 벡터 계산 + 그리기 ===
  window.addEventListener("fm:vision", (e: Event) => {
    const ev = e as CustomEvent<VisionFrameDetail>;
    const { valid, left, right, iris } = ev.detail;

    resizeCanvasToVideo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!valid) return;
    if (!iris || (!iris.L && !iris.R)) return;

    // 1) 각 눈의 중심(눈꺼풀 6포인트 평균) 계산
    const centerL = eyeCenter(left.pts);
    const centerR = eyeCenter(right.pts);

    if (!centerL && !centerR) return;

    // 2) 동공 위치
    const irisL = iris.L ?? null;
    const irisR = iris.R ?? null;

    // 3) 왼/오 눈에서 각각 "동공 - 눈 중심" 벡터
    const vL = irisL && centerL ? { x: irisL.x - centerL.x, y: irisL.y - centerL.y } : null;
    const vR = irisR && centerR ? { x: irisR.x - centerR.x, y: irisR.y - centerR.y } : null;

    // 4) 양쪽 눈 벡터 평균 → "시선 방향"
    const v = averageVector(vL, vR);
    if (!v) return;

    // 5) 방향 카테고리 분류 (중앙/좌/우/위/아래/대각)
    const dirLabel = classifyDirection(v.x, v.y);

    // 6) 화면 좌표로 변환해서 화살표 그리기
    //    기준점: 양 눈 중심 평균 → fallback 으로 iris.center, centerL, centerR 순
    const baseNorm =
      averagePoint(centerL, centerR) ??
      iris.center ??
      centerL ??
      centerR ??
      null;

    if (!baseNorm) return; // ✅ TS가 baseNorm null 아니라는 걸 알게 됨

    const baseX = baseNorm.x * canvas.width;
    const baseY = baseNorm.y * canvas.height;

    // 벡터 스케일링 (화살표 길이)
    const scale = 800;
    const endX = baseX + v.x * scale;
    const endY = baseY + v.y * scale;

    // (1) 기준점
    ctx.save();
    ctx.beginPath();
    ctx.arc(baseX, baseY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.restore();

    // (2) 화살표
    drawArrow(ctx, baseX, baseY, endX, endY, "rgba(100,108,255,0.9)");

    // (3) 현재 방향 텍스트 (왼쪽 위)
    ctx.save();
    ctx.font = "14px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(`시선: ${dirLabel}`, 12, 24);
    ctx.restore();
  });
}

// 눈꺼풀 6포인트 평균 → 눈 중심(정규화 좌표)
function eyeCenter(pts: { x: number; y: number }[]): { x: number; y: number } | null {
  if (!pts || pts.length === 0) return null;
  let sx = 0,
    sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const n = pts.length;
  return { x: sx / n, y: sy / n };
}

// 두 벡터 평균
function averageVector(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null
): { x: number; y: number } | null {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return a ?? b ?? null;
}

// 두 포인트 평균
function averagePoint(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null
): { x: number; y: number } | null {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return a ?? b ?? null;
}

// 방향 카테고리 분류
function classifyDirection(dx: number, dy: number): string {
  // (0,0)에 가까우면 중앙
  const len = Math.sqrt(dx * dx + dy * dy);
  const EPS = 0.01;
  if (len < EPS) return "중앙";

  const nx = dx / len;
  const ny = dy / len;

  const absX = Math.abs(nx);
  const absY = Math.abs(ny);

  if (absX < 0.35 && ny < 0) return "위";
  if (absX < 0.35 && ny > 0) return "아래";
  if (absY < 0.35 && nx < 0) return "왼쪽";
  if (absY < 0.35 && nx > 0) return "오른쪽";

  if (nx < 0 && ny < 0) return "왼쪽 위";
  if (nx > 0 && ny < 0) return "오른쪽 위";
  if (nx < 0 && ny > 0) return "왼쪽 아래";
  if (nx > 0 && ny > 0) return "오른쪽 아래";

  return "중앙";
}

// 화살표 그리기
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string
) {
  const headLen = 10;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.lineTo(x2, y2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}

// DOM 준비되면 실행
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", setupGazeOverlay);
} else {
  setupGazeOverlay();
}
