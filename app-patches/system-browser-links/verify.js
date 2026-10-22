const p = await browser.getPage('main');
console.log(await p.evaluate(() => {
  const checks = [];
  const assert = (condition, name) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const opened = [];
  const originalBridge = window.bbDesktop;
  window.bbDesktop = {openExternalUrl: url => opened.push(url)};
  const link = document.querySelector('a[href="https://testflight.apple.com/join/T9MayTMb"]');
  assert(!!link, 'real BB external link available');
  const nested = document.createElement('span');
  nested.textContent = '';
  link.append(nested);
  const click = (target, props) => {
    const event = new MouseEvent('click', {bubbles: true, cancelable: true, button: 0, ...props});
    target.dispatchEvent(event);
    return event;
  };
  const context = (target, x = 500, y = 350) => {
    const event = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y});
    target.dispatchEvent(event);
    return event;
  };
  try {
    assert(click(nested, {metaKey: true}).defaultPrevented && opened.length === 1 && opened[0] === link.href,
      'Command-click on nested link content opens desktop bridge exactly once');
    assert(click(link, {ctrlKey: true}).defaultPrevented && opened.length === 2,
      'Control-click opens desktop bridge exactly once');
    let normalClick = false;
    const stop = event => {normalClick = true; event.preventDefault(); event.stopPropagation();};
    link.addEventListener('click', stop, {once: true});
    click(link, {});
    assert(normalClick && opened.length === 2, 'ordinary click reaches existing handler');
    assert(context(nested).defaultPrevented, 'right-click intercepts external links');
    let menu = document.querySelector('[data-bb-system-browser-menu]');
    assert(menu?.querySelectorAll('[role=menuitem]').length === 2, 'menu offers system browser and copy');
    assert(document.activeElement === menu.firstElementChild, 'menu receives keyboard focus');
    menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true}));
    assert(document.activeElement === menu.lastElementChild, 'arrow navigation works');
    menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    assert(!document.querySelector('[data-bb-system-browser-menu]'), 'Escape dismisses menu');
    context(link);
    document.querySelector('[data-bb-system-browser-menu] [role=menuitem]').click();
    assert(opened.length === 3 && opened[2] === link.href, 'menu action opens same URL exactly once');
    assert(!document.querySelector('[data-bb-system-browser-menu]'), 'action dismisses menu');
    context(link, innerWidth - 1, innerHeight - 1);
    menu = document.querySelector('[data-bb-system-browser-menu]');
    const bounds = menu.getBoundingClientRect();
    assert(bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'menu stays within viewport');
    document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    assert(!document.querySelector('[data-bb-system-browser-menu]'), 'outside click dismisses menu');
    const fixture = document.createElement('a');
    document.body.append(fixture);
    try {
      for (const href of ['/settings', '#local', 'javascript:void(0)', 'file:///tmp/example', 'mailto:test@example.com']) {
        fixture.setAttribute('href', href);
        assert(!context(fixture).defaultPrevented && !document.querySelector('[data-bb-system-browser-menu]'),
          'preserves context menu for ' + href);
      }
      fixture.href = '/settings';
      fixture.addEventListener('click', stop, {once: true});
      click(fixture, {metaKey: true});
      assert(opened.length === 3, 'internal links never go to system browser');
    } finally { fixture.remove(); }
    link.focus();
    context(link);
    menu = document.querySelector('[data-bb-system-browser-menu]');
    menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    assert(document.activeElement === link, 'focus returns after dismissal');
    return checks;
  } finally {
    nested.remove();
    if (originalBridge === undefined) delete window.bbDesktop;
    else window.bbDesktop = originalBridge;
  }
}));
await p.click('a[href="https://testflight.apple.com/join/T9MayTMb"]', {button: 'right'});
console.log(await p.snapshot());
await p.shot({type: 'jpeg', maxEdge: 1200, quality: 80});
