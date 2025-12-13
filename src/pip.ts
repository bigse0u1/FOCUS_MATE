// src/pip.ts
export async function openDocPiP() {
    const dpiP = (window as any).documentPictureInPicture;
    if (!dpiP?.requestWindow) {
      throw new Error("Document PiP 미지원 브라우저입니다. (Chrome 계열 권장)");
    }
  
    const pipWin: Window = await dpiP.requestWindow({ width: 420, height: 320 });
  
    pipWin.document.head.innerHTML = `
      <style>
        html,body{margin:0;background:#000;height:100%;}
        .wrap{position:relative;width:100%;height:100%;}
        video{width:100%;height:100%;object-fit:cover;}
        canvas{position:absolute;inset:0;}
      </style>
    `;
  
    pipWin.document.body.innerHTML = `
      <div class="wrap">
        <video id="pipVideo" autoplay playsinline muted></video>
        <canvas id="pipOverlay"></canvas>
      </div>
    `;
  
    const video = pipWin.document.getElementById("pipVideo") as HTMLVideoElement;
    const canvas = pipWin.document.getElementById("pipOverlay") as HTMLCanvasElement;
  
    // canvas는 선택(오버레이 그릴 때만)
    const syncCanvasSize = () => {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
    };
    video.addEventListener("loadedmetadata", syncCanvasSize);
  
    return { pipWin, video, canvas };
  }
  
