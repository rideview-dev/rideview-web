// ============================================================
// i18n engine — data-driven translations (see i18n.js)
//  - All visible copy lives in window.I18N keyed by dot-path.
//  - Elements opt in via data-i18n / data-i18n-html / data-i18n-attr.
//  - Header switcher changes the active language at runtime.
//  - No localStorage (sandboxed iframe) — language is held in a variable.
// ============================================================
(function () {
  const I18N = window.I18N || {};
  const LANGS = window.I18N_LANGS || [{ code: 'en', label: 'English', short: 'EN', dir: 'ltr' }];
  const DEFAULT = 'en';
  let current = DEFAULT;

  // Resolve a dot-path like "hero.title" against the active language,
  // falling back to English if a key is missing in a translation.
  function resolve(lang, key) {
    const get = (obj) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    let val = get(I18N[lang]);
    if (val == null && lang !== DEFAULT) val = get(I18N[DEFAULT]);
    return val;
  }

  function applyTo(el, lang) {
    // textContent
    const tKey = el.getAttribute('data-i18n');
    if (tKey) { const v = resolve(lang, tKey); if (v != null) el.textContent = v; }
    // innerHTML (copy with <br> or <span class="brand-text">)
    const hKey = el.getAttribute('data-i18n-html');
    if (hKey) { const v = resolve(lang, hKey); if (v != null) el.innerHTML = v; }
    // attributes: "placeholder:key;aria-label:key2"
    const aSpec = el.getAttribute('data-i18n-attr');
    if (aSpec) {
      aSpec.split(';').forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        const v = resolve(lang, key);
        if (attr && v != null) el.setAttribute(attr, v);
      });
    }
  }

  function setLanguage(lang) {
    if (!I18N[lang]) lang = DEFAULT;
    current = lang;
    const meta = LANGS.find((l) => l.code === lang) || LANGS[0];
    const dir = meta.dir || 'ltr';

    // Translate every tagged element.
    document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-attr]')
      .forEach((el) => applyTo(el, lang));

    // Document language + direction (RTL for Arabic).
    const html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', dir);

    // Update switcher label + selected option.
    const label = document.getElementById('langCurrent');
    if (label) label.textContent = meta.short;
    document.querySelectorAll('#langMenu [data-lang]').forEach((li) => {
      li.setAttribute('aria-selected', li.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
  }

  // Switcher: open/close dropdown, pick a language.
  (function wireSwitcher() {
    const btn = document.getElementById('langBtn');
    const menu = document.getElementById('langMenu');
    if (!btn || !menu) return;

    function open() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function toggle() { (menu.hidden ? open : close)(); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    menu.addEventListener('click', (e) => {
      const li = e.target.closest('[data-lang]');
      if (!li) return;
      setLanguage(li.getAttribute('data-lang'));
      close();
    });
    // Close on outside click or Escape.
    document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.lang-switcher')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  })();

  // Apply default language on load.
  setLanguage(DEFAULT);
  window.setLanguage = setLanguage; // expose for QA
  // Resolve a key in the active language (used by the partner form for its
  // status messages, so they follow the language switcher like everything else).
  window.translate = function (key) { return resolve(current, key); };
})();

// Theme toggle (defaults to dark — the brand mode)
(function () {
  const t = document.querySelector('[data-theme-toggle]');
  const r = document.documentElement;
  let d = r.getAttribute('data-theme') || 'dark';
  const sun = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  const moon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  function paint() { t.innerHTML = d === 'dark' ? sun : moon; t.setAttribute('aria-label', 'Switch to ' + (d === 'dark' ? 'light' : 'dark') + ' mode'); }
  if (t) { paint(); t.addEventListener('click', () => { d = d === 'dark' ? 'light' : 'dark'; r.setAttribute('data-theme', d); paint(); }); }
})();

// Sticky header shadow
(function () {
  const h = document.getElementById('header');
  const onScroll = () => h.classList.toggle('scrolled', window.scrollY > 20);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// Scroll reveal
(function () {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) { setTimeout(() => e.target.classList.add('in'), (i % 4) * 70); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  els.forEach(e => io.observe(e));
})();

// Scroll-spy: highlight the nav link for the section currently in view
(function () {
  const links = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
  if (!links.length || !('IntersectionObserver' in window)) return;

  // Map each nav link to its target section element.
  const map = new Map();
  links.forEach((link) => {
    const id = link.getAttribute('href').slice(1);
    const section = document.getElementById(id);
    if (section) map.set(section, link);
  });
  if (!map.size) return;

  const sections = Array.from(map.keys());
  const visible = new Map(); // section -> intersectionRatio

  function setActive(link) {
    links.forEach((l) => {
      const on = l === link;
      l.classList.toggle('active', on);
      if (on) l.setAttribute('aria-current', 'true');
      else l.removeAttribute('aria-current');
    });
  }

  function update() {
    let best = null;
    let bestRatio = 0;
    visible.forEach((ratio, section) => {
      if (ratio > bestRatio) { bestRatio = ratio; best = section; }
    });
    if (best) {
      setActive(map.get(best));
    } else {
      // Nothing tracked is intersecting — pick the last section scrolled past.
      const mid = window.scrollY + window.innerHeight * 0.35;
      let current = null;
      sections.forEach((s) => { if (s.offsetTop <= mid) current = s; });
      setActive(current ? map.get(current) : null);
    }
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) visible.set(e.target, e.intersectionRatio);
      else visible.delete(e.target);
    });
    update();
  }, {
    // Active band sits just below the sticky header so a section becomes
    // active once its top scrolls up to roughly the upper third of the viewport.
    rootMargin: '-20% 0px -70% 0px',
    threshold: [0, 0.05, 0.15, 0.3, 0.6, 1]
  });

  sections.forEach((s) => io.observe(s));
  window.addEventListener('scroll', update, { passive: true });
  update();
})();

// Partner form -> our own backend (see /server/server.js)
(function () {
  const form = document.getElementById('partnerForm');
  const msg = document.getElementById('formMsg');
  if (!form || !msg) return;

  // API base URL. Resolved in this order:
  //   1. The <meta name="rideview-api"> tag in index.html, if it has a value.
  //      This is the one place to edit when the static files are hosted apart
  //      from the backend (e.g. static on cPanel, API on Render).
  //   2. If the deploy step substituted a real origin for the placeholder, use it.
  //   3. Otherwise use the SAME ORIGIN the page was served from. This is the
  //      normal production setup: server/server.js serves this site and the API
  //      together, so '' resolves to '/api/contact' on whatever host you deploy to.
  //      Same-origin also means no CORS and no mixed-content blocking.
  //   4. Only fall back to localhost:8000 when the page is clearly NOT being
  //      served by the API — opened from disk, or from a static dev server.
  const RAW = '__PORT_8000__';
  const META = (document.querySelector('meta[name="rideview-api"]') || {}).content || '';
  const API = (function () {
    if (META.trim()) return META.trim().replace(/\/+$/, '');
    if (!RAW.startsWith('__')) return RAW.replace(/\/+$/, '');
    var loc = window.location;
    if (loc.protocol === 'file:') return 'http://localhost:8000';
    var isLocalHost = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
    // Ports commonly used by static dev servers (Live Server, Vite, http.server…).
    var STATIC_DEV_PORTS = ['3000', '4173', '5000', '5173', '5500', '8080'];
    if (isLocalHost && STATIC_DEV_PORTS.indexOf(loc.port) !== -1) {
      return 'http://' + loc.hostname + ':8000';
    }
    return ''; // same origin
  })();

  // Cold-start warm-up. When the API is on a separate origin it may be hosted on
  // a platform that sleeps after a period of inactivity, where the first request
  // pays a 30–60s wake-up. Left alone, that delay lands on the visitor's
  // submission — the worst possible moment, and long enough that people give up.
  // So we nudge /api/health early instead: once after the page has settled (the
  // instance wakes while they read), and again the first time someone touches
  // the form, which covers visitors who browse for a while before getting in
  // touch. Fire-and-forget — a failure here is irrelevant and ignored.
  // Skipped entirely when API is same-origin, since the server is already awake.
  if (API) {
    var lastWarm = 0;
    var warm = function () {
      var now = Date.now();
      if (now - lastWarm < 60000) return; // at most once a minute
      lastWarm = now;
      try {
        fetch(API + '/api/health', { method: 'GET', cache: 'no-store' }).catch(function () {});
      } catch (e) { /* ignore */ }
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(warm, { timeout: 3000 });
    } else {
      setTimeout(warm, 1200);
    }
    form.addEventListener('focusin', warm);
    form.addEventListener('pointerdown', warm);
  }

  // Status messages are shown by translation key so that (a) a stale error can
  // never survive into a later success, and (b) the message follows the language
  // switcher. Errors sent by the server have no key, so they clear the attribute.
  function showKeyed(key, isError) {
    msg.setAttribute('data-i18n', key);
    var text = window.translate ? window.translate(key) : null;
    if (text != null) msg.textContent = text;
    msg.classList.toggle('is-error', !!isError);
    msg.hidden = false;
  }
  function showRaw(text) {
    msg.removeAttribute('data-i18n');
    msg.textContent = text;
    msg.classList.add('is-error');
    msg.hidden = false;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    const data = {
      name: form.name.value,
      email: form.email.value,
      company: form.company.value,
      // So the confirmation email reaches the visitor in the language they
      // actually read the site in. The server validates this against its own
      // list and falls back to English.
      lang: document.documentElement.getAttribute('lang') || 'en',
      _gotcha: form._gotcha.value
    };
    btn.disabled = true;
    btn.textContent = window.translate ? (window.translate('cta.sending') || 'Sending…') : 'Sending…';
    msg.hidden = true;
    try {
      const res = await fetch(API + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        form.reset();
        showKeyed('cta.success', false);
      } else {
        const err = new Error(body.error || '');
        err.fromServer = Boolean(body.error);
        throw err;
      }
    } catch (err) {
      // A message from the server (validation, rate limit) is shown as-is;
      // anything else — network failure, CORS, server down — gets the generic
      // localized fallback pointing at our inbox.
      if (err && err.fromServer && err.message) showRaw(err.message);
      else showKeyed('cta.error', true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
})();

// Year
document.getElementById('year').textContent = new Date().getFullYear();
