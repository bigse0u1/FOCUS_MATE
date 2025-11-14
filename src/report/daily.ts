// src/report/daily.ts
// - 일 리포트 (1시간 / 24시간)
// - 1h  : 최근 1시간, 1분 단위
// - 24h : 오늘 0시~24시, 10분 단위 평균

import { db } from "../db";
import Chart from "chart.js/auto";

type Mode = "1h" | "24h";

let dailyChart: Chart | null = null;
let currentMode: Mode = "24h";

// 외부에서 mode만 넘겨도 되도록
export async function renderDaily(baseDate: Date = new Date(), mode: Mode = currentMode) {
  currentMode = mode;

  const canvas = document.getElementById("dailyTimeline") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // =========================
  // 1) 조회 구간 계산
  // =========================
  let start: number;
  let end: number;
  let binMinutes: number;
  let titleLabel: string;

  if (mode === "1h") {
    end = baseDate.getTime();
    start = end - 60 * 60 * 1000; // 최근 1시간
    binMinutes = 1;
    titleLabel = "최근 1시간 집중도 (1분 단위)";
  } else {
    const day0 = new Date(baseDate);
    day0.setHours(0, 0, 0, 0);
    start = day0.getTime();
    end = start + 24 * 60 * 60 * 1000; // 오늘 하루
    binMinutes = 10;
    titleLabel = "오늘 집중도 (10분 평균)";
  }

  const binMs = binMinutes * 60 * 1000;
  const binCount = Math.ceil((end - start) / binMs);

  // =========================
  // 2) DB에서 프레임 가져오기
  // =========================
  const frames = await db.frames
    .where("ts")
    .between(start, end, true, false)
    .toArray();

  // 요약 카드용 값 계산
  updateSummaryCards(frames, mode);

  // =========================
  // 3) bin별 평균 집중도 계산
  // =========================
  const sum: number[] = new Array(binCount).fill(0);
  const count: number[] = new Array(binCount).fill(0);

  for (const f of frames) {
    const idx = Math.floor((f.ts - start) / binMs);
    if (idx < 0 || idx >= binCount) continue;
    sum[idx] += f.focusScore ?? 0;
    count[idx] += 1;
  }

  const labels: string[] = [];
  const data: (number | null)[] = [];

  for (let i = 0; i < binCount; i++) {
    const t = start + i * binMs;
    const d = new Date(t);
    labels.push(formatTimeLabel(d, mode));

    if (count[i] > 0) {
      data.push(Math.round(sum[i] / count[i]));
    } else {
      data.push(null); // 빈 구간은 끊어서(spanGaps) 표시
    }
  }

  // =========================
  // 4) Chart.js 렌더
  // =========================
  if (dailyChart) {
    dailyChart.destroy();
    dailyChart = null;
  }

  dailyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: titleLabel,
          data,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // CSS height 사용
      spanGaps: true,
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: {
            callback: (v) => `${v}%`,
          },
        },
        x: {
          ticks: {
            // 너무 촘촘하면 줄이기
            maxTicksLimit: mode === "1h" ? 7 : 12,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const y = ctx.parsed.y;
              if (y == null) return "";
              return `집중도 ${y}%`;
            },
            title: (items) => {
              if (!items.length) return "";
              const idx = items[0].dataIndex;
              return labels[idx];
            },
          },
        },
      },
    },
  });
}

// =========================
// ⏱ 시간 라벨 포맷
// =========================
function formatTimeLabel(d: Date, mode: Mode): string {
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");

  if (mode === "1h") {
    // ex) 13:05
    return `${hh}:${mm}`;
  } else {
    // 24시간 뷰: 10분간격 → 시각이 너무 많으니
    // 1시간 단위는 "13시", 중간(10,20,30,40,50분)은 "13:10" 형식
    if (d.getMinutes() === 0) return `${hh}시`;
    return `${hh}:${mm}`;
  }
}

// =========================
// 📊 상단 카드(평균 집중도, 총 집중시간 등) 업데이트
// =========================
function updateSummaryCards(frames: any[], mode: Mode) {
  if (!frames.length) {
    setText("avgFocusToday", "-");
    setText("totalFocusToday", "-");
    setText("drowsyToday", "-");
    setText("distractToday", "-");
    return;
  }

  // 전체 평균 집중도
  const avg =
    frames.reduce((a, f) => a + (f.focusScore ?? 0), 0) / frames.length;

  // 초당 15fps 기준 → 60프레임 = 4초지만,
  // 여기서는 일단 "프레임 60개 = 1분"으로 단순 계산 (기존 로직 유지)
  const focusMin = Math.round(
    frames.filter((f) => f.state === "focus").length / 60
  );
  const drowsyMin = Math.round(
    frames.filter((f) => f.state === "drowsy").length / 60
  );
  const distractMin = Math.round(
    frames.filter((f) => f.state === "distract").length / 60
  );

  setText("avgFocusToday", `${Math.round(avg)}%`);
  setText("totalFocusToday", `${focusMin}분`);
  setText("drowsyToday", `${drowsyMin}분`);
  setText("distractToday", `${distractMin}분`);
}

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
