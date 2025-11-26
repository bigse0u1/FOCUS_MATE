// src/report/daily.ts
// - 오늘 하루(00:00 ~ 24:00) 기준 카드 메트릭 계산
// - 그래프 모드:
//   • 1h  : 선택된 시(hour)의 00~59분, 1분 단위 버킷, X축 라벨은 5분마다 표시
//   • 24h : 00:00~24:00, 1분 단위 버킷, X축 라벨은 1시간마다 표시
// - 시간 계산은 FPS가 아니라 ts(타임스탬프) 차이 기반

import { db } from "../db";
import Chart from "chart.js/auto";

type Mode = "1h" | "24h";
type FrameRow = { ts: number; state: string; focusScore?: number };

const TARGET_FPS = 15; // 마지막 프레임 duration 추정용 fallback

let dailyChart: Chart | null = null;

// ===== 공용 헬퍼 =====
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

// 카드용 "m시간 n분" 포맷
function formatHMFromMs(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${totalMin}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

// 시간 라벨(분 단위)
function formatTimeLabel(ts: number) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// =====================================
// 메인 진입 함수
// =====================================
export async function renderDaily(now = new Date(), mode: Mode = "24h") {
  // 1) 오늘 00:00 ~ 24:00 프레임 가져오기 (카드 + 24h 그래프 공통)
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

  const dayFrames = (await db.frames
    .where("ts")
    .between(dayStartMs, dayEndMs, true, false)
    .sortBy("ts")) as FrameRow[];

  // 1-1) 카드용 전체 요약 계산
  const {
    focusMs,
    drowsyMs,
    distractMs,
    avgFocusScore,
  } = computeSummaryDurations(dayFrames);

  const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

  if ($("avgFocusToday")) {
    $("avgFocusToday")!.innerText = String(Math.round(avgFocusScore));
  }
  if ($("totalFocusToday")) {
    $("totalFocusToday")!.innerText = formatHMFromMs(focusMs);
  }
  if ($("drowsyToday")) {
    $("drowsyToday")!.innerText = formatHMFromMs(drowsyMs);
  }
  if ($("distractToday")) {
    $("distractToday")!.innerText = formatHMFromMs(distractMs);
  }

  // 2) 그래프용 타임라인 생성
  let labels: string[] = [];
  let values: (number | null)[] = [];

  if (mode === "24h") {
    // 24시간: 00:00~24:00, 1분 버킷(1440개)
    ({ labels, values } = buildTimeline24h(dayFrames, dayStartMs));
  } else {
    // 1시간: "현재 시" 기준 시각의 0~59분, 1분 버킷(60개)
    ({ labels, values } = buildTimeline1h(dayFrames, now));
  }

  drawDailyChart(labels, values, mode);
}

// =====================================
// 카드용: 하루 전체 요약 (ts 기반 duration)
// =====================================
function computeSummaryDurations(frames: FrameRow[]) {
  if (!frames.length) {
    return {
      focusMs: 0,
      drowsyMs: 0,
      distractMs: 0,
      avgFocusScore: 0,
    };
  }

  let focusMs = 0;
  let drowsyMs = 0;
  let distractMs = 0;
  let sumScore = 0;
  let cntScore = 0;

  // 🔹 프레임 간 최대 인정 간격 (3초까지는 "연속"으로 본다)
  const FRAME_DT = 1000 / TARGET_FPS; // ≈ 66ms
  const MAX_DT = 3000;                // 3,000ms = 3초

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const nextTs =
      i < frames.length - 1
        ? frames[i + 1].ts
        : f.ts + FRAME_DT; // 마지막 프레임은 한 프레임 만큼만

    const dtRaw = nextTs - f.ts;
    // 음수 방지 + 너무 긴 간격은 3초까지만 인정
    const dt = dtRaw <= 0 ? 0 : Math.min(dtRaw, MAX_DT);

    if (f.state === "focus")      focusMs   += dt;
    else if (f.state === "drowsy")  drowsyMs  += dt;
    else if (f.state === "distract") distractMs += dt;

    if (typeof f.focusScore === "number") {
      sumScore += f.focusScore;
      cntScore++;
    }
  }

  const avgFocusScore = cntScore ? sumScore / cntScore : 0;

  return { focusMs, drowsyMs, distractMs, avgFocusScore };
}


