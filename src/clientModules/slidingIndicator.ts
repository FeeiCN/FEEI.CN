type IndicatorConfig = {
  container: string;
  links: string;
  id: string;
  axis: 'x' | 'y';
};

const CONFIGS: IndicatorConfig[] = [
  {
    container: '.theme-doc-sidebar-menu',
    links: '.menu__link',
    id: 'sliding-line-sidebar',
    axis: 'y',
  },
  {
    container: '.table-of-contents',
    links: '.table-of-contents__link',
    id: 'sliding-line-toc',
    axis: 'y',
  },
  {
    container: '.navbar__items:not(.navbar__items--right)',
    links: '.navbar__link',
    id: 'sliding-line-navbar',
    axis: 'x',
  },
];

const abortControllers = new Map<string, AbortController>();

function setup({container, links, id, axis}: IndicatorConfig) {
  const containerEl = document.querySelector<HTMLElement>(container);
  if (!containerEl) return;

  containerEl.style.position = 'relative';

  let ind = document.getElementById(id) as HTMLElement | null;
  if (!ind) {
    ind = document.createElement('span');
    ind.id = id;
    ind.className = 'sliding-line-indicator';
    ind.dataset.axis = axis;
    containerEl.appendChild(ind);
  }

  const indicator = ind;

  // Abort previous listeners without touching DOM nodes
  abortControllers.get(id)?.abort();
  const ac = new AbortController();
  abortControllers.set(id, ac);
  const {signal} = ac;

  function moveTo(el: HTMLElement) {
    const cRect = containerEl!.getBoundingClientRect();
    const lRect = el.getBoundingClientRect();
    const borderLeft = parseFloat(getComputedStyle(containerEl!).borderLeftWidth) || 0;
    const borderTop = parseFloat(getComputedStyle(containerEl!).borderTopWidth) || 0;

    if (axis === 'y') {
      const top = lRect.top - cRect.top - borderTop + containerEl!.scrollTop;
      const left = lRect.left - cRect.left - borderLeft;
      indicator.style.left = `${left}px`;
      indicator.style.transform = `translateY(${top}px)`;
      indicator.style.height = `${lRect.height}px`;
    } else {
      const left = lRect.left - cRect.left - borderLeft + containerEl!.scrollLeft;
      indicator.style.transform = `translateX(${left}px)`;
      indicator.style.width = `${lRect.width}px`;
    }

    indicator.style.opacity = '1';
  }

  function hideIndicator() {
    indicator.style.opacity = '0';
  }

  function handlePointerOver(event: Event) {
    if (!(event.target instanceof Element)) {
      hideIndicator();
      return;
    }

    const link = event.target.closest<HTMLElement>(links);

    if (link && containerEl!.contains(link)) {
      moveTo(link);
      return;
    }

    hideIndicator();
  }

  containerEl.addEventListener('pointerover', handlePointerOver, {signal});
  containerEl.addEventListener('focusin', handlePointerOver, {signal});
  containerEl.addEventListener('click', hideIndicator, {signal});
  containerEl.addEventListener('mouseleave', hideIndicator, {signal});
}

function init() {
  CONFIGS.forEach(setup);
}

export function onRouteDidUpdate(): void {
  setTimeout(init, 80);
}
