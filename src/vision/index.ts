/**
 * vision/index.ts
 * 카메라 프레임을 받아 fm:vision 이벤트 송출 (테스트용 시뮬레이터)
 * 실제 Mediapipe 연동 시 이 파일만 교체하면 됨.
 */
type Pt = {x:number, y:number};

export class Vision {
  private video: HTMLVideoElement | null = null;
  private running = false;
  private interval?: number;

  async start() {
    this.video = document.getElementById("videoEl") as HTMLVideoElement;
    if (!this.video) throw new Error("videoEl not found");
    await this.initCamera();
    this.running = true;
    this.loop();
    console.log("[Vision] Started");
  }

  async initCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      });
      this.video!.srcObject = stream;
      this.video!.setAttribute("playsinline", "true");
      this.video!.muted = true;
      await this.video!.play();
    } catch (err) {
      alert("카메라 권한을 허용해주세요. (브라우저 주소창 왼쪽 🔒 → Camera: Allow)");
      throw err;
    }
  }

  loop() {
    if (!this.running) return;
    this.interval = window.setInterval(() => {
      const ts = Date.now();
      const conf = Math.random() * 0.2 + 0.8;
      const valid = conf > 0.7;
      const pts = Array.from({length:6},()=>({x:Math.random(), y:Math.random()} as Pt));

      const frame = {
        ts,
        fps: 15,
        left: { pts },
        right: { pts },
        conf,
        valid
      };
      window.dispatchEvent(new CustomEvent("fm:vision",{detail: frame}));
    }, 1000/15);
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
  }
}
