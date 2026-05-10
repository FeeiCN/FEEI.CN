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

  function moveTo(el: HTMLElement) {
    const cRect = containerEl!.getBoundingClientRect();
    const lRect = el.getBoundingClientRect();
    // Absolute positioning is relative to the padding edge, not the border edge.
    // Subtract borderLeftWidth/borderTopWidth to compensate.
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

  // Re-bind listeners (remove old ones via clone swap)
  const linkEls = Array.from(containerEl.querySelectorAll<HTMLElement>(links));
  linkEls.forEach(link => {
    const fresh = link.cloneNode(true) as HTMLElement;
    link.parentNode?.replaceChild(fresh, link);
  });

  containerEl.querySelectorAll<HTMLElement>(links).forEach(link => {
    link.addEventListener('mouseenter', () => moveTo(link));
  });

  containerEl.addEventListener('mouseleave', () => {
    indicator.style.opacity = '0';
  });
}

function init() {
  CONFIGS.forEach(setup);
}

export function onRouteDidUpdate(): void {
  setTimeout(init, 80);
}
