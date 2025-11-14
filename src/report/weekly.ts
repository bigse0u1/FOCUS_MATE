// src/report/weekly.ts
// 최근 7일 일자별 평균 집중 점수 (월 리포트와 동일한 스타일)

import { getFramesInRange, avgFocus } from "./aggregate";
import Chart from "chart.js/auto";

export async function renderWeekly(now = new Date()) {
  // 기준 날짜(now)의 23:59:59.999까지를 "오늘"로 봄
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const dayMs = 24 * 60 * 60 * 1000;

  const labels: string[] = [];
  const scores: number[] = [];

  // 최근 7일: 6일 전 ~ 오늘
  for (let i = 6; i >= 0; i--) {
    const day = new Date(end.getTime() - i * dayMs);
    const y = day.getFullYear();
    const m = day.getMonth();
    const d = day.getDate();

    const s = new Date(y, m, d, 0, 0, 0, 0).getTime();
    const e = new Date(y, m, d, 23, 59, 59, 999).getTime();

    const frames = await getFramesInRange(s, e);
    scores.push(avgFocus(frames));
    labels.push(formatLabel(day)); // 예: "11/14(목)"
  }

  const canvas = document.getElementById("weeklyBar") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 이전 차트 있으면 제거 (월 리포트 방식과 동일 패턴)
  // @ts-ignore
  if ((ctx as any).__chart) (ctx as any).__chart.destroy();

  // @ts-ignore
  (ctx as any).__chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "최근 7일 평균 집중 점수",
          data: scores,
        },
      ],
    },
    options: {
      scales: {
        y: {
          min: 0,
          suggestedMax: 100,
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
