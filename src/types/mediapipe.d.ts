// src/types/mediapipe.d.ts
declare module '@mediapipe/face_mesh' {
    export class FaceMesh {
      constructor(config?: { locateFile?: (file: string) => string });
      setOptions(options: {
        maxNumFaces?: number;
        refineLandmarks?: boolean;
        minDetectionConfidence?: number;
        minTrackingConfidence?: number;
      }): void;
      onResults(cb: (results: any) => void): void;
      send(input: { image: HTMLVideoElement | HTMLCanvasElement | ImageBitmap }): Promise<void>;
      close(): void;
    }
  }
  
  declare module '@mediapipe/camera_utils' {
    export class Camera {
      constructor(
        video: HTMLVideoElement,
        config: {
          onFrame: () => Promise<void> | void;
          width?: number;
          height?: number;
        }
      );
      start(): Promise<void>;
      stop(): void;
    }
  }
  