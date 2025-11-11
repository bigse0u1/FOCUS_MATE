/**
 * vision/index.ts
 * Mediapipe FaceMesh 기반 실시간 랜드마크 추출기
 * - Netlify 배포 환경에서도 확실히 로드될 수 있도록 waitForMediapipe() 포함
 */

type Pt = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const TARGET_FPS = 15;
const VISIBILITY_THRESH = 0.6;

// ✅ Mediapipe가 로드될 때까지 기다림
async function waitForMediapipe(timeout = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function check() {
      const w = window as any;
      if (w.FaceMesh && w.Camera) return resolve();
      if (Date.now() - start > timeout)
        return reject(new Error("Mediapipe not loaded"));
      requestAnimationFrame(check);
    })();
  });
}

export class Vision {
  private video: HTMLVideoElement | null = null;
  private camera: any | null = null;
  private faceMesh: any | null = null;
  private lastEmit = 0;

  async start() {
    this.video = document.getElementById("videoEl") as HTMLVideoElement | null;
    if (!this.video) throw new Error("videoEl not found");

    // ✅ 1) 카메라 권한 요청
    const stream = await this.ensureCameraPermission();
    window.dispatchEvent(
      new CustomEvent("fm:camera-stream", { detail: { stream } })
    );

    // ✅ 2) Mediapipe 로드 대기 (Netlify 대비)
    await waitForMediapipe();

    // ✅ 3) 전역 객체로부터 FaceMesh / Camera 참조
    const FaceMesh = (window as any).FaceMesh;
    const Camera = (window as any).Camera;

    // ✅ 4) FaceMesh 설정
    this.faceMesh = new FaceMesh({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.faceMesh.onResults((results: any) => {
      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        this.emitFrame(null, null, 0, false);
        return;
      }
      const lm: Landmark[] = results.multiFaceLandmarks[0];
      const leftPts = pickEyePts(lm, LEFT_EYE_IDX);
      const rightPts = pickEyePts(lm, RIGHT_EYE_IDX);

      const conf = computeConfidence(lm);
      const valid = conf >= VISIBILITY_THRESH && leftPts.length === 6 && rightPts.length === 6;

      const now = performance.now();
      const interval = 1000 / TARGET_FPS;
      if (now - this.lastEmit >= interval) {
        this.emitFrame(leftPts, rightPts, conf, valid);
        this.lastEmit = now;
      }
    });

    // ✅ 5) Camera 연결
    this.camera = new Camera(this.video, {
      onFrame: async () => {
        await this.faceMesh!.send({ image: this.video! });
      },
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
    });

    await this.camera.start();
    console.log("[Vision] ✅ Started with Mediapipe CDN");
  }

  stop() {
    try {
      this.camera?.stop?.();
    } catch {}
    const stream = this.video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    this.faceMesh = null;
    this.camera = null;
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
      alert("카메라 권한을 허용해주세요. (브라우저 주소창 왼쪽 🔒 → Camera: 허용)");
      throw err;
    }
  }

  private emitFrame(left: Pt[] | null, right: Pt[] | null, conf: number, valid: boolean) {
    const detail = {
      ts: Date.now(),
      fps: TARGET_FPS,
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
    sum += Math.max(0, Math.min(1, v));
    n++;
  }
  return n > 0 ? sum / n : 0;
}
