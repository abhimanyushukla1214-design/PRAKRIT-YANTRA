/* [PRODUCT NAME] — Flagship Launch · vanilla JS, no build step */

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const els = {
    productHero: document.getElementById('productHero'),
    productSeq: document.getElementById('productSeq'),
    productDay: document.getElementById('productDay'),
    displayHero: document.getElementById('displayHero'),
    displaySeq: document.getElementById('displaySeq'),
    displayDay: document.getElementById('displayDay'),
    tickHero: document.getElementById('tickHero'),
    tickSeq: document.getElementById('tickSeq'),
    tickDay: document.getElementById('tickDay'),
    stageGlow: document.getElementById('stageGlow'),
    heroGlow: document.getElementById('heroGlow'),
    heroNum: document.getElementById('heroNum'),
    heroCopy: document.querySelector('.hero-copy'),
    heroCta: document.querySelector('.hero-cta'),
    seq: document.getElementById('sequence'),
    day: document.getElementById('day'),
    clockBig: document.getElementById('clockBig'),
    phoneTime: document.getElementById('phoneTime'),
    phoneTemp: document.getElementById('phoneTemp'),
    notifs: Array.from(document.querySelectorAll('.notif')),
    savingsNum: document.getElementById('savingsNum'),
    liveTotal: document.getElementById('liveTotal'),
    options: Array.from(document.querySelectorAll('[data-opt]')),
    optsWrap: document.getElementById('options'),
    finishes: Array.from(document.querySelectorAll('.finish')),
    closeup: document.getElementById('closeup'),
    footerName: document.getElementById('footerName'),
  };

  const productWrap = (id) => document.getElementById(id);

  function setTransform(el, transform) {
    if (el) el.style.transform = transform;
  }

  /* ---------- product: one object, three instances, same render ---------- */
  const poses = [
    { name: 'A · stock', transform: 'rotateY(-14deg) rotateX(6deg) translateZ(0px)' },
    { name: 'B · wake', transform: 'rotateY(-30deg) rotateX(10deg) translateZ(26px)' },
    { name: 'C · heat', transform: 'rotateY(-48deg) rotateX(14deg) translateZ(52px)' },
    { name: 'D · field', transform: 'rotateY(-72deg) rotateX(18deg) translateZ(78px)' },
  ];

  function run() {
    /* ---- hero: product spins in, face wakes ---- */
    const hero = els.productHero;
    if (hero) {
      hero.style.transform = 'rotateY(-16deg) rotateX(8deg) translateZ(10px)';
      const d = els.displayHero;
      const t = els.tickHero;
      if (d) { d.style.opacity = '0'; }
      if (t) { t.style.opacity = '0'; }
      const to = setTimeout(() => {
        if (d) { d.style.opacity = '1'; }
        if (t) { t.style.opacity = '1'; }
      }, 1200);
      return () => clearTimeout(to);
    }
    return null;
  }

  /* ---------- pinned sequence ---------- */
  function initSequence() {
    const sec = els.seq;
    if (!sec) return;
    const stage = document.getElementById('stage');
    const product = document.getElementById('productSeq');
    const glow = document.getElementById('stageGlow');
    if (!stage || !product || !glow) return;

    const specs = [
      { id: 'specA', at: 0.12, top: '6%', left: '-4%' },
      { id: 'specB', at: 0.34, top: '42%', left: '-12%' },
      { id: 'specC', at: 0.55, top: '74%', left: '2%' },
      { id: 'specD', at: 0.76, top: '40%', right: '-8%' },
    ];
    const leaders = {
      specA: document.getElementById('leaderA'),
      specB: document.getElementById('leaderB'),
      specC: document.getElementById('leaderC'),
    };

    const apply = (p) => {
      const idx = Math.min(3, Math.floor(p * 4));
      const pose = poses[idx];
      setTransform(product, pose.transform);
      glow.style.background = p > 0.62 ? '#FF6A2B' : '#6BB7FF';
      glow.style.opacity = String(0.35 + 0.25 * p);
      specs.forEach((s) => {
        const el = document.getElementById(s.id);
        const show = p >= s.at - 0.02;
        if (el) { el.classList.toggle('is-in', show); }
      });
      Object.entries(leaders).forEach(([key, node]) => { if (node) node.style.opacity = String(clamp01((p - 0.06) / 0.12)); });
    };

    const onScroll = () => {
      const r = sec.getBoundingClientRect();
      const total = sec.offsetHeight - window.innerHeight;
      const p = total > 0 ? clamp01(-r.top / total) : 0;
      apply(p);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }

  /* ---------- pinned day ---------- */
  function initDay() {
    const sec = els.day;
    if (!sec) return;
    const clock = els.clockBig;
    const display = els.displayDay;
    const tick = els.tickDay;
    const dot = document.getElementById('tempDot');
    const path = document.getElementById('tempPath');
    if (!clock || !display) return;

    const onScroll = () => {
      const r = sec.getBoundingClientRect();
      const total = sec.offsetHeight - window.innerHeight;
      const p = total > 0 ? clamp01(-r.top / total) : 0;
      const hour = Math.round(p * 23.99);
      const hh = String(Math.floor(hour / 2)).padStart(2, '0');
      const mm = String((hour % 2) * 30).padStart(2, '0');
      clock.textContent = `${hh}:${mm}`;
      if (display) { display.style.transform = `translate(-50%, -50%) rotateX(${6 + p * 10}deg) scale(${1 + p * 0.08})`; }
      if (tick) { tick.style.opacity = String(0.35 + 0.65 * p); }
      if (dot && path) { dot.setAttribute('cx', String(20 + p * 580)); dot.setAttribute('cy', String(160 - p * 140)); }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }

  /* ---------- count-ups / live total / phone time ---------- */
  function animateCount(el, target, duration = 1600) {
    if (reduceMotion) { el.textContent = String(target); return; }
    const t0 = performance.now();
    const tickFn = (t) => {
      const p = clamp01((t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tickFn);
    };
    requestAnimationFrame(tickFn);
  }

  function initSavings() {
    const el = els.savingsNum;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          animateCount(el, 92);
          io.disconnect();
        }
      });
    }, { threshold: 0.4 });
    io.observe(el);
  }

  function initPreorder() {
    const live = els.liveTotal;
    const opts = els.options;
    const update = () => {
      const base = Number(opts.find((o) => o.dataset.opt === 'base')?.checked) || 0;
      const extras = opts.filter((o) => o.checked).map((o) => Number((o.dataset.opt === 'base' ? 0 : o.dataset.opt === 'ice' ? 100 : o.dataset.opt === 'ember' ? 150 : 80) || 0));
      if (live) live.textContent = `₹${(base + (extras.length ? extras.reduce((a, b) => a + b, 0) : 0)).toLocaleString('en-IN')}`;
    };
    opts.forEach((o) => o.addEventListener('change', update));
    update();
  }

  function initPhoneTime() {
    const t = els.phoneTime;
    const tp = els.phoneTemp;
    if (!t) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const start = Date.now();
          const end = start + 9000;
          const tickFn = (now) => {
            const p = clamp01((now - start) / (end - start));
            t.textContent = String(Math.round(9 * 60 + p * 60));
            if (tp) tp.textContent = String(Math.round(22 + p * 6));
            if (p < 1) requestAnimationFrame(tickFn);
          };
          requestAnimationFrame(tickFn);
          io.disconnect();
        }
      });
    }, { threshold: 0.3 });
    io.observe(t);
  }

  function initFinishes() {
    const finishes = els.finishes;
    finishes.forEach((f) => {
      f.addEventListener('click', () => {
        finishes.forEach((x) => x.classList.remove('active'));
        f.classList.add('active');
        const col = f.getAttribute('data-f');
        const ring = document.querySelectorAll('.ring');
        ring.forEach((r) => {
          r.style.background = `radial-gradient(circle at 32% 28%, ${col === 'ice' ? '#cfe8ff' : col === 'ember' ? '#ffb59a' : '#d3d6da'} 0%, ${col === 'ice' ? '#6BB7FF' : col === 'ember' ? '#FF6A2B' : '#A8ACB1'} 34%, #6f7378 62%, #3a3d41 88%, #222428 100%)`;
        });
      });
    });
  }

  /* ---------- reveals ---------- */
  function initReveals() {
    const lines = Array.from(document.querySelectorAll('.reveal-line'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.25 });
    lines.forEach((l) => io.observe(l));
  }

  /* ---------- init ---------- */
  function init() {
    const cleanupSeq = initSequence();
    const cleanupDay = initDay();
    initSavings();
    initPreorder();
    initPhoneTime();
    initFinishes();
    initReveals();

    // hero product float
    const hero = els.productHero;
    if (hero && !reduceMotion) {
      let raf = null;
      const loop = () => {
        hero.style.transform = 'rotateY(-16deg) rotateX(8deg) translateZ(10px) translateY(' + Math.sin(performance.now() / 1400) * 12 + 'px)';
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => { cancelAnimationFrame(raf); if (cleanupSeq) cleanupSeq(); if (cleanupDay) cleanupDay(); };
    }
    if (cleanupSeq) cleanupSeq();
    if (cleanupDay) cleanupDay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
