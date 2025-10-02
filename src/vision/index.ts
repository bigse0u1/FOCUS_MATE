// src/vision/index.ts
// Vision 모듈 전체본 (모델 404 수정 반영 / 자동재생 대응 / 디버그 로그 포함)

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/** 프레임 전달 타입 */
export type VisionFrame = {
  t: number;                                  // 타임스탬프(ms)
  eyes: { l: number[][]; r: number[][] };     // 왼/오른 눈 핵심 4점 [ [x,y], ... ] (정규화 좌표 0~1)
  iris: { l: number[]; r: number[] };         // 각 눈의 중심 근사값 [x,y]
  conf: number;                                // 신뢰도(간단 표시용)
};

/** 외부에서 쓰는 생성기 */
export async function createVision() {
  const vision = new Vision();
  await vision.init();
  return vision;
}

class Vision {
  private faceLandmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private frameCB: ((f: VisionFrame) => void) | null = null;

  /** 초기화: WASM 로더 + 모델 로드 */
  async init() {
    this.log("init:start");
    // WASM/JS 런타임 로더 경로 (jsDelivr)
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    this.log("init:fileset:ok");

    // ⛳ 모델 경로: GCS(공식)로 교체 — 이전 jsDelivr 경로는 404 발생
    // 로컬에 두고 싶으면 public/models/face_landmarker.task 로 저장 후
    // 아래 modelAssetPath를 "/models/face_landmarker.task" 로 바꾸면 됨.
    this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    this.log("init:model:ok");
  }

  /** 시작: 카메라 연결 + 추론 루프 가동 */
  async start(videoEl?: HTMLVideoElement) {
    if (!this.faceLandmarker) throw new Error("FaceLandmarker not ready. Call init() first.");

    // 미리보기 비디오 엘리먼트 준비(없으면 자동 생성)
    if (!videoEl) {
      videoEl = document.createElement("video");
      videoEl.width = 500;
      videoEl.height = 380;
      videoEl.style.position = "fixed";
      videoEl.style.left = "12px";
      videoEl.style.top = "12px";
      videoEl.style.border = "2px solid #999";
      videoEl.style.borderRadius = "8px";
      videoEl.style.background = "#000";
      videoEl.setAttribute("autoplay", "true");
      document.body.appendChild(videoEl);
    }
    this.video = videoEl;

    // 자동재생/모바일 인라인 재생 대응
    this.video.muted = true;
    this.video.playsInline = true;

    // 카메라 권한 요청
    this.log("camera:req");
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    this.video.srcObject = stream;

    try {
      await this.video.play();
      this.log("camera:play:ok");
    } catch (e) {
      this.log("camera:play:fail", e);
      // 사용자 제스처 요구 시, 버튼 노출로 재시도
      const btn = document.createElement("button");
      btn.textContent = "카메라 시작";
      btn.style.position = "fixed";
      btn.style.right = "12px";
      btn.style.bottom = "210px";
      btn.style.padding = "8px 12px";
      btn.style.borderRadius = "8px";
      btn.onclick = async () => {
        try {
          await this.video!.play();
          btn.remove();
        } catch (e2) {
          alert("비디오 재생 실패: " + (e2 as any)?.message);
        }
      };
      document.body.appendChild(btn);
    }

    this.running = true;

    // MediaPipe FaceMesh 인덱스 중 눈 주변 핵심 4점(수직2/수평2)
    const leftIdx = [159, 145, 33, 133];
    const rightIdx = [386, 374, 263, 362];

    const avg = (pts: number[][]) => [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ];

    const loop = async () => {
      if (!this.running) return;

      const now = performance.now();
      const res = await this.faceLandmarker!.detectForVideo(this.video!, now);

      if (res.faceLandmarks?.length) {
        const lm = res.faceLandmarks[0];

        const eyes = {
          l: leftIdx.map((i) => [lm[i].x, lm[i].y]),
          r: rightIdx.map((i) => [lm[i].x, lm[i].y]),
        };

        const frame: VisionFrame = {
          t: now,
          eyes,
          iris: { l: avg(eyes.l), r: avg(eyes.r) }, // 간단 근사(눈꺼풀 점 평균)
          conf: 1,
        };

        // 콜백으로 전달
        this.frameCB?.(frame);
      }

      requestAnimationFrame(loop);
    };

    loop();
  }

  /** 정지: 루프 종료 + 스트림 해제 */
  stop() {
    this.running = false;
    if (this.video?.srcObject) {
      const tracks = (this.video.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      this.video.srcObject = null;
    }
  }

  /** 프레임 콜백 등록 */
  onFrame(cb: (f: VisionFrame) => void) {
    this.frameCB = cb;
  }

  /** 간단 로거 */
  private log(step: string, data?: unknown) {
    // 필요시 주석 해제해서 로그 보기
    // eslint-disable-next-line no-console
    console.log(`[VISION] ${step}`, data ?? "");
  }
}
