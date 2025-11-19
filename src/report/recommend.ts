// src/report/recommend.ts
// -----------------------------------
// 요일별(일~토) + 1시간 단위 집중 패턴 분석
// - 최근 7일(frames) 기준
// - 각 요일마다 "집중 시간이 긴 1시간 구간" 상위 3개 추천
// - 테이블 컬럼은 그대로 사용하되,
//   "추천 시간대" 칸에 "월 21:00 ~ 22:00" 이런 식으로 표기
// -----------------------------------

import { db } from "../db";

type FrameRow = { ts: number; state: string; focusScore?: number };

const HORIZON_DAYS = 7;            // 최근 7일 기준
const SLOT_MINUTES = 60;           // ✅ 1시간 단위 버킷
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES; // 24
const MAX_GAP_MS = 10_000;         // 프레임 사이 간격이 너무 크면 10초로 클램프

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export async function renderRecommend(now: Date = new Date()) {
  const tbody = document.getElementById("recBody") as HTMLTableSectionElement | null;
  if (!tbody) return;

  // 기존 내용 삭제
  tbody.innerHTML = "";

  const endMs = now.getTime();
  const startMs = endMs - HORIZON_DAYS * 24 * 60 * 60 * 1000;

  // 최근 7일 프레임
  const frames = (await db.frames
    .where("ts")
    .between(startMs, endMs, true, true)
    .sortBy("ts")) as FrameRow[];

  if (!frames.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3">최근 7일 데이터가 없습니다.</td>`;
    tbody.appendChild(tr);
    return;
  }

  // [요일(0~6)][slotIndex(0~23)] → 총 집중 ms
  const buckets: number[][] = Array.from({ length: 7 }, () =>
    Array<number>(SLOTS_PER_DAY).fill(0)
  );

  // 프레임 간 dt(타임스탬프 차이)로 "focus 상태 시간"을 쌓는다.
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const nextTs =
      i < frames.length - 1
        ? frames[i + 1].ts
        : f.ts + 1000 / 15; // 마지막 프레임은 대략 1프레임(≈66ms) 정도

    let dt = nextTs - f.ts;
    if (dt < 0) dt = 0;
    if (dt > MAX_GAP_MS) dt = MAX_GAP_MS;

    // "focus" 상태인 구간만 집중 시간으로 카운트
    if (f.state !== "focus") continue;

    const d = new Date(f.ts);
    const dow = d.getDay(); // 0=일, 1=월, ... 6=토

    const totalMinutes = d.getHours() * 60 + d.getMinutes();
    const slotIndex = Math.floor(totalMinutes / SLOT_MINUTES); // 0~23

    if (slotIndex < 0 || slotIndex >= SLOTS_PER_DAY) continue;

    buckets[dow][slotIndex] += dt;
  }

  // 각 요일별로 "집중 시간이 긴 1시간 구간" 상위 3개 선정
  type Row = { dow: number; slotIndex: number; focusMs: number; rank: number };
  const rows: Row[] = [];

  for (let dow = 0; dow < 7; dow++) {
    const arr = buckets[dow];

    // (slotIndex, focusMs) 리스트 만들기
    const slotList = arr
      .map((ms, idx) => ({ slotIndex: idx, focusMs: ms }))
      .filter((x) => x.focusMs > 0);

    if (!slotList.length) continue;

    // 집중시간 내림차순 정렬
    slotList.sort((a, b) => b.focusMs - a.focusMs);

    // 상위 3개까지만 선택
    const topN = slotList.slice(0, 3);

    topN.forEach((item, i) => {
      rows.push({
        dow,
        slotIndex: item.slotIndex,
        focusMs: item.focusMs,
        rank: i + 1, // 1, 2, 3위
      });
    });
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3">집중 패턴을 만들 수 있을 만큼의 데이터가 없습니다.</td>`;
    tbody.appendChild(tr);
    return;
  }

  // 요일(일→토), 같은 요일 내에서는 rank(1→3) 순으로 정렬
  rows.sort((a, b) => {
    if (a.dow !== b.dow) return a.dow - b.dow;
    return a.rank - b.rank;
  });

  // 테이블 렌더링
  for (const row of rows) {
    const { dow, slotIndex, focusMs, rank } = row;
    const labelDow = DOW_LABELS[dow];

    const { startLabel, endLabel } = slotToTimeRange(slotIndex);

    const minutes = Math.round(focusMs / 60000); // ms → 분

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rank}</td>
      <td>${labelDow} ${startLabel} ~ ${endLabel}</td>
      <td>${minutes}분</td>
    `;
    tbody.appendChild(tr);
  }
}

// 1시간 슬롯 인덱스(0~23)를 "HH:MM" 범위로 변환
function slotToTimeRange(slotIndex: number): { startLabel: string; endLabel: string } {
  const startMinutes = slotIndex * SLOT_MINUTES;   // 0, 60, 120, ...
  const endMinutes = startMinutes + SLOT_MINUTES;  // 60, 120, ...

  const sh = Math.floor(startMinutes / 60);
  const sm = startMinutes % 60;
  const eh = Math.floor(endMinutes / 60) % 24;     // 24시 → 00시
  const em = endMinutes % 60;

  const startLabel = `${pad2(sh)}:${pad2(sm)}`;
  const endLabel = `${pad2(eh)}:${pad2(em)}`;
  return { startLabel, endLabel };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