// =====================================
// 24h 타임라인 (1분 버킷, 라벨은 1시간마다 표시)
// =====================================
function buildTimeline24h(frames: FrameRow[], dayStartMs: number) {
  const bucketMs = 60_000; // 1분
  const bucketCount = 24 * 60; // 1440

  const sum = new Array<number>(bucketCount).fill(0);
  const cnt = new Array<number>(bucketCount).fill(0);

  for (const f of frames) {
    const diff = f.ts - dayStartMs;
    if (diff < 0 || diff >= bucketMs * bucketCount) continue;

    const idx = Math.floor(diff / bucketMs);
    if (idx < 0 || idx >= bucketCount) continue;

    if (typeof f.focusScore === "number") {
      sum[idx] += f.focusScore;
      cnt[idx] += 1;
    }
  }

  const labels: string[] = [];
  const values: (number | null)[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const ts = dayStartMs + i * bucketMs;
    labels.push(formatTimeLabel(ts));

    if (cnt[i] > 0) {
      values.push(Math.round(sum[i] / cnt[i]));
    } else {
      values.push(null);
    }
  }

  return { labels, values };
}

// =====================================
// 1h 타임라인 (1분 버킷, X축 라벨은 5분마다 표시)
// - 기준: now가 속한 시(hour)의 00~59분
// =====================================
function buildTimeline1h(frames: FrameRow[], now: Date) {
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const hourStartMs = hourStart.getTime();
  const hourEndMs = hourStartMs + 60 * 60 * 1000; // 정확히 1시간

  const framesInHour = frames.filter(
    (f) => f.ts >= hourStartMs && f.ts < hourEndMs
  );

  const bucketMs = 60_000; // 1분
  const bucketCount = 60; // 0~59분

  const sum = new Array<number>(bucketCount).fill(0);
  const cnt = new Array<number>(bucketCount).fill(0);

  for (const f of framesInHour) {
    const diff = f.ts - hourStartMs;
    if (diff < 0 || diff >= bucketMs * bucketCount) continue;

    const idx = Math.floor(diff / bucketMs);
    if (idx < 0 || idx >= bucketCount) continue;

    if (typeof f.focusScore === "number") {
      sum[idx] += f.focusScore;
      cnt[idx] += 1;
    }
  }

  const labels: string[] = [];
  const values: (number | null)[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const ts = hourStartMs + i * bucketMs;
    labels.push(formatTimeLabel(ts));

    if (cnt[i] > 0) {
      values.push(Math.round(sum[i] / cnt[i]));
    } else {
      values.push(null);
    }
  }

  return { labels, values };
}

// =====================================
// Chart.js 렌더링
// =====================================
function drawDailyChart(
  labels: string[],
  values: (number | null)[],
  mode: Mode
) {
  const canvas = document.getElementById("dailyTimeline") as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (dailyChart) {
    dailyChart.destroy();
  }

  dailyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "집중도(%)",
          data: values,
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.2,
          spanGaps: false, // null 구간은 선이 끊어짐
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          // 카테고리 스케일: 라벨은 전체(분 단위)지만, callback에서 일부만 보여줌
          ticks: {
            autoSkip: false,
            maxRotation: 45,
            minRotation: 45,
            callback: (value, index) => {
              const i = index as number;
              const label = labels[i];

              if (mode === "24h") {
                // 24시간 그래프: 매 시각(분=00)만 표시
                // label 형식: "HH:MM"
                const mm = label.slice(3, 5);
                return mm === "00" ? label : "";
              } else {
                // 1시간 그래프: 5분마다 표시
                return i % 5 === 0 ? label : "";
              }
            },
          },
          grid: {
            display: false, // 세로선 제거
          },
        },
        y: {
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: {
            // 기본 숫자만 (0~100)
          },
          grid: {
            display: true,
          },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}
