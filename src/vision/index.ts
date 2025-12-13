/**
 * src/vision/index.ts
 * - Mediapipe FaceMesh + CameraUtils (CDN 기반)
 * - 눈 주변 6포인트 + 홍채(iris) 중심까지 계산해 fm:vision 이벤트로 송출
 * - 카메라 스트림은 fm:camera-stream 으로도 전달 (환경설정 탭 미리보기용)
 */

// Mediapipe CDN에서 제공하는 전역 심볼 타입 선언 (TS 에러 방지용)
declare const FaceMesh: any;

type Pt = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

// 눈꺼풀 6포인트 인덱스 (왼/오른쪽 눈)
const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

// 홍채(iris) 인덱스 모음
const LEFT_IRIS_IDX = [468, 469, 470, 471, 472];
const RIGHT_IRIS_IDX = [473, 474, 475, 476, 477];

// 간단한 head pose 계산용 인덱스
const NOSE_TIP_IDX = 1;   // 코
const CHIN_IDX = 152;     // 턱
const FOREHEAD_IDX = 10;  // 이마

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
  pose?: {
    yaw: number;   // 좌우 회전 (deg)
    pitch: number; // 상하 회전 (deg)
    roll: number;  // 기울기 (deg)
  };
  // 얼굴 전체 랜드마크 (468개 정도)
  allPts?: Pt[];
}

export class Vision {
  private video: HTMLVideoElement | null = null;
  private camera: any | null = null;
  private faceMesh: any | null = null;
  private lastEmit = 0;
  private rafWin: Window = window;
  private rafId: number | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  
  async start() {
    // 메인 화면 왼쪽 카메라 요소
    this.video = document.getElementById("videoEl") as HTMLVideoElement | null;
    if (!this.video) throw new Error("videoEl not found");

    const stream = await this.ensureCameraPermission();
    this.stream = stream;
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
        // 🔹 얼굴이 아예 안 잡힌 경우: allPts 없음
        this.emitFrame(null, null, null, 0, false, null, null);
        return;
      }

      const lm: Landmark[] = results.multiFaceLandmarks[0] as Landmark[];

      // 🔹 얼굴 전체 랜드마크 → allPts
      const allPts: Pt[] = lm.map((p) => ({ x: p.x, y: p.y }));

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

      const pose = computePose(lm, leftPts, rightPts);

      this.emitFrame(
        leftPts,
        rightPts,
        { L: irisL, R: irisR, center: irisCenter },
        conf,
        valid,
        allPts,
        pose
      );
    });

    this.rafWin = window;
    this.startLoop();
    console.log("[Vision] ✅ Started with FaceMesh + iris (custom loop)");
    
  }

  stop() {
    this.stopLoop();
  
    // video가 PiP로 바뀌었을 수도 있으니, 저장해둔 this.stream을 우선 사용
    const stream =
      (this.video?.srcObject as MediaStream | null) ??
      this.stream;
  
    stream?.getTracks().forEach((t) => t.stop());
  
    if (this.video) this.video.srcObject = null;
  
    try {
      // @ts-ignore
      this.faceMesh?.close?.();
    } catch {}
  
    this.camera = null;   // (선택) 이제 사용 안 함
    this.faceMesh = null;
    this.stream = null;
  
    console.log("[Vision] Stopped");
  }
  public switchToPip(pipWin: Window) {
    if (!this.faceMesh) throw new Error("Vision not started yet");
  
    // ✅ 전환 시점에 메인 videoEl을 다시 잡아 안전하게 유지
    const mainVideo = document.getElementById("videoEl") as HTMLVideoElement | null;
    if (!mainVideo) throw new Error("videoEl not found");
    this.video = mainVideo;
  
    // ✅ 메인 비디오에 스트림이 살아있는지 확인
    const stream = this.video.srcObject as MediaStream | null;
    if (!stream) throw new Error("main video stream missing");
  
    this.stopLoop();
    this.rafWin = pipWin;
    this.startLoop();
  
    console.log("[Vision] ✅ Switched loop to PiP window (video stays main)");
  }
  
  
  

  private startLoop() {
    if (!this.faceMesh || !this.video) return;
  
    this.running = true;
    const minInterval = 1000 / TARGET_EVENT_FPS;
    let lastSend = 0;
  
    const tick = async (t: number) => {
      if (!this.running || !this.faceMesh || !this.video) return;
  
      // ✅ PiP 전환 직후 / 탭 비가시 상태에서 video 프레임이 준비되지 않으면 send 금지
      if (this.video.readyState < 2 || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
        this.rafId = this.rafWin.requestAnimationFrame(tick);
        return;
      }
  
      if (t - lastSend >= minInterval) {
        lastSend = t;
        try {
          await this.faceMesh.send({ image: this.video });
        } catch (e) {
          // ✅ 에러를 숨기지 말고 찍어야 원인 추적 가능
          console.error("[Vision] faceMesh.send failed:", e);
        }
      }
  
      this.rafId = this.rafWin.requestAnimationFrame(tick);
    };
  
    this.rafId = this.rafWin.requestAnimationFrame(tick);
  }
  
  
  private stopLoop() {
    this.running = false;
    if (this.rafId !== null) {
      try {
        this.rafWin.cancelAnimationFrame(this.rafId);
      } catch {}
    }
    this.rafId = null;
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
    valid: boolean,
    allPts: Pt[] | null,
    pose: { yaw: number; pitch: number; roll: number } | null
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
      pose: pose ?? undefined,
      allPts: allPts ?? [],
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

function computePose(
  lm: Landmark[],
  leftPts: Pt[],
  rightPts: Pt[]
): { yaw: number; pitch: number; roll: number } | null {
  const nose = lm[NOSE_TIP_IDX];
  const chin = lm[CHIN_IDX];
  const forehead = lm[FOREHEAD_IDX];

  if (!nose || !chin || !forehead || leftPts.length < 1 || rightPts.length < 1) {
    return null;
  }

  // 양 눈 중심
  const eyeL = leftPts[0];
  const eyeR = rightPts[3] || rightPts[0];
  const eyeMid = {
    x: (eyeL.x + eyeR.x) / 2,
    y: (eyeL.y + eyeR.y) / 2,
  };

  // yaw: 코가 눈 중앙에서 좌우로 얼마나 치우쳤는지
  const yaw = (nose.x - eyeMid.x) * 120; // 경험적인 스케일

  // pitch: 얼굴 위/아래 기울어짐 (이마-턱 라인 기준)
  const faceMidY = (forehead.y + chin.y) / 2;
  const pitch = (faceMidY - nose.y) * 120;

  // roll: 눈 라인의 기울기
  const rollRad = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
  const roll = (rollRad * 180) / Math.PI;

  return { yaw, pitch, roll };
}
