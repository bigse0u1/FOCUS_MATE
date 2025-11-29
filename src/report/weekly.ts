// src/report/weekly.ts
// 최근 7일 평균 집중 점수 (DB 1번만 읽는 최적화 버전)

import { getFramesInRange, avgFocus } from "./aggregate";
import Chart from "chart.js/auto";

export async function renderWeekly(now = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const dayMs = 24 * 60 * 60 * 1000;

  const labels: string[] = [];
  const scores: number[] = [];

  // ===============================
  // 🔥 DB를 ‘1번만’ 읽기
  // ===============================
  const rangeStart = end.getTime() - 7 * dayMs;
  const rangeEnd = end.getTime();
  const allFrames = await getFramesInRange(rangeStart, rangeEnd);

  // ===============================
  // 🔥 7일 데이터를 메모리에서 분리
  // ===============================
  for (let i = 6; i >= 0; i--) {
    const day = new Date(end.getTime() - i * dayMs);

    const y = day.getFullYear();
    const m = day.getMonth();
    const d = day.getDate();

    const s = new Date(y, m, d, 0, 0, 0, 0).getTime();
    const e = new Date(y, m, d, 23, 59, 59, 999).getTime();

    const frames = allFrames.filter((f) => f.ts >= s && f.ts < e); // ⭕ 메모리 내 filter → 매우 빠름
    scores.push(avgFocus(frames));
    labels.push(formatLabel(day));
  }

  // ===============================
  // 🎨 Chart.js 렌더링
  // ===============================
  const canvas = document.getElementById("weeklyBar") as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 다크모드 여부
  const isDark = document.body.classList.contains("theme-dark");

  const gridColor = isDark
    ? "rgba(255,255,255,0.18)"
    : "rgba(0,0,0,0.08)";
  const tickColor = isDark
    ? "rgba(255,255,255,0.75)"
    : "#111";

  // 기존 차트 제거
  // @ts-ignore
  if ((ctx as any).__chart) (ctx as any).__chart.destroy();

  // 새 차트 생성
  // @ts-ignore
  (ctx as any).__chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "최근 7일 평균 집중 점수",
          data: scores,
          borderWidth: 1.6,
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          suggestedMax: 100,
          grid: {
            color: gridColor,
          },
          border: {
            color: gridColor,
          },
          ticks: {
            color: tickColor,
          },
        },
        x: {
          ticks: {
            color: tickColor,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
      },
    },
  });
}

function formatLabel(d: Date): string {
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${mm}/${dd}(${weekday})`;
}
