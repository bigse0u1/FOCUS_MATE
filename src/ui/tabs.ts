export function setupTabs(){
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab[data-tab]");
  const reports = document.querySelectorAll<HTMLElement>(".report");
  tabs.forEach(btn=>{
    btn.onclick = ()=>{
      tabs.forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      reports.forEach(r=>r.classList.remove("active"));
      const id = "#report" + capitalize(btn.dataset.tab!);
      document.querySelector<HTMLElement>(id)!.classList.add("active");
      window.dispatchEvent(new CustomEvent("fm:tab", {detail: btn.dataset.tab}));
    };
  });
}
function capitalize(s:string){return s.charAt(0).toUpperCase()+s.slice(1)}
