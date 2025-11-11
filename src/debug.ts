/**
 * debug.ts
 * - 환경설정 탭용 디버그 시각화 및 실시간 측정값 표시
 */

const lmCanvas = document.getElementById('lmCanvas') as HTMLCanvasElement;
const ctx = lmCanvas?.getContext('2d')!;
const debugVideo = document.getElementById('debugVideo') as HTMLVideoElement;
const toggle = document.getElementById('toggleLm') as HTMLInputElement;

const W = 520, H = 390;
if (lmCanvas) { lmCanvas.width = W; lmCanvas.height = H; }

// === 카메라 스트림 연결 ===
window.addEventListener('fm:camera-stream', (e: any) => {
  const { stream } = e.detail;
  if (debugVideo) debugVideo.srcObject = stream;
});

// === 랜드마크 표시 ===
window.addEventListener('fm:vision', (e: any) => {
  if (!toggle?.checked) return;
  const { left, right, conf, valid } = e.detail;
  if (!valid || !ctx) return;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'red';
  ctx.globalAlpha = 0.9;

  const pts = [...(left?.pts ?? []), ...(right?.pts ?? [])];
  for (const p of pts) {
    const x = p.x * W;
    const y = p.y * H;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 기본 값 표시
  (document.getElementById('dbgConf') as HTMLElement).innerText = conf.toFixed(2);
  (document.getElementById('dbgValid') as HTMLElement).innerText = String(valid);
  (document.getElementById('dbgFps') as HTMLElement).innerText = '15';
});

// === fm:metrics → 표에 값 표시 ===
window.addEventListener('fm:metrics', (e: any) => {
  const { earL, earR, earAvg, perclos, gazeDev } = e.detail || {};
  const $ = (id: string) => document.getElementById(id) as HTMLElement;

  if ($('dbgEAR'))
    $('dbgEAR').textContent =
      earL != null && earR != null && earAvg != null
        ? `${earL.toFixed(3)} / ${earR.toFixed(3)} / ${earAvg.toFixed(3)}`
        : '-';

  if ($('dbgPERCLOS'))
    $('dbgPERCLOS').textContent =
      perclos != null ? `${(perclos * 100).toFixed(1)}%` : '-';

  if ($('dbgGaze'))
    $('dbgGaze').textContent =
      gazeDev != null ? gazeDev.toFixed(2) : '-';

  if ($('dbgPose'))
    $('dbgPose').textContent = '-'; // 아직 미구현
});

// === 토글 변경 시 캔버스 초기화 ===
toggle?.addEventListener('change', () => {
  ctx?.clearRect(0, 0, W, H);
});
