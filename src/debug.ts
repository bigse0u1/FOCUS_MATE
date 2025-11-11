// 디버그 패널 초기화 & fm:vision 연동
const toggleLM = document.getElementById('toggleLM') as HTMLInputElement | null;
const lmCanvas = document.getElementById('lmCanvas') as HTMLCanvasElement | null;
const ctx = lmCanvas?.getContext('2d') ?? null;

const dbgConf = document.getElementById('dbgConf');
const dbgValid = document.getElementById('dbgValid');
const dbgFps = document.getElementById('dbgFps');
const dbgEAR = document.getElementById('dbgEAR');
const dbgPERCLOS = document.getElementById('dbgPERCLOS');
const dbgGaze = document.getElementById('dbgGaze');
const dbgPose = document.getElementById('dbgPose');

const debugVideo = document.getElementById('debugVideo') as HTMLVideoElement | null;

// 카메라 스트림 공유 받기(선택)
window.addEventListener('fm:camera-stream', (e: any) => {
  const stream: MediaStream = e.detail.stream;
  if (debugVideo && !debugVideo.srcObject) {
    debugVideo.srcObject = stream;
  }
});

// 캔버스 초기화
function clearCanvas() {
  if (!ctx || !lmCanvas) return;
  ctx.clearRect(0, 0, lmCanvas.width, lmCanvas.height);
  ctx.fillStyle = '#0a0d18';
  ctx.fillRect(0, 0, lmCanvas.width, lmCanvas.height);
}

function drawPts(pts: Array<{x:number;y:number}>, color='#ff4444') {
  if (!ctx || !lmCanvas) return;
  const w = lmCanvas.width, h = lmCanvas.height;
  ctx.fillStyle = color;
  for (const p of pts) {
    const x = p.x * w;
    const y = p.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI*2);
    ctx.fill();
  }
}

// 기본 배경
clearCanvas();

// fm:vision 프레임 수신 → 값 갱신 + (토글 ON 시) 랜드마크 그리기
window.addEventListener('fm:vision', (e: any) => {
  const { fps, left, right, conf, valid } = e.detail || {};

  // 상단 값 갱신(기본)
  if (dbgConf)  dbgConf.textContent  = typeof conf === 'number' ? conf.toFixed(2) : '-';
  if (dbgValid) dbgValid.textContent = valid ? 'true' : 'false';
  if (dbgFps)   dbgFps.textContent   = fps != null ? String(fps) : '-';

  // 랜드마크 표시 토글 OFF면 그리지 않음
  if (!toggleLM || !toggleLM.checked) return;

  // 그리기
  clearCanvas();
  if (left?.pts?.length)  drawPts(left.pts,  '#ff4444');
  if (right?.pts?.length) drawPts(right.pts, '#ff4444');
});

// 토글 변경 시 캔버스 클리어
toggleLM?.addEventListener('change', () => {
  clearCanvas();
});

// (선택) 메트릭 파이프라인을 별도 이벤트로 보내는 경우 여기에 연결
window.addEventListener('fm:metrics', (e: any) => {
   const { earL, earR, earAvg, perclos, gazeDev, yaw, pitch, roll } = e.detail || {};
   if (dbgEAR)     dbgEAR.textContent     = (earL!=null && earR!=null && earAvg!=null) ? `${earL.toFixed(3)} / ${earR.toFixed(3)} / ${earAvg.toFixed(3)}` : '-';
   if (dbgPERCLOS) dbgPERCLOS.textContent = perclos!=null ? `${(perclos*100).toFixed(1)}%` : '-';
   if (dbgGaze)    dbgGaze.textContent    = gazeDev!=null ? gazeDev.toFixed(2) : '-';
   if (dbgPose)    dbgPose.textContent    = (yaw!=null && pitch!=null && roll!=null) ? `${yaw.toFixed(1)} / ${pitch.toFixed(1)} / ${roll.toFixed(1)}` : '-';
 });
