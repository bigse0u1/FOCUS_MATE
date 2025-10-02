// src/types.ts

export type XY = { x: number; y: number };

export type VisionFrame = {
  t: number;
  eyes: { l: XY[]; r: XY[] };   // 각 4점
  iris: { l: XY; r: XY };
  conf: number;                 // 0~1
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
  blink?: BlinkEvent;
  perclos: number;              // 0~1
  fixation: {
    isFixed: boolean;
    dwellMs: number;
    stability: number;
    roiKey: string;             // "x,y"
  };
};

// ✅ 1-3(상태) 타입 — StateMachine 코드에 맞춤
export type FocusState = "FOCUSED" | "TIRED" | "DISTRACTED" | "DROWSY";

export type StateOutput = {
  t: number;
  state: FocusState;
  // 팀 코드가 배열 이유(reasons)를 쓰므로 string | string[] 허용
  reason?: string | string[];
  // score도 반환하므로 선택 필드로 포함
  score?: number;
  // 필요 시 알림 레벨 확장용
  level?: "info" | "warn" | "critical";
  blink?: BlinkEvent;
};
