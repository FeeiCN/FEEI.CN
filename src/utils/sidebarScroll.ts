export function revealSidebarItem(menu: HTMLElement | null): void {
  const current = menu?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!current || !current.getBoundingClientRect().width) return;
  let scroller = menu?.parentElement;
  while (scroller && scroller !== document.body) {
    if (/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight) {
      const item = current.getBoundingClientRect();
      const panel = scroller.getBoundingClientRect();
      if (item.top < panel.top + 12) scroller.scrollTop += item.top - panel.top - 12;
      else if (item.bottom > panel.bottom - 12) scroller.scrollTop += item.bottom - panel.bottom + 12;
      return;
    }
    scroller = scroller.parentElement;
  }
}
