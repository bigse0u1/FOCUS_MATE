// src/report/recommend.ts
// --------------------------------------------------------
// 최근 7일 집중 패턴 기반 "요일별 Top3 추천 시간대"
// - DB는 1회만 조회
// - 요일(일~토) 기준 각 1시간 슬롯에서 집중 ms 합산
// - 각 요일별 상위 3개만 출력
// --------------------------------------------------------

import { getFramesInRange } from "./aggregate";

type FrameRow = { ts: number; state: string };

const HORIZON_DAYS = 7;           // 최근 7일
const SLOT_MINUTES = 60;          // 1시간 단위
const SLOTS_PER_DAY = 24;
const MAX_GAP_MS = 10_000;        // 프레임 간 최대 인정(10초)
const MIN_FOCUS_MS = 30_000;      // 30초 미만은 의미 없다고 판단 → 제외 (원하면 60초로 변경)

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export async function renderRecommend(now: Date = new Date()) {
  const tbody = document.getElementById("recBody") as HTMLTableSectionElement | null;
  if (!tbody) return;

  tbody.innerHTML = "";

  const endMs = now.getTime();
  const startMs = endMs - HORIZON_DAYS * 24 * 60 * 60 * 1000;

  // 🔥 1) 최근 7일 프레임 전부 읽기 (1회)
  const frames = (await getFramesInRange(startMs, endMs)) as FrameRow[];

  if (!frames.length) {
    tbody.innerHTML = `<tr><td colspan="3">최근 7일 데이터가 없습니다.</td></tr>`;
    return;
  }

  // buckets[dow][slot] = 집중 ms
  const buckets: number[][] = Array.from({ length: 7 }, () =>
    Array(SLOTS_PER_DAY).fill(0)
  );

  // 🔥 2) 프레임 순회하며 집중 시간 누적
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
    const minutes = d.getHours() * 60 + d.getMinutes();
    const slot = Math.floor(minutes / SLOT_MINUTES); // 0~23

    if (slot >= 0 && slot < SLOTS_PER_DAY) {
      buckets[dow][slot] += dt;
    }
  }

  // 🔥 3) 요일별 Top3 추출
  type Row = {
    dow: number;
    slot: number;
    focusMs: number;
    rank: number;
  };

  const result: Row[] = [];

  for (let dow = 0; dow < 7; dow++) {
    const slotAgg = buckets[dow]
      .map((ms, slot) => ({ ms, slot }))
      .filter((v) => v.ms >= MIN_FOCUS_MS) // 의미 없는 소량 데이터 제거
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3); // 🔥 요일별 딱 3개만

    slotAgg.forEach((item, i) => {
      result.push({
        dow,
        slot: item.slot,
        focusMs: item.ms,
        rank: i + 1,
      });
    });
  }

  // 모든 요일이 데이터 부족 → 전체가 빈 상태일 때
  if (!result.length) {
    tbody.innerHTML = `<tr><td colspan="3">추천할 집중 구간이 부족합니다.</td></tr>`;
    return;
  }

  // 🔥 4) 정렬: 요일순 → rank순
  result.sort((a, b) => {
    if (a.dow !== b.dow) return a.dow - b.dow;
    return a.rank - b.rank;
  });

  // 🔥 5) 테이블 렌더링
  for (const row of result) {
    const { dow, slot, focusMs, rank } = row;
    const { startLabel, endLabel } = slotToRange(slot);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rank}</td>
      <td>${DOW_LABELS[dow]} ${startLabel} ~ ${endLabel}</td>
      <td>${Math.round(focusMs / 60000)}분</td>
    `;
    tbody.appendChild(tr);
  }
}

// HH:MM ~ HH:MM
function slotToRange(slot: number) {
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
