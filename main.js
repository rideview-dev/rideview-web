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

  // API base URL.
  //  - Preview/sandbox: the placeholder below is swapped for the proxy path at deploy time.
  //  - Local dev: falls back to http://localhost:8000.
  //  - Production: your team replaces this with your real API origin, e.g. 'https://api.rideview.ca'.
  const RAW = '__PORT_8000__';
  const API = RAW.startsWith('__') ? 'http://localhost:8000' : RAW;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    const data = {
      name: form.name.value,
      email: form.email.value,
      company: form.company.value,
      _gotcha: form._gotcha.value
    };
    btn.disabled = true;
    btn.textContent = 'Sending…';
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
        msg.hidden = false;
        msg.style.color = '';
      } else {
        throw new Error(body.error || 'Submission failed');
      }
    } catch (err) {
      msg.hidden = false;
      msg.style.color = '#e9576b';
      msg.textContent = (err && err.message && err.message !== 'Submission failed')
        ? err.message
        : 'Something went wrong. Please email us directly at support@rideview.ca.';
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
})();

// Year
document.getElementById('year').textContent = new Date().getFullYear();
