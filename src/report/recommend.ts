// src/report/recommend.ts
// --------------------------------------------------------
// 최근 7일 집중 패턴 기반 "추천 시간대" 분석 (요일별 Top3)
// - DB는 1회만 조회하여 성능 대폭 개선
// - 다크/라이트 모드 자동 적용 (CSS로 처리)
// --------------------------------------------------------

import { getFramesInRange } from "./aggregate";

type FrameRow = { ts: number; state: string };

const HORIZON_DAYS = 7;
const SLOT_MINUTES = 60; // 1시간
const SLOTS_PER_DAY = 24;
const MAX_GAP_MS = 10_000;

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export async function renderRecommend(now: Date = new Date()) {
  const tbody = document.getElementById("recBody") as HTMLTableSectionElement | null;
  if (!tbody) return;

  tbody.innerHTML = "";

  const endMs = now.getTime();
  const startMs = endMs - HORIZON_DAYS * 24 * 60 * 60 * 1000;

  // -------------- 🔥 DB 1회 조회 (초고속) ----------------
  const frames = (await getFramesInRange(startMs, endMs)) as FrameRow[];

  if (!frames.length) {
    tbody.innerHTML = `<tr><td colspan="3">최근 7일 데이터가 없습니다.</td></tr>`;
    return;
  }

  // buckets[dow][slot] = 집중 ms
  const buckets: number[][] = Array.from({ length: 7 }, () =>
    Array(SLOTS_PER_DAY).fill(0)
  );

  // -------------- 🔥 프레임 순회하며 집중 시간 누적 ----------------
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

  // -------------- 🔥 Top3 슬롯 추출 ----------------
  type Row = { dow: number; slot: number; focusMs: number; rank: number };
  const rows: Row[] = [];

  for (let dow = 0; dow < 7; dow++) {
    const slotList = buckets[dow]
      .map((ms, slot) => ({ slot, ms }))
      .filter((x) => x.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3);

    slotList.forEach((item, i) =>
      rows.push({
        dow,
        slot: item.slot,
        focusMs: item.ms,
        rank: i + 1,
      })
    );
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3">집중 패턴을 만들 수 있을 만큼의 데이터가 없습니다.</td></tr>`;
    return;
  }

  // 요일 → 랭크 순 정렬
  rows.sort((a, b) => (a.dow !== b.dow ? a.dow - b.dow : a.rank - b.rank));

  // -------------- 🔥 렌더링 ----------------
  for (const row of rows) {
    const { dow, slot, focusMs, rank } = row;

    const { startLabel, endLabel } = slotToTimeRange(slot);

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
