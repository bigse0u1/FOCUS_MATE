/**
 * vision/index.ts
 * MediaPipe FaceMesh 기반 랜드마크 추출기
 * - fm:vision CustomEvent 송출 (기존 스키마 유지)
 * - fm:camera-stream 이벤트로 스트림 공유 (디버그 탭에서 사용)
 */

import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

type Pt = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const MAX_FACES = 1;
const MIN_DET_CONF = 0.5;
const MIN_TRACK_CONF = 0.5;
const REFINE_LANDMARKS = true;

const VISIBILITY_THRESH = 0.6;
const TARGET_EVENT_FPS = 15;

export class Vision {
  private video: HTMLVideoElement | null = null;
  private camera: Camera | null = null;
  private faceMesh: FaceMesh | null = null;
  private lastEmit = 0;

  async start() {
    this.video = document.getElementById("videoEl") as HTMLVideoElement | null;
    if (!this.video) throw new Error("videoEl not found");

    const stream = await this.ensureCameraPermission();
    // 디버그 탭에 스트림 공유
    window.dispatchEvent(new CustomEvent('fm:camera-stream', { detail: { stream } }));

    this.faceMesh = new FaceMesh({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    this.faceMesh.setOptions({
      maxNumFaces: MAX_FACES,
      refineLandmarks: REFINE_LANDMARKS,
      minDetectionConfidence: MIN_DET_CONF,
      minTrackingConfidence: MIN_TRACK_CONF,
    });

    this.faceMesh.onResults((results: any) => {
      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        this.emitFrame(null, null, 0, false);
        return;
      }
      const lm: Landmark[] = results.multiFaceLandmarks[0] as Landmark[];
      const leftPts = pickEyePts(lm, LEFT_EYE_IDX);
      const rightPts = pickEyePts(lm, RIGHT_EYE_IDX);

      const conf = computeConfidence(lm);
      const valid = conf >= VISIBILITY_THRESH && leftPts.length === 6 && rightPts.length === 6;

      const now = performance.now();
      const minInterval = 1000 / TARGET_EVENT_FPS;
      if (now - this.lastEmit >= minInterval) {
        this.emitFrame(leftPts, rightPts, conf, valid);
        this.lastEmit = now;
      }
    });

    // CameraUtils로 rAF 루프 연결
    this.camera = new Camera(this.video, {
      onFrame: async () => {
        await this.faceMesh!.send({ image: this.video! });
      },
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
    });

    await this.camera.start();
    console.log("[Vision] Started (MediaPipe FaceMesh)");
  }

  stop() {
    try { this.camera?.stop(); } catch {}
    const stream = this.video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    // @ts-ignore
    this.faceMesh?.close?.();
    this.camera = null;
    this.faceMesh = null;
    console.log("[Vision] Stopped");
  }

  private async ensureCameraPermission(): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, facingMode: "user" },
        audio: false,
      });
      if (this.video) {
        this.video.srcObject = stream;
        this.video.setAttribute("playsinline", "true");
        this.video.muted = true;
        await this.video.play();
      }
      return stream;
    } catch (err) {
      alert("카메라 권한을 허용해주세요. (브라우저 주소창 왼쪽 🔒 → Camera: Allow)");
      throw err;
    }
  }

  private emitFrame(left: Pt[] | null, right: Pt[] | null, conf: number, valid: boolean) {
    const detail = {
      ts: Date.now(),
      fps: TARGET_EVENT_FPS,
      left: { pts: left ?? [] },
      right: { pts: right ?? [] },
      conf,
      valid,
    };
    window.dispatchEvent(new CustomEvent("fm:vision", { detail }));
  }
}

function pickEyePts(lm: Landmark[], idx: number[]): Pt[] {
  const out: Pt[] = [];
  for (const i of idx) {
    const p = lm[i];
    if (!p) return out;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function computeConfidence(lm: Landmark[]): number {
  if (!lm || lm.length === 0) return 0;
  let sum = 0, n = 0;
  for (const p of lm) {
    const v = typeof p.visibility === "number" ? p.visibility : 1;
    sum += clamp01(v);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
