/**
 * src/vision/index.ts
 * - Mediapipe FaceMesh + CameraUtils (CDN 기반)
 * - 눈 주변 6포인트 + 홍채(iris) 중심까지 계산해 fm:vision 이벤트로 송출
 * - 카메라 스트림은 fm:camera-stream 으로도 전달 (환경설정 탭 미리보기용)
 */

// Mediapipe CDN에서 제공하는 전역 심볼 타입 선언 (TS 에러 방지용)
declare const FaceMesh: any;
declare const Camera: any;

type Pt = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

// 눈꺼풀 6포인트 인덱스 (왼/오른쪽 눈)
const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

// 홍채(iris) 인덱스 모음
const LEFT_IRIS_IDX = [468, 469, 470, 471, 472];
const RIGHT_IRIS_IDX = [473, 474, 475, 476, 477];

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const MAX_FACES = 1;
const MIN_DET_CONF = 0.5;
const MIN_TRACK_CONF = 0.5;
const VISIBILITY_THRESH = 0.6;
const TARGET_EVENT_FPS = 15;

export interface VisionFrameDetail {
  ts: number;
  fps: number;
  left: { pts: Pt[] };
  right: { pts: Pt[] };
  conf: number;
  valid: boolean;
  iris?: {
    L: Pt | null;
    R: Pt | null;
    center: Pt | null; // 양 눈 평균
  };
}

export class Vision {
  private video: HTMLVideoElement | null = null;
  private camera: any | null = null;
  private faceMesh: any | null = null;
  private lastEmit = 0;

  async start() {
    // 메인 화면 왼쪽 카메라 요소
    this.video = document.getElementById("videoEl") as HTMLVideoElement | null;
    if (!this.video) throw new Error("videoEl not found");

    const stream = await this.ensureCameraPermission();

    // 디버그(환경설정 탭)에서 사용할 수 있도록 스트림도 송출
    window.dispatchEvent(
      new CustomEvent("fm:camera-stream", { detail: { stream } })
    );

    // 전역 FaceMesh 심볼 가져오기
    const FM = (window as any).FaceMesh ?? FaceMesh;
    if (!FM) {
      console.error("[Vision] FaceMesh global not found");
      throw new Error("FaceMesh not available");
    }

    this.faceMesh = new FM({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    this.faceMesh.setOptions({
      maxNumFaces: MAX_FACES,
      refineLandmarks: true, // ✅ 홍채(iris) 포함 랜드마크 사용
      minDetectionConfidence: MIN_DET_CONF,
      minTrackingConfidence: MIN_TRACK_CONF,
    });

    this.faceMesh.onResults((results: any) => {
      if (
        !results.multiFaceLandmarks ||
        results.multiFaceLandmarks.length === 0
      ) {
        this.emitFrame(null, null, null, 0, false);
        return;
      }

      const lm: Landmark[] = results.multiFaceLandmarks[0] as Landmark[];

      const leftPts = pickEyePts(lm, LEFT_EYE_IDX);
      const rightPts = pickEyePts(lm, RIGHT_EYE_IDX);

      const irisL = getIrisCenter(lm, LEFT_IRIS_IDX);
      const irisR = getIrisCenter(lm, RIGHT_IRIS_IDX);
      const irisCenter =
        irisL && irisR
          ? {
              x: (irisL.x + irisR.x) / 2,
              y: (irisL.y + irisR.y) / 2,
            }
          : null;

      const conf = computeConfidence(lm);
      const valid =
        conf >= VISIBILITY_THRESH &&
        leftPts.length === 6 &&
        rightPts.length === 6;

      const now = performance.now();
      const minInterval = 1000 / TARGET_EVENT_FPS;
      if (now - this.lastEmit >= minInterval) {
        this.emitFrame(
          leftPts,
          rightPts,
          { L: irisL, R: irisR, center: irisCenter },
          conf,
          valid
        );
        this.lastEmit = now;
      }
    });

    // Mediapipe CameraUtils 사용 (CDN 전역 Camera)
    const Cam = (window as any).Camera ?? Camera;
    if (!Cam) {
      console.error("[Vision] Camera global not found");
      throw new Error("Camera not available");
    }

    this.camera = new Cam(this.video, {
      onFrame: async () => {
        if (!this.faceMesh || !this.video) return;
        await this.faceMesh.send({ image: this.video });
      },
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
    });

    await this.camera.start();
    console.log("[Vision] ✅ Started with FaceMesh + iris");
  }

  stop() {
    try {
      this.camera?.stop();
    } catch {}
    const stream = this.video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    try {
      // @ts-ignore
      this.faceMesh?.close?.();
    } catch {}
    this.camera = null;
    this.faceMesh = null;
    console.log("[Vision] Stopped");
  }

  private async ensureCameraPermission(): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: VIDEO_WIDTH },
          height: { ideal: VIDEO_HEIGHT },
          facingMode: "user",
        },
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
      alert(
        "카메라 권한을 허용해주세요. (브라우저 주소창 왼쪽 🔒 → Camera: 허용)"
      );
      throw err;
    }
  }

  private emitFrame(
    left: Pt[] | null,
    right: Pt[] | null,
    iris:
      | {
          L: Pt | null;
          R: Pt | null;
          center: Pt | null;
        }
      | null,
    conf: number,
    valid: boolean
  ) {
    const detail: VisionFrameDetail = {
      ts: Date.now(),
      fps: TARGET_EVENT_FPS,
      left: { pts: left ?? [] },
      right: { pts: right ?? [] },
      conf,
      valid,
      iris:
        iris ?? {
          L: null,
          R: null,
          center: null,
        },
    };

    window.dispatchEvent(new CustomEvent("fm:vision", { detail }));
  }
}

// ------------------ 헬퍼 함수들 ------------------

function pickEyePts(lm: Landmark[], idx: number[]): Pt[] {
  const out: Pt[] = [];
  for (const i of idx) {
    const p = lm[i];
    if (!p) return out;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** 홍채(iris) 인덱스들의 평균점을 center 로 사용 */
function getIrisCenter(lm: Landmark[], idx: number[]): Pt | null {
  if (!lm || !lm.length) return null;
  let sx = 0,
    sy = 0,
    n = 0;
  for (const i of idx) {
    const p = lm[i];
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  if (!n) return null;
  return { x: sx / n, y: sy / n };
}

/** visibility 평균으로 confidence 산정 */
function computeConfidence(lm: Landmark[]): number {
  if (!lm || lm.length === 0) return 0;
  let sum = 0,
    n = 0;
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
