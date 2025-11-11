// src/types.ts
export type XY = { x: number; y: number };

export type VisionFrame = {
  t: number;               // ms (performance.now())
  conf: number;            // 0~1
  eyes: { l: XY[]; r: XY[] };     // 각 눈 4~8점 (부족하면 4점만)
  iris: { l: XY; r: XY };         // 각 눈의 홍채 중심
  landmarks?: XY[];               // (선택) 전체 얼굴 468점
};

export type BlinkEvent = {
  start: number;
  end: number;
  duration: number;
  closingSpeed: number;
  openingSpeed: number;
};

export type MetricsSnapshot = {
  t: number;
  earL: number;
  earR: number;
  earAvg: number;
  perclos: number;               // 0~1 (60s 창)
  fixation: {
    isFixed: boolean;
    dwellMs: number;
    stability: number;
    roiKey: string;              // "x,y" (3x3)
  };
  blink?: BlinkEvent;            // 해당 프레임 종료 시점에 감지되면 포함
  blinksPerMin: number;          // 60s 윈도우 내 추정
};

export type FocusState = "FOCUSED" | "DISTRACTED" | "TIRED" | "DROWSY";

export type StateOutput = {
  t: number;
  state: FocusState;
  score: number;                 // 0~100
  reason?: string[] | string;
};
