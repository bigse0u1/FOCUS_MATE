import { getFramesInRange, sumMinutes, avgFocus } from "./aggregate";
import Chart from "chart.js/auto";

export type DailyView = "1h" | "24h";
let currentView: DailyView = "24h"; // 기본값

/**
 * 일 리포트: 1분 단위 라인 차트
 * - view=1h  : 최근 60분
 * - view=24h : 00:00~23:59 (하루)
 * - Y: 0~100, X 라벨: 1h(10분마다), 24h(1시간마다)
 */
export async function renderDaily(date = new Date(), view: DailyView = currentView) {
  currentView = view;

  // 기간 계산
  const now = new Date(date);
  let rangeStart: Date, rangeEnd: Date, minutes: number;

  if (view === "1h") {
    rangeEnd = new Date(now);
    rangeStart = new Date(now.getTime() - 60 * 60 * 1000); // 최근 60분
    minutes = 60;
  } else {
    // 24h
    rangeStart = new Date(now); rangeStart.setHours(0,0,0,0);
    rangeEnd   = new Date(now); rangeEnd.setHours(23,59,59,999);
    minutes = 24 * 60; // 1440
  }

  const frames = await getFramesInRange(rangeStart.getTime(), rangeEnd.getTime());

  // KPI 카드(24h 기준 유지)
  if (view === "24h") {
    const fullStart = new Date(now); fullStart.setHours(0,0,0,0);
    const fullEnd   = new Date(now); fullEnd.setHours(23,59,59,999);
    const fullFrames = await getFramesInRange(fullStart.getTime(), fullEnd.getTime());
    setText("avgFocusToday", `${avgFocus(fullFrames as any)}점`);
    setText("totalFocusToday", `${sumMinutes(fullFrames as any, 'focus')}분`);
    setText("drowsyToday", `${sumMinutes(fullFrames as any, 'drowsy')}분`);
    setText("distractToday", `${sumMinutes(fullFrames as any, 'distract')}분`);
  }

  // 분 단위 집계
  const sums = new Array<number>(minutes).fill(0);
  const cnts = new Array<number>(minutes).fill(0);

  for (const f of frames as any[]) {
    const t = new Date(f.ts).getTime();
    const idx = Math.floor((t - rangeStart.getTime()) / (60 * 1000)); // 0..minutes-1
    if (idx >= 0 && idx < minutes) {
      sums[idx] += (f.focusScore ?? 0);
      cnts[idx] += 1;
    }
  }
  const series = sums.map((s, i) => (cnts[i] ? clamp01to100(s / cnts[i]) : null));
  const labels = Array.from({ length: minutes }, (_, i) => i);

  // 차트 그리기
  const canvas = document.getElementById('dailyTimeline') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  // @ts-ignore
  if ((ctx as any).__chart) (ctx as any).__chart.destroy();

  // @ts-ignore
  (ctx as any).__chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: view === "1h" ? "최근 60분 평균 집중 점수" : "분당 평균 집중 점수(24h)",
          data: series,
          spanGaps: true,
          pointRadius: 0,
          tension: 0.25,
        }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const base = new Date(rangeStart.getTime() + idx * 60 * 1000);
              const hh = String(base.getHours()).padStart(2, '0');
              const mm = String(base.getMinutes()).padStart(2, '0');
              return `${hh}:${mm}`;
            },
            label: (item) => `집중도 ${Math.round((item.raw as number) ?? 0)}점`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            callback: (value) => {
              const i = Number(value);
              if (view === "1h") {
                // 10분 간격 라벨
                if (i % 10 === 0) {
                  const base = new Date(rangeStart.getTime() + i * 60 * 1000);
                  const hh = String(base.getHours()).padStart(2, '0');
                  const mm = String(base.getMinutes()).padStart(2, '0');
                  return `${hh}:${mm}`;
                }
                return "";
              } else {
                // 1시간 간격 라벨
                if (i % 60 === 0) {
                  const base = new Date(rangeStart.getTime() + i * 60 * 1000);
                  const hh = String(base.getHours()).padStart(2, '0');
                  return `${hh}:00`;
                }
                return "";
              }
            }
          },
          grid: {
            color: (ctx) => {
              const i = ctx.tick?.value as number;
              if (i == null) return 'rgba(180,180,220,0.06)';
              return (i % 60 === 0) ? 'rgba(180,180,220,0.15)' : 'rgba(180,180,220,0.06)';
            }
          }
        },
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20 },
          grid: { color: 'rgba(180,180,220,0.08)' }
        }
      },
      elements: { line: { borderWidth: 2 } }
    }
  });
}

function setText(id: string, v: string) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = v;
}
function clamp01to100(v: number) {
  if (Number.isNaN(v)) return null;
  return Math.min(100, Math.max(0, v));
}
