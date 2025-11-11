// src/ui/tabs.ts (수정본 전체)
type TabKey = 'daily' | 'weekly' | 'monthly' | 'recommend' | 'settings';

const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.tabs .tab')
);
const reports: Record<TabKey, HTMLElement> = {
  daily: document.getElementById('reportDaily')!,
  weekly: document.getElementById('reportWeekly')!,
  monthly: document.getElementById('reportMonthly')!,
  recommend: document.getElementById('reportRecommend')!,
  settings: document.getElementById('reportSettings')!,
};

function isTabKey(v: string | undefined): v is TabKey {
  return v === 'daily' || v === 'weekly' || v === 'monthly' || v === 'recommend' || v === 'settings';
}

function activate(tab: TabKey) {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  (Object.keys(reports) as TabKey[]).forEach((k) => {
    reports[k].classList.toggle('active', k === tab);
  });

  const layout = document.getElementById('layout');
  const livePane = document.getElementById('livePane');
  if (layout) layout.classList.toggle('settings-mode', tab === 'settings');
  if (livePane) livePane.classList.toggle('hidden', tab === 'settings');

  window.dispatchEvent(new CustomEvent('fm:tab', { detail: tab }));
}

function initTabs() {
  // 클릭
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const key = btn.dataset.tab;
      if (!isTabKey(key)) return;
      activate(key);
      btn.focus();
    });
  });

  // 키보드 내비게이션 (좌/우)
  const tabsEl = document.querySelector('.tabs') as HTMLElement | null; // ★ HTMLElement로 캐스팅
  const order: TabKey[] = ['daily', 'weekly', 'monthly', 'recommend', 'settings'];

  tabsEl?.addEventListener('keydown', (e: Event) => { // ★ Event로 받고
    const ke = e as KeyboardEvent;                    //    내부에서 KeyboardEvent로 캐스팅
    const activeIdx = tabButtons.findIndex((b) => b.classList.contains('active'));

    if (ke.key === 'ArrowRight' || ke.key === 'ArrowLeft') {
      ke.preventDefault();
      let nextIdx = activeIdx;
      if (ke.key === 'ArrowRight') nextIdx = (activeIdx + 1) % tabButtons.length;
      if (ke.key === 'ArrowLeft')  nextIdx = (activeIdx - 1 + tabButtons.length) % tabButtons.length;

      const nextBtn = tabButtons[nextIdx];
      const nextKey = nextBtn?.dataset.tab;
      if (isTabKey(nextKey)) {
        activate(nextKey);
        nextBtn.focus();
      }
    }
  });

  // 초기 탭
  activate('daily');
}

initTabs();
export {};
