// src/report/daily.ts
// - 오늘 하루(00:00 ~ 지금) 기준 카드 메트릭 계산
// - 1시간 / 24시간은 "그래프 범위만" 바뀜
// - 24시간 그래프는 항상 오늘 00:00 ~ 23:59(실제론 다음날 00:00 직전) 고정
// - 그래프에는 state === "focus" 인 구간만 그린다 (나머지는 null → 선 끊김)

import { db } from "../db";
import Chart from "chart.js/auto";

type Mode = "1h" | "24h";
type FrameRow = { ts: number; state: string; focusScore?: number };

const TARGET_FPS = 15; // fallback 용

let dailyChart: Chart | null = null;

// 메인 진입 함수
export async function renderDaily(now = new Date(), mode: Mode = "24h") {
  // 1) 오늘 00:00 ~ 지금까지 프레임 → 카드용 메트릭
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  const nowMs = now.getTime();

  const dayFrames = (await db.frames
    .where("ts")
    .between(dayStartMs, nowMs, true, true)
    .sortBy("ts")) as FrameRow[];

  const { focusMs, drowsyMs, distractMs, avgFocusScore } =
    computeSummaryDurations(dayFrames);

  const focusMin = Math.round(focusMs / 60000);
  const drowsyMin = Math.round(drowsyMs / 60000);
  const distractMin = Math.round(distractMs / 60000);
  const avgFocus = Math.round(avgFocusScore);

  // ⛳ 카드 숫자 채우기 (항상 "오늘 하루" 기준)
  const $ = (id: string) => document.getElementById(id) as HTMLElement | null;
  if ($("avgFocusToday")) $("avgFocusToday")!.innerText = String(avgFocus);
  if ($("totalFocusToday")) $("totalFocusToday")!.innerText = String(focusMin);
  if ($("drowsyToday")) $("drowsyToday")!.innerText = String(drowsyMin);
  if ($("distractToday")) $("distractToday")!.innerText = String(distractMin);

  // 2) 그래프용 범위 결정
  let rangeStart: number;
  let rangeEnd: number;

  if (mode === "24h") {
    // ✅ 24시간: 오늘 00:00 ~ 내일 00:00 고정
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    rangeStart = dayStartMs;
    rangeEnd = nextDay.getTime();
  } else {
    // ✅ 1시간: 지금 기준 직전 1시간 (슬라이딩)
    rangeEnd = nowMs;
    rangeStart = rangeEnd - 60 * 60 * 1000;
  }

  const framesInRange = (await db.frames
    .where("ts")
    .between(rangeStart, rangeEnd, true, true)
    .sortBy("ts")) as FrameRow[];

  const { labels, values } = buildTimeline(framesInRange, mode, rangeStart, rangeEnd);

  drawDailyChart(labels, values);
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

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const nextTs =
      i < frames.length - 1
        ? frames[i + 1].ts
        : f.ts + 1000 / TARGET_FPS; // 마지막 프레임은 대략 한 프레임만 추가

    const dt = Math.max(0, nextTs - f.ts);

    if (f.state === "focus") focusMs += dt;
    else if (f.state === "drowsy") drowsyMs += dt;
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
// 그래프용: 타임라인(1시간 / 24시간)
// - 1h : 1분 간격, 직전 1시간 (슬라이딩)
// - 24h: 10분 간격, 오늘 00:00 ~ 23:59 고정
// - state === 'focus' 인 프레임만 사용해서 그림
// =====================================
function buildTimeline(
  frames: FrameRow[],
  mode: Mode,
  rangeStart: number,
  rangeEnd: number
) {
  let bucketMs: number;
  let bucketCount: number;

  if (mode === "1h") {
    bucketMs = 60_000; // 1분
    bucketCount = 60; // 60분
  } else {
    bucketMs = 10 * 60_000; // 10분
    bucketCount = 24 * 6; // 24시간 * 6 = 144개
    // rangeStart는 이미 오늘 00:00, rangeEnd는 내일 00:00 으로 넘어옴
  }

  // 혹시 range 길이와 bucketCount*bucketMs가 안 맞아도,
  // start는 그대로 두고, 중심 기준으로 label 생성
  const startTs = rangeStart;

  const sum = new Array<number>(bucketCount).fill(0);
  const cnt = new Array<number>(bucketCount).fill(0);

  for (const f of frames) {
    const idx = Math.floor((f.ts - startTs) / bucketMs);
    if (idx < 0 || idx >= bucketCount) continue;

    // ✅ focus가 아닐 때는 아예 그래프에 반영하지 않음
    if (f.state !== "focus") continue;

    if (typeof f.focusScore === "number") {
      sum[idx] += f.focusScore;
      cnt[idx] += 1;
    }
  }

  const labels: string[] = [];
  const values: (number | null)[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const bucketCenter = startTs + bucketMs * (i + 0.5);
    labels.push(formatTime(bucketCenter));

    if (cnt[i] > 0) {
      values.push(Math.round(sum[i] / cnt[i]));
    } else {
      // 값이 없는 구간은 null → 선이 끊기도록 (집중 안 했던 구간처럼 보이게)
      values.push(null);
    }
  }

  return { labels, values };
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// =====================================
// Chart.js 렌더링
// =====================================
function drawDailyChart(labels: string[], values: (number | null)[]) {
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
          label: "",
          data: values,
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.2,
          spanGaps: false,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,

          // ✅ y축 숫자 표시
          ticks: {
            display: true,
            stepSize: 20, // 0, 20, 40, 60, 80, 100
            color: "#ccc",
            font: { size: 11 },
          },

          // 축 제목은 숨겨둠 (원하면 켜줄 수 있음)
          title: {
            display: false,
          },

          grid: {
            color: "rgba(255,255,255,0.08)",
          },
        },

        x: {
          ticks: {
            autoSkip: true,
            maxRotation: 30,
            minRotation: 30,
            color: "#ccc",
            font: { size: 10 },
          },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

