// src/report/monthly.ts
// 월간 리포트 (DB 1번만 읽는 최적화 버전)

import { getFramesInRange, avgFocus } from "./aggregate";
import Chart from "chart.js/auto";

export async function renderMonthly(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();

  const monthStart = new Date(y, m, 1, 0, 0, 0, 0).getTime();
  const monthEnd   = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime();
  const days = new Date(y, m + 1, 0).getDate();

  const labels = Array.from({ length: days }, (_, i) => `${i + 1}일`);
  const scores: number[] = [];

  // ================================
  // 🔥 1) DB를 딱 한번만 읽기
  // ================================
  const allFrames = await getFramesInRange(monthStart, monthEnd);

  // ================================
  // 🔥 2) 메모리에서 날짜별로 분할 (초고속)
  // ================================
  for (let d = 1; d <= days; d++) {
    const s = new Date(y, m, d, 0, 0, 0, 0).getTime();
    const e = new Date(y, m, d, 23, 59, 59, 999).getTime();

    // DB read 대신 메모리 filter 사용 → 매우 빠름
    const frames = allFrames.filter(f => f.ts >= s && f.ts < e);
    scores.push(avgFocus(frames));
  }

  // ================================
  // 🎨 Chart.js 렌더링
  // ================================
  const canvas = document.getElementById("monthlyLine") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const isDark = document.body.classList.contains("theme-dark");

  const gridColor = isDark
    ? "rgba(255,255,255,0.18)"
    : "rgba(0,0,0,0.08)";
  const tickColor = isDark
    ? "rgba(255,255,255,0.75)"
    : "#111";

  // 기존 차트 파괴
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
          label: "일자별 평균 집중 점수",
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
