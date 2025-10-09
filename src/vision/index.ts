// src/vision/index.ts
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ❗️버전을 고정해서 404 방지(예: 0.10.14). 필요하면 package.json 설치 버전에 맞춰 조정하세요.
const TASKS_VERSION = "0.10.14";

// WebAssembly 런타임 파일(.wasm, .worker.js 등) CDN 경로
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;

// Face Landmarker 모델 (.task) — 구글 호스팅 안정 URL
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type FrameCallback = (frame: {
  t: number;
  conf: number;
  eyes: { l: [number, number][], r: [number, number][] };
  iris: { l: [number, number]; r: [number, number] };
  landmarks: [number, number][];
}) => void;

export async function createVision() {
  // 1) 런타임 리졸버 로드
  const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);

  // 2) Face Landmarker 생성
  const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });

  // 3) 카메라 비디오 준비
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true; // iOS
  video.muted = true;

  let frameCB: FrameCallback | null = null;
  function onFrame(cb: FrameCallback) {
    frameCB = cb;
  }

  // 보조: 안전한 인덱스 접근
  const pick = (arr: any[], idx: number) => arr?.[idx];

  // 눈 4점(상/하/좌/우) 고정 인덱스(468 FaceMesh 기준)
  // 카메라 좌/우 이슈 크게 신경 안 씀: 지표 계산/시각화엔 충분
  const LIDX = { up: 386, down: 374, left: 263, right: 466 };
  const RIDX = { up: 159, down: 145, left: 133, right: 33 };

  function buildFrame(results: any) {
    const t = performance.now();

    const lm = results?.faceLandmarks?.[0] ?? [];
    const landmarks: [number, number][] = Array.isArray(lm)
      ? lm.map((p: any) => [p.x, p.y])
      : [];

    // 왼눈/오른눈 4점씩 (없으면 필터링)
    const lUp = pick(lm, LIDX.up), lDn = pick(lm, LIDX.down);
    const lLt = pick(lm, LIDX.left), lRt = pick(lm, LIDX.right);
    const rUp = pick(lm, RIDX.up), rDn = pick(lm, RIDX.down);
    const rLt = pick(lm, RIDX.left), rRt = pick(lm, RIDX.right);

    const eyes = {
      l: [lUp, lDn, lLt, lRt].filter(Boolean).map((p: any) => [p.x, p.y] as [number, number]),
      r: [rUp, rDn, rLt, rRt].filter(Boolean).map((p: any) => [p.x, p.y] as [number, number]),
    };

    // 홍채 중심 근사(동공 모델 없이 눈 좌/우 중점 사용)
    const mid = (a: any, b: any): [number, number] =>
      a && b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [0.5, 0.5];

    const iris = {
      l: mid(lLt, lRt),
      r: mid(rLt, rRt),
    };

    // 신뢰도: 랜드마크 갯수 기반 간단 근사
    const conf = landmarks.length > 100 ? 0.99 : 0.0;

    return { t, conf, eyes, iris, landmarks };
  }

  let rafId = 0;
  async function start() {
    // 4) 카메라 권한/스트림
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;

    await new Promise<void>((res) => {
      video.onloadedmetadata = () => res();
    });

    await video.play(); // 자동재생 보장

    // 5) 루프
    const loop = () => {
      try {
        const now = performance.now();
        const res = landmarker.detectForVideo(video, now);
        if (frameCB) frameCB(buildFrame(res));
      } catch (e) {
        // detect 에러가 나더라도 루프는 유지
        console.error("[vision] detect error:", e);
      }
      rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  function stop() {
    cancelAnimationFrame(rafId);
    const s = video.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  return { onFrame, start, stop, video };
}
