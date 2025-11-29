// src/ui/theme.ts
type ThemeMode = "light" | "dark";

function initThemeToggle() {
  const el = document.getElementById("btnTheme");
  if (!(el instanceof HTMLButtonElement)) return;

  const btn = el;
  const body = document.body;

  const saved = window.localStorage.getItem("fm-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  let mode: ThemeMode =
    saved === "light" || saved === "dark"
      ? saved
      : prefersDark
      ? "dark"
      : "light";

  function applyTheme() {
    if (mode === "dark") {
      body.classList.add("theme-dark");
      btn.textContent = "라이트 모드";
    } else {
      body.classList.remove("theme-dark");
      btn.textContent = "다크 모드";
    }

    // 🔥🔥🔥 테마 변경 이벤트 발송
    window.dispatchEvent(new CustomEvent("fm:theme-change", { detail: mode }));
  }

  applyTheme();

  btn.addEventListener("click", () => {
    mode = mode === "dark" ? "light" : "dark";
    window.localStorage.setItem("fm-theme", mode);
    applyTheme();
  });
}

document.addEventListener("DOMContentLoaded", initThemeToggle);

export {};
