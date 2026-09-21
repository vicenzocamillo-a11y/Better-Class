/**
 * motion.js — micro engine de animação do Better Class.
 * Inspirado na API do anime.js, escrito do zero, sem dependências.
 *
 *   animate('.card', { translateY: [40, 0], opacity: [0, 1],
 *                      duration: 900, delay: stagger(60), easing: 'expo.out' })
 *
 * Tudo respeita `prefers-reduced-motion`: com movimento reduzido as
 * animações saltam direto para o estado final.
 */

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => REDUCE.matches || document.documentElement.dataset.motion === 'reduced';

/* ── Curvas ───────────────────────────────────────────────── */
const bezier = (x1, y1, x2, y2) => (t) => {
  // Newton-Raphson: resolve x(t) = alvo e devolve y
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
  const sampleDX = (u) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const x = sampleX(u) - t;
    if (Math.abs(x) < 1e-5) break;
    const d = sampleDX(u);
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  return ((ay * u + by) * u + cy) * u;
};

export const easings = {
  linear: (t) => t,
  'sine.out': (t) => Math.sin((t * Math.PI) / 2),
  'sine.inOut': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  'quad.out': (t) => 1 - (1 - t) ** 2,
  'cubic.out': (t) => 1 - (1 - t) ** 3,
  'quart.out': (t) => 1 - (1 - t) ** 4,
  'expo.out': (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  'expo.inOut': (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  'circ.out': (t) => Math.sqrt(1 - (t - 1) ** 2),
  'back.out': (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
  'elastic.out': (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1),
  /** Curva "macia" da Apple — usada como padrão em quase tudo. */
  apple: bezier(0.32, 0.72, 0, 1),
  appleIn: bezier(0.4, 0, 1, 1),
  appleInOut: bezier(0.65, 0, 0.35, 1),
  swift: bezier(0.16, 1, 0.3, 1),
};

/** Mola crítica amostrada — devolve uma função de easing. */
export function spring({ stiffness = 170, damping = 22, mass = 1 } = {}) {
  const steps = 240;
  const dt = 1 / 60;
  const samples = [];
  let position = 0, velocity = 0;
  for (let i = 0; i < steps; i++) {
    const force = -stiffness * (position - 1) - damping * velocity;
    velocity += (force / mass) * dt;
    position += velocity * dt;
    samples.push(position);
  }
  return (t) => {
    const index = Math.min(steps - 1, Math.floor(t * (steps - 1)));
    return samples[index];
  };
}

const resolveEasing = (easing) =>
  typeof easing === 'function' ? easing : easings[easing] || easings.apple;

/* ── Propriedades ─────────────────────────────────────────── */
const TRANSFORMS = {
  translateX: 'px', translateY: 'px', translateZ: 'px',
  rotate: 'deg', rotateX: 'deg', rotateY: 'deg', rotateZ: 'deg',
  scale: '', scaleX: '', scaleY: '', skewX: 'deg', skewY: 'deg',
};
const DEFAULTS = {
  translateX: 0, translateY: 0, translateZ: 0, rotate: 0, rotateX: 0, rotateY: 0, rotateZ: 0,
  scale: 1, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, opacity: 1, blur: 0,
};
const UNITS = { blur: 'px', width: 'px', height: 'px', borderRadius: 'px' };

function toElements(targets) {
  if (!targets) return [];
  if (typeof targets === 'string') return [...document.querySelectorAll(targets)];
  if (targets instanceof Element) return [targets];
  if (targets instanceof NodeList || Array.isArray(targets)) return [...targets];
  if (typeof targets === 'object') return [targets];   // objetos simples: tween de valores
  return [];
}

function currentValue(el, prop) {
  if (!(el instanceof Element)) return Number(el[prop]) || 0;
  const stash = el.__motion || (el.__motion = {});
  if (stash[prop] !== undefined) return stash[prop];
  if (prop === 'opacity') {
    const value = parseFloat(getComputedStyle(el).opacity);
    return Number.isNaN(value) ? 1 : value;
  }
  return DEFAULTS[prop] !== undefined ? DEFAULTS[prop] : 0;
}

function applyValues(el, values) {
  if (!(el instanceof Element)) { Object.assign(el, values); return; }
  const stash = el.__motion || (el.__motion = {});
  Object.assign(stash, values);
  const parts = [];
  for (const key of Object.keys(TRANSFORMS)) {
    if (stash[key] === undefined) continue;
    if (stash[key] === DEFAULTS[key]) continue;
    parts.push(`${key}(${stash[key]}${TRANSFORMS[key]})`);
  }
  el.style.transform = parts.length ? `translateZ(0) ${parts.join(' ')}` : '';
  if (stash.opacity !== undefined) el.style.opacity = String(stash.opacity);
  if (stash.blur !== undefined) el.style.filter = stash.blur > 0.01 ? `blur(${stash.blur}px)` : '';
  for (const [key, value] of Object.entries(stash)) {
    if (TRANSFORMS[key] || key === 'opacity' || key === 'blur') continue;
    if (key.startsWith('--')) el.style.setProperty(key, String(value));
    else el.style[key] = `${value}${UNITS[key] || ''}`;
  }
}

/* ── Loop global ──────────────────────────────────────────── */
const running = new Set();
let ticking = false;

function tick(now) {
  for (const animation of running) animation._tick(now);
  if (running.size) requestAnimationFrame(tick);
  else ticking = false;
}
function ensureTicking() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(tick);
}

class Animation {
  constructor(elements, params) {
    const {
      duration = 700, delay = 0, endDelay = 0, easing = 'apple',
      loop = false, direction = 'normal', autoplay = true, onUpdate, onComplete, ...props
    } = params;

    this.elements = elements;
    this.duration = reducedMotion() ? 0 : duration;
    this.easing = resolveEasing(easing);
    this.loop = loop;
    this.direction = direction;
    this.endDelay = endDelay;
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.startTime = null;
    this.done = false;

    this.tracks = elements.map((el, index) => {
      const tweens = [];
      for (const [prop, value] of Object.entries(props)) {
        const pair = Array.isArray(value) ? value : [currentValue(el, prop), value];
        const from = typeof pair[0] === 'function' ? pair[0](el, index) : pair[0];
        const to = typeof pair[1] === 'function' ? pair[1](el, index) : pair[1];
        tweens.push({ prop, from: Number(from), to: Number(to) });
      }
      const elDelay = typeof delay === 'function' ? delay(el, index, elements.length) : delay;
      return { el, tweens, delay: reducedMotion() ? 0 : elDelay };
    });

    this.total = Math.max(...this.tracks.map((t) => t.delay + this.duration), 0) + this.endDelay;
    this.finished = new Promise((resolve) => { this._resolve = resolve; });
    if (autoplay) this.play();
  }

  play() {
    if (this.done) return this;
    this.startTime = null;
    running.add(this);
    ensureTicking();
    return this;
  }

  pause() { running.delete(this); return this; }

  seek(progress) {
    for (const track of this.tracks) this._applyTrack(track, progress);
    return this;
  }

  _applyTrack(track, globalTime) {
    const local = Math.min(1, Math.max(0, this.duration === 0 ? 1 : (globalTime - track.delay) / this.duration));
    if (local < 0) return;
    const eased = this.easing(local);
    const values = {};
    for (const tween of track.tweens) values[tween.prop] = tween.from + (tween.to - tween.from) * eased;
    applyValues(track.el, values);
  }

  _tick(now) {
    if (this.startTime === null) this.startTime = now;
    const elapsed = now - this.startTime;
    for (const track of this.tracks) this._applyTrack(track, elapsed);
    this.onUpdate?.(Math.min(1, elapsed / (this.total || 1)));

    if (elapsed >= this.total) {
      if (this.loop) {
        this.startTime = now;
        if (this.direction === 'alternate') {
          for (const track of this.tracks) {
            for (const tween of track.tweens) { const t = tween.from; tween.from = tween.to; tween.to = t; }
          }
        }
        return;
      }
      running.delete(this);
      this.done = true;
      this.onComplete?.();
      this._resolve?.();
    }
  }
}

export function animate(targets, params = {}) {
  const elements = toElements(targets);
  if (!elements.length) {
    const noop = { finished: Promise.resolve(), play: () => noop, pause: () => noop, seek: () => noop };
    return noop;
  }
  return new Animation(elements, params);
}

/** Define valores sem animar (útil para o estado inicial). */
export function set(targets, values) {
  for (const el of toElements(targets)) applyValues(el, values);
}

/** Atraso escalonado, igual ao stagger do anime.js. */
export function stagger(step = 60, { start = 0, from = 'first', easing } = {}) {
  const curve = easing ? resolveEasing(easing) : null;
  return (el, index, length) => {
    let distance;
    if (from === 'center') distance = Math.abs(index - (length - 1) / 2);
    else if (from === 'last') distance = length - 1 - index;
    else if (typeof from === 'number') distance = Math.abs(index - from);
    else distance = index;
    const normalized = length > 1 ? distance / (length - 1) : 0;
    const factor = curve ? curve(normalized) * (length - 1) : distance;
    return start + step * factor;
  };
}

/** Linha do tempo encadeada. */
export function timeline(defaults = {}) {
  let cursor = 0;
  const queue = [];
  const api = {
    add(targets, params = {}, offset) {
      const at = offset === undefined ? cursor
        : typeof offset === 'string' && offset.startsWith('-=') ? cursor - parseFloat(offset.slice(2))
        : typeof offset === 'string' && offset.startsWith('+=') ? cursor + parseFloat(offset.slice(2))
        : Number(offset);
      const merged = { ...defaults, ...params };
      queue.push({ targets, params: merged, at: Math.max(0, at) });
      cursor = Math.max(cursor, at + (merged.duration ?? 700));
      return api;
    },
    play() {
      for (const item of queue) {
        const delay = item.params.delay;
        const shifted = typeof delay === 'function'
          ? (el, i, len) => item.at + delay(el, i, len)
          : item.at + (delay || 0);
        animate(item.targets, { ...item.params, delay: shifted });
      }
      return api;
    },
    get duration() { return cursor; },
  };
  return api;
}

/* ── Observadores ─────────────────────────────────────────── */
export function inView(targets, callback, { once = true, amount = 0.2, margin = '0px 0px -8% 0px' } = {}) {
  const elements = toElements(targets);
  if (!elements.length) return () => {};
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      callback(entry.target, entry);
      if (once) observer.unobserve(entry.target);
    }
  }, { threshold: amount, rootMargin: margin });
  elements.forEach((el) => observer.observe(el));
  return () => observer.disconnect();
}

/** Progresso 0→1 do elemento atravessando a viewport. */
export function onScrollProgress(el, callback, { start = 1, end = 0 } = {}) {
  let frame = 0;
  const update = () => {
    frame = 0;
    const rect = el.getBoundingClientRect();
    const height = window.innerHeight || 1;
    const raw = (height * start - rect.top) / (rect.height + height * (start - end));
    callback(Math.min(1, Math.max(0, raw)), rect);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
  return () => {
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
  };
}

/** Interpolação suave de um valor (usada em parallax e no cursor). */
export function damp(current, target, factor = 0.12) {
  return current + (target - current) * factor;
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
