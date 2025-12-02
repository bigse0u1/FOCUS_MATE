// src/report/recommend.ts
// --------------------------------------------------------
// 최근 7일 집중 패턴 기반 "추천 시간대" 분석 (전역 Top N)
// - DB는 1회만 조회하여 성능 최적화
// - 같은 요일 + 같은 시간대(슬롯)는 한 번만 등장
// --------------------------------------------------------

import { getFramesInRange } from "./aggregate";

type FrameRow = { ts: number; state: string };

const HORIZON_DAYS = 7;
const SLOT_MINUTES = 60;        // 1시간 단위 버킷
const SLOTS_PER_DAY = 24;
const MAX_GAP_MS = 10_000;

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const TOP_N = 10;               // 추천 상위 10개 슬롯 출력

export async function renderRecommend(now: Date = new Date()) {
  const tbody = document.getElementById("recBody") as HTMLTableSectionElement | null;
  if (!tbody) return;

  tbody.innerHTML = ""; // 기존 내용 초기화

  const endMs = now.getTime();
  const startMs = endMs - HORIZON_DAYS * 24 * 60 * 60 * 1000;

  // -----------------------------------------------------
  // 🔥 1) 최근 7일 프레임 1회 조회 (성능 최적화)
  // -----------------------------------------------------
  const frames = (await getFramesInRange(startMs, endMs)) as FrameRow[];

  if (!frames.length) {
    tbody.innerHTML = `<tr><td colspan="3">최근 7일 데이터가 없습니다.</td></tr>`;
    return;
  }

  // -----------------------------------------------------
  // buckets[dow][slot] = 총 집중(ms)
  // -----------------------------------------------------
  const buckets: number[][] = Array.from({ length: 7 }, () =>
    Array(SLOTS_PER_DAY).fill(0)
  );

  // -----------------------------------------------------
  // 🔥 2) 프레임 순회하며 focus 상태 시간 누적
  // -----------------------------------------------------
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const nextTs =
      i < frames.length - 1 ? frames[i + 1].ts : f.ts + 1000 / 15;

    if (f.state !== "focus") continue;

    let dt = nextTs - f.ts;
    if (dt < 0) dt = 0;
    if (dt > MAX_GAP_MS) dt = MAX_GAP_MS;

    const d = new Date(f.ts);
    const dow = d.getDay();
    const slot = Math.floor((d.getHours() * 60 + d.getMinutes()) / SLOT_MINUTES);

    if (slot >= 0 && slot < 24) {
      buckets[dow][slot] += dt;
    }
  }

  // -----------------------------------------------------
  // 🔥 3) 요일/시간대별 집중 ms 전역 리스트로 변환
  // -----------------------------------------------------
  type SlotAgg = { dow: number; slot: number; focusMs: number };
  const list: SlotAgg[] = [];

  for (let dow = 0; dow < 7; dow++) {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
      const ms = buckets[dow][slot];
      if (ms > 0) {
        list.push({ dow, slot, focusMs: ms });
      }
    }
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="3">집중 패턴을 만들 수 있을 만큼의 데이터가 없습니다.</td></tr>`;
    return;
  }

  // -----------------------------------------------------
  // 🔥 4) 전역 Top N 선택
  // -----------------------------------------------------
  list.sort((a, b) => b.focusMs - a.focusMs);
  const top = list.slice(0, TOP_N);

  // -----------------------------------------------------
  // 🔥 5) 렌더링
  // -----------------------------------------------------
  top.forEach((item, idx) => {
    const rank = idx + 1;
    const { dow, slot, focusMs } = item;
    const { startLabel, endLabel } = slotToTimeRange(slot);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rank}</td>
      <td>${DOW_LABELS[dow]} ${startLabel} ~ ${endLabel}</td>
      <td>${Math.round(focusMs / 60000)}분</td>
    `;
    tbody.appendChild(tr);
  });
}

// -----------------------------------------------------
// HH:MM ~ HH:MM 포맷
// -----------------------------------------------------
function slotToTimeRange(slot: number) {
  const start = slot * SLOT_MINUTES;
  const end = start + SLOT_MINUTES;

  const sh = Math.floor(start / 60);
  const sm = start % 60;
  const eh = Math.floor(end / 60) % 24;
  const em = end % 60;

  return {
    startLabel: `${pad2(sh)}:${pad2(sm)}`,
    endLabel: `${pad2(eh)}:${pad2(em)}`,
  };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
