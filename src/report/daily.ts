import { getFramesInRange, sumMinutes, avgFocus } from "./aggregate";
import Chart from "chart.js/auto";

/**
 * 일 리포트: 1분 단위(총 1440점) 꺾은선 그래프
 * - Y축: 0~100 (집중 점수)
 * - X축: 00:00 ~ 23:59 (틱은 1시간 단위 라벨)
 */
export async function renderDaily(date = new Date()) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(date); end.setHours(23, 59, 59, 999);

  const frames = await getFramesInRange(start.getTime(), end.getTime());

  // KPI 카드 값은 유지 (평균/총합/구간 시간 등)
  const avg = avgFocus(frames as any);
  const focMin = sumMinutes(frames as any, 'focus');
  const droMin = sumMinutes(frames as any, 'drowsy');
  const disMin = sumMinutes(frames as any, 'distract');

  setText("avgFocusToday", `${avg}점`);
  setText("totalFocusToday", `${focMin}분`);
  setText("drowsyToday", `${droMin}분`);
  setText("distractToday", `${disMin}분`);

  // 1분 단위(0~1439분) 평균 집중점수 계산
  // 같은 분에 저장된 여러 frame이 있을 수 있으므로 분당 평균값으로 집계
  const minutes = 24 * 60; // 1440
  const sums = new Array<number>(minutes).fill(0);
  const cnts = new Array<number>(minutes).fill(0);

  for (const f of frames as any[]) {
    const d = new Date(f.ts);
    const idx = d.getHours() * 60 + d.getMinutes(); // 0..1439
    sums[idx] += (f.focusScore ?? 0);
    cnts[idx] += 1;
  }
  const series = sums.map((s, i) => (cnts[i] ? Math.min(100, Math.max(0, s / cnts[i])) : null));

  // 레이블은 1시간 간격 표시: 00:00, 01:00, ...
  // Chart.js에서는 라벨을 전부 비워두고 tick 콜백으로 1시간마다만 찍어주는 게 깔끔
  const labels = Array.from({ length: minutes }, (_, i) => i); // 0..1439 (라벨은 tick 콜백에서 포맷팅)

  // 차트 그리기
  const canvas = document.getElementById('dailyTimeline') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  // 기존 차트 파괴
  // @ts-ignore
  if ((ctx as any).__chart) (ctx as any).__chart.destroy();

  // 라인 차트 생성
  // @ts-ignore
  (ctx as any).__chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '분당 평균 집중 점수',
          data: series,          // (0~100 or null)
          spanGaps: true,        // 데이터가 없는 구간(null)은 점프
          pointRadius: 0,        // 점 표시 제거(밀도 높으므로)
          tension: 0.25,         // 약간의 곡선
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
              const hh = String(Math.floor(idx / 60)).padStart(2, '0');
              const mm = String(idx % 60).padStart(2, '0');
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
              const idx = Number(value); // 0..1439
              // 1시간 단위 라벨만 표기
              if (idx % 60 === 0) {
                const hh = String(idx / 60).padStart(2, '0');
                return `${hh}:00`;
              }
              return ''; // 그 외 분은 라벨 비움
            }
          },
          grid: {
            // 1시간 간격으로 굵은 그리드 느낌
            drawTicks: true,
            color: (ctx) => (ctx.tick?.value % 60 === 0 ? 'rgba(180,180,220,0.15)' : 'rgba(180,180,220,0.06)')
          }
        },
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20 },
          grid: { color: 'rgba(180,180,220,0.08)' }
        }
      },
      elements: {
        line: { borderWidth: 2 },
      }
    }
  });
}

function setText(id: string, v: string) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = v;
}
