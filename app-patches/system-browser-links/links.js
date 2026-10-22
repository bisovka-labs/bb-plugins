// BB system-browser-links: installed by system-browser-links.py.
(() => {
  let menu = null;
  let previousFocus = null;

  function linkAt(event) {
    const anchor = event.composedPath().find(node => node instanceof Element && node.matches('a[href]'));
    if (!anchor) return null;
    const href = anchor.getAttribute('href');
    if (!/^https?:\/\//i.test(href)) return null;
    try {
      const url = new URL(href);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function closeMenu(restoreFocus = false) {
    if (!menu) return;
    menu.remove();
    menu = null;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
    previousFocus = null;
  }

  function openExternal(url) {
    $8(url);
  }

  function showMenu(event, url) {
    closeMenu();
    previousFocus = document.activeElement;
    const anchor = event.composedPath().find(node => node instanceof Element && node.matches('a[href]'));
    menu = document.createElement('div');
    menu.dataset.bbSystemBrowserMenu = '';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Link actions');
    menu.className = 'min-w-28 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md';
    Object.assign(menu.style, {position: 'fixed', zIndex: '10000', maxWidth: 'calc(100vw - 16px)'});

    const addItem = (label, action) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.className = 'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-left text-xs outline-none focus:bg-state-hover focus:text-foreground';
      item.textContent = label;
      item.addEventListener('pointermove', () => item.focus({preventScroll: true}));
      item.addEventListener('click', () => {
        closeMenu(true);
        action();
      });
      menu.append(item);
    };
    addItem('Open in system browser', () => openExternal(url));
    addItem('Copy link', () => xH(url, {successMessage: 'Link copied', errorMessage: 'Failed to copy link'}));
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const items = [...menu.querySelectorAll('[role=menuitem]')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next].focus();
      }
    });
    document.body.append(menu);
    const bounds = anchor?.getBoundingClientRect();
    const x = event.clientX || bounds?.left || 8;
    const y = event.clientY || bounds?.bottom || 8;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.firstElementChild.focus({preventScroll: true});
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const url = linkAt(event);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeMenu();
    openExternal(url);
  }, true);

  document.addEventListener('contextmenu', event => {
    const url = linkAt(event);
    if (!url) {
      closeMenu();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    showMenu(event, url);
  }, true);

  document.addEventListener('pointerdown', event => {
    if (menu && !menu.contains(event.target)) closeMenu();
  }, true);
  window.addEventListener('blur', () => closeMenu());
  window.addEventListener('resize', () => closeMenu());
  document.addEventListener('scroll', event => {
    if (menu && !menu.contains(event.target)) closeMenu();
  }, true);
})();
