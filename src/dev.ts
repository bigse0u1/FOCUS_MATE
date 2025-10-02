import { createVision } from "./vision/index";

function log(step: string, data?: any) {
  console.log(`[DEV] ${step}`, data ?? "");
}

async function main() {
  log("dev.ts loaded");

  // 화면에 큰 버튼 만들어서 눈에 띄게
  const btn = document.createElement("button");
  btn.textContent = "카메라 시작";
  btn.style.position = "fixed";
  btn.style.left = "50%";
  btn.style.top = "30%";
  btn.style.transform = "translate(-50%, -50%)";
  btn.style.padding = "16px 24px";
  btn.style.fontSize = "18px";
  document.body.appendChild(btn);

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "시작 중...";
    try {
      log("creating vision");
      const vision = await createVision();
      log("vision created");

      vision.onFrame((f) => {
        // 1초에 한 번만 표시(스팸 방지)
        if (!((window as any)._lastLogTime) || performance.now() - (window as any)._lastLogTime > 1000) {
          (window as any)._lastLogTime = performance.now();
          log("frame", { iris: f.iris, conf: f.conf });
        }
      });

      await vision.start();
      log("vision started");
      btn.textContent = "실행 중 (카메라 미리보기 우하단)";
    } catch (e) {
      console.error("[DEV] start error", e);
      btn.textContent = "다시 시도";
      btn.disabled = false;
      alert("에러: " + (e as any)?.message);
    }
  };
}

main();
