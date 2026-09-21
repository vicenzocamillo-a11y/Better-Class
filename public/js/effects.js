/**
 * effects.js — biblioteca de efeitos do Better Class.
 * Inspirada nos componentes do ReactBits (SplitText, BlurText, CountUp,
 * Magnet, SpotlightCard, TiltedCard, Aurora, Particles), reescrita em
 * JavaScript puro sobre o motion.js.
 */
import { animate, set, stagger, inView, onScrollProgress, damp, reducedMotion, spring } from './motion.js';

/* ── Texto ────────────────────────────────────────────────── */

/** Quebra o texto em <span> por caractere ou palavra, preservando espaços. */
export function splitText(el, { by = 'chars' } = {}) {
  if (el.dataset.split) return [...el.querySelectorAll('.split-unit')];
  const source = el.textContent;
  el.dataset.split = by;
  el.textContent = '';
  el.setAttribute('aria-label', source);

  const units = [];
  const words = source.split(/(\s+)/);
  for (const word of words) {
    if (/^\s+$/.test(word)) { el.appendChild(document.createTextNode(word)); continue; }
    const wordEl = document.createElement('span');
    wordEl.className = 'split-word';
    wordEl.setAttribute('aria-hidden', 'true');
    if (by === 'words') {
      wordEl.classList.add('split-unit');
      wordEl.textContent = word;
      units.push(wordEl);
    } else {
      for (const char of word) {
        const charEl = document.createElement('span');
        charEl.className = 'split-unit';
        charEl.textContent = char;
        wordEl.appendChild(charEl);
        units.push(charEl);
      }
    }
    el.appendChild(wordEl);
  }
  return units;
}

/** Entrada cinematográfica de título: desfoque + subida, letra a letra. */
export function revealText(el, { by = 'chars', delay = 0, step = 26, duration = 1100 } = {}) {
  const units = splitText(el, { by });
  set(units, { opacity: 0, translateY: by === 'chars' ? 28 : 40, blur: 12, rotateX: -35 });
  el.style.opacity = '1';
  return animate(units, {
    opacity: [0, 1], translateY: 0, blur: 0, rotateX: 0,
    duration, delay: stagger(step, { start: delay }), easing: 'swift',
  });
}

/** Números que sobem — CountUp. */
export function countUp(el, to, { duration = 1400, decimals = 0, suffix = '', prefix = '' } = {}) {
  const from = Number(el.dataset.countFrom || 0);
  const target = Number(to);
  if (reducedMotion()) { el.textContent = `${prefix}${target.toFixed(decimals)}${suffix}`; return; }
  const state = { value: from };
  animate(state, {
    value: [from, target], duration, easing: 'expo.out',
    onUpdate: () => {
      el.textContent = `${prefix}${state.value.toFixed(decimals).replace('.', ',')}${suffix}`;
    },
    onComplete: () => { el.textContent = `${prefix}${target.toFixed(decimals).replace('.', ',')}${suffix}`; },
  });
}

/** Máquina de escrever com cursor. */
export function typewriter(el, phrases, { speed = 55, hold = 1800 } = {}) {
  if (reducedMotion()) { el.textContent = phrases[0]; return () => {}; }
  let phrase = 0, char = 0, deleting = false, timer;
  const step = () => {
    const current = phrases[phrase % phrases.length];
    char += deleting ? -1 : 1;
    el.textContent = current.slice(0, char);
    let next = deleting ? speed / 2 : speed;
    if (!deleting && char === current.length) { deleting = true; next = hold; }
    else if (deleting && char === 0) { deleting = false; phrase++; next = 320; }
    timer = setTimeout(step, next);
  };
  step();
  return () => clearTimeout(timer);
}

/* ── Interação ────────────────────────────────────────────── */

/** Botão magnético que persegue suavemente o cursor. */
export function magnetic(el, { strength = 0.32, radius = 110 } = {}) {
  if (reducedMotion() || matchMedia('(pointer: coarse)').matches) return () => {};
  let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0, active = false;

  const loop = () => {
    cx = damp(cx, tx, 0.16);
    cy = damp(cy, ty, 0.16);
    el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
    if (Math.abs(cx - tx) > 0.1 || Math.abs(cy - ty) > 0.1 || active) raf = requestAnimationFrame(loop);
    else { raf = 0; el.style.transform = ''; }
  };
  const move = (event) => {
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    active = distance < rect.width / 2 + radius;
    tx = active ? dx * strength : 0;
    ty = active ? dy * strength : 0;
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const leave = () => { active = false; tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop); };

  window.addEventListener('pointermove', move, { passive: true });
  el.addEventListener('pointerleave', leave);
  return () => { window.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
}

/** Cartão com holofote que segue o ponteiro (SpotlightCard). */
export function spotlight(el) {
  const move = (event) => {
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`);
  };
  el.addEventListener('pointermove', move, { passive: true });
  el.classList.add('has-spotlight');
  return () => el.removeEventListener('pointermove', move);
}

/** Inclinação 3D com brilho (TiltedCard). */
export function tilt(el, { max = 9, scale = 1.02, perspective = 900 } = {}) {
  if (reducedMotion() || matchMedia('(pointer: coarse)').matches) return () => {};
  const inner = el.querySelector('[data-tilt-inner]') || el;
  const move = (event) => {
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    inner.style.transform =
      `perspective(${perspective}px) rotateY(${px * max}deg) rotateX(${-py * max}deg) scale(${scale})`;
    el.style.setProperty('--glare-x', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--glare-y', `${(py + 0.5) * 100}%`);
  };
  const reset = () => {
    inner.style.transition = 'transform .7s cubic-bezier(.32,.72,0,1)';
    inner.style.transform = '';
    setTimeout(() => { inner.style.transition = ''; }, 700);
  };
  el.addEventListener('pointermove', move, { passive: true });
  el.addEventListener('pointerleave', reset);
  return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', reset); };
}

/** Onda ao clicar (material-ish, mas discreta como no iOS). */
export function ripple(el) {
  el.addEventListener('pointerdown', (event) => {
    if (reducedMotion()) return;
    const rect = el.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ripple-dot';
    dot.style.left = `${event.clientX - rect.left}px`;
    dot.style.top = `${event.clientY - rect.top}px`;
    el.appendChild(dot);
    animate(dot, {
      scale: [0, 2.6], opacity: [0.35, 0], duration: 620, easing: 'expo.out',
      onComplete: () => dot.remove(),
    });
  });
}

/* ── Cenário ──────────────────────────────────────────────── */

/** Fundo aurora: blobs que respiram devagar (canvas leve). */
export function aurora(canvas, { colors = ['#5b8cff', '#a86bff', '#ff6b9d', '#3ddad7'], blobs = 4, speed = 0.00012 } = {}) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, raf = 0;
  const seeds = Array.from({ length: blobs }, (_, i) => ({
    color: colors[i % colors.length],
    ax: Math.random() * 2 + 1, ay: Math.random() * 2 + 1,
    px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2,
    r: 0.3 + Math.random() * 0.25,
  }));

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.offsetWidth; height = canvas.offsetHeight;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = (time) => {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    for (const blob of seeds) {
      const x = width * (0.5 + 0.34 * Math.sin(time * speed * blob.ax + blob.px));
      const y = height * (0.5 + 0.30 * Math.cos(time * speed * blob.ay + blob.py));
      const radius = Math.min(width, height) * blob.r;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `${blob.color}66`);
      gradient.addColorStop(0.55, `${blob.color}1c`);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener('resize', resize);
  if (reducedMotion()) draw(0);
  else raf = requestAnimationFrame(draw);

  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
}

/** Poeira estelar: pontos que flutuam e reagem ao ponteiro. */
export function particles(canvas, { count = 70, color = '255,255,255' } = {}) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, raf = 0;
  const pointer = { x: -999, y: -999 };
  const dots = [];

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.offsetWidth; height = canvas.offsetHeight;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dots.length = 0;
    const total = Math.round(count * Math.min(1.4, width / 1200 + 0.4));
    for (let i = 0; i < total; i++) {
      dots.push({
        x: Math.random() * width, y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.14, vy: (Math.random() - 0.5) * 0.14,
        r: Math.random() * 1.5 + 0.35, a: Math.random() * 0.4 + 0.12,
      });
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    for (const dot of dots) {
      dot.x += dot.vx; dot.y += dot.vy;
      if (dot.x < -10) dot.x = width + 10; if (dot.x > width + 10) dot.x = -10;
      if (dot.y < -10) dot.y = height + 10; if (dot.y > height + 10) dot.y = -10;

      const dx = dot.x - pointer.x, dy = dot.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      let alpha = dot.a;
      if (distance < 130) {
        alpha = Math.min(0.9, dot.a + (1 - distance / 130) * 0.6);
        dot.x += (dx / distance) * 0.22;
        dot.y += (dy / distance) * 0.22;
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${color},${alpha})`;
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  };

  const move = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
  };

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', move, { passive: true });
  if (reducedMotion()) draw();
  else raf = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', move);
  };
}

/** Visualizador de áudio em barras (usado na gravação). */
export function audioBars(canvas, getLevels, { bars = 48, color = '#6ea8ff' } = {}) {
  const ctx = canvas.getContext('2d');
  let raf = 0, width = 0, height = 0;
  const smooth = new Array(bars).fill(0);

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.offsetWidth; height = canvas.offsetHeight;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = () => {
    const data = getLevels() || [];
    ctx.clearRect(0, 0, width, height);
    const gap = 3;
    const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
    for (let i = 0; i < bars; i++) {
      const sample = data.length ? data[Math.floor((i / bars) * data.length)] / 255 : 0;
      smooth[i] = smooth[i] * 0.72 + sample * 0.28;
      const barHeight = Math.max(2, smooth[i] * height * 0.92);
      const x = i * (barWidth + gap);
      const y = (height - barHeight) / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35 + smooth[i] * 0.65;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
}

/* ── Automações de página ─────────────────────────────────── */

/** Tudo com [data-reveal] entra em cena ao aparecer no ecrã. */
export function scrollReveal(root = document) {
  const items = [...root.querySelectorAll('[data-reveal]')];
  for (const item of items) {
    const kind = item.dataset.reveal || 'up';
    const from = {
      up: { translateY: 34, opacity: 0, blur: 6 },
      down: { translateY: -30, opacity: 0, blur: 6 },
      left: { translateX: -40, opacity: 0, blur: 6 },
      right: { translateX: 40, opacity: 0, blur: 6 },
      scale: { scale: 0.94, opacity: 0, blur: 8 },
      fade: { opacity: 0 },
    }[kind] || { translateY: 34, opacity: 0 };
    set(item, from);
  }
  inView(items, (el) => {
    const children = el.dataset.revealChildren ? [...el.children] : [el];
    if (el.dataset.revealChildren) {
      set(el, { opacity: 1, translateY: 0, translateX: 0, blur: 0, scale: 1 });
      set(children, { opacity: 0, translateY: 24, blur: 5 });
    }
    animate(children, {
      opacity: 1, translateY: 0, translateX: 0, blur: 0, scale: 1,
      duration: Number(el.dataset.revealDuration || 900),
      delay: stagger(Number(el.dataset.revealStagger || 70), { start: Number(el.dataset.revealDelay || 0) }),
      easing: 'swift',
    });
  }, { amount: 0.15 });
}

/** Parallax suave para [data-parallax="0.2"]. */
export function parallax(root = document) {
  if (reducedMotion()) return;
  for (const el of root.querySelectorAll('[data-parallax]')) {
    const depth = Number(el.dataset.parallax) || 0.15;
    onScrollProgress(el, (progress) => {
      el.style.setProperty('--parallax', `${(progress - 0.5) * depth * 220}px`);
    });
  }
}

/** Holofote que acompanha o cursor no fundo da página. */
export function cursorGlow() {
  if (reducedMotion() || matchMedia('(pointer: coarse)').matches) return;
  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  document.body.appendChild(glow);
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, raf = 0;
  const loop = () => {
    x = damp(x, tx, 0.1); y = damp(y, ty, 0.1);
    glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    raf = requestAnimationFrame(loop);
  };
  window.addEventListener('pointermove', (event) => { tx = event.clientX; ty = event.clientY; }, { passive: true });
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

/** Aplica os efeitos declarativos de uma vez só. */

/* ══════════════════════════════════════════════════════════
   Componentes no espírito do ReactBits e do anime.js
   ══════════════════════════════════════════════════════════ */

/**
 * Grade de pontos que ondula a partir do ponteiro e de pulsos.
 * É a assinatura visual do anime.js: stagger em grade a partir de um ponto.
 */
export function dotGrid(canvas, { gap = 26, color = '140,160,255', pulseOnLoad = true } = {}) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, raf = 0, cols = 0, rows = 0;
  const pointer = { x: -9999, y: -9999 };
  const pulses = [];

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.offsetWidth; height = canvas.offsetHeight;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(width / gap) + 1; rows = Math.ceil(height / gap) + 1;
  };

  const pulse = (x, y) => { pulses.push({ x, y, t: performance.now() }); if (pulses.length > 6) pulses.shift(); };

  const draw = (now) => {
    ctx.clearRect(0, 0, width, height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * gap, y = r * gap;
        let boost = 0;
        const dp = Math.hypot(x - pointer.x, y - pointer.y);
        if (dp < 160) boost += (1 - dp / 160) * 0.9;
        for (const p of pulses) {
          const age = (now - p.t) / 1000;
          if (age > 2.2) continue;
          const ring = age * 520;
          const d = Math.abs(Math.hypot(x - p.x, y - p.y) - ring);
          if (d < 90) boost += (1 - d / 90) * (1 - age / 2.2) * 1.1;
        }
        boost = Math.min(1.2, boost);
        const alpha = 0.16 + boost * 0.7;
        const radius = 1 + boost * 2.2;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${color},${alpha})`;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = pulses.length - 1; i >= 0; i--) if (now - pulses[i].t > 2200) pulses.splice(i, 1);
    raf = requestAnimationFrame(draw);
  };

  const move = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top;
  };
  const click = (event) => {
    const rect = canvas.getBoundingClientRect();
    pulse(event.clientX - rect.left, event.clientY - rect.top);
  };

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerdown', click, { passive: true });
  if (reducedMotion()) { draw(performance.now()); cancelAnimationFrame(raf); }
  else {
    raf = requestAnimationFrame(draw);
    if (pulseOnLoad) setTimeout(() => pulse(width * 0.32, height * 0.45), 500);
  }
  return { pulse, stop: () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', click); } };
}

/** RotatingText: troca palavras com as letras girando na vertical. */
export function rotatingText(el, words, { interval = 2600, step = 28 } = {}) {
  if (!el || !words.length) return () => {};
  el.classList.add('rotating-text');
  el.setAttribute('aria-live', 'polite');
  let index = 0, timer;

  const render = (word) => {
    el.textContent = '';
    for (const char of word) {
      const span = document.createElement('span');
      span.className = 'rotating-char';
      span.textContent = char === ' ' ? ' ' : char;
      el.appendChild(span);
    }
    return [...el.children];
  };

  let chars = render(words[0]);
  if (reducedMotion()) return () => {};

  const cycle = async () => {
    await animate(chars, {
      translateY: [0, -34], opacity: [1, 0], rotateX: [0, 40],
      duration: 380, delay: stagger(step), easing: 'appleIn',
    }).finished;
    index = (index + 1) % words.length;
    chars = render(words[index]);
    set(chars, { translateY: 34, opacity: 0, rotateX: -40 });
    animate(chars, { translateY: 0, opacity: 1, rotateX: 0, duration: 620, delay: stagger(step), easing: 'swift' });
    timer = setTimeout(cycle, interval);
  };
  timer = setTimeout(cycle, interval);
  return () => clearTimeout(timer);
}

/** ClickSpark: faíscas saindo do ponto do clique. Um canvas fixo para a página toda. */
let sparkCanvas = null;
let sparks = [];
let sparkRaf = 0;
function ensureSparkCanvas() {
  if (sparkCanvas) return sparkCanvas;
  sparkCanvas = document.createElement('canvas');
  sparkCanvas.className = 'spark-layer';
  document.body.appendChild(sparkCanvas);
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    sparkCanvas.width = innerWidth * dpr; sparkCanvas.height = innerHeight * dpr;
    sparkCanvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  return sparkCanvas;
}
function drawSparks() {
  const ctx = sparkCanvas.getContext('2d');
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const now = performance.now();
  sparks = sparks.filter((s) => now - s.t0 < s.life);
  for (const s of sparks) {
    const p = (now - s.t0) / s.life;
    const eased = 1 - (1 - p) ** 3;
    const start = s.radius * 0.35 + s.distance * eased;
    const end = start + s.length * (1 - p);
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = 1 - p;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x + Math.cos(s.angle) * start, s.y + Math.sin(s.angle) * start);
    ctx.lineTo(s.x + Math.cos(s.angle) * end, s.y + Math.sin(s.angle) * end);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  sparkRaf = sparks.length ? requestAnimationFrame(drawSparks) : 0;
}
export function clickSpark(el, { color = '#8fb2ff', count = 10, distance = 34, length = 12, life = 520 } = {}) {
  el.addEventListener('pointerdown', (event) => {
    if (reducedMotion()) return;
    ensureSparkCanvas();
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      sparks.push({ x: event.clientX, y: event.clientY, angle: (Math.PI * 2 * i) / count + Math.random() * 0.2,
        distance, length, life, color, t0, radius: 12 });
    }
    if (!sparkRaf) sparkRaf = requestAnimationFrame(drawSparks);
  });
}

/** Faixa que corre sem fim (InfiniteScroll / LogoLoop), pausa ao passar o mouse. */
export function marquee(el, { speed = 40 } = {}) {
  const track = el.querySelector('[data-track]') || el.firstElementChild;
  if (!track) return;
  const clone = track.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  el.appendChild(clone);
  const width = track.scrollWidth;
  const duration = Math.max(8, width / speed);
  el.style.setProperty('--marquee-duration', `${duration}s`);
  el.classList.add('is-ready');
}

/** Desenha um caminho SVG (stroke-dashoffset), o clássico do anime.js. */
export function drawPath(path, { duration = 1400, delay = 0, easing = 'expo.inOut' } = {}) {
  if (!path) return { finished: Promise.resolve() };
  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;
  if (reducedMotion()) { path.style.strokeDashoffset = '0'; return { finished: Promise.resolve() }; }
  const state = { offset: length };
  return animate(state, {
    offset: [length, 0], duration, delay, easing,
    onUpdate: () => { path.style.strokeDashoffset = `${state.offset}`; },
  });
}

/** DecryptedText: caracteres aleatórios que se assentam da esquerda para a direita. */
export function scramble(el, { duration = 1100, delay = 0, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&' } = {}) {
  if (!el) return;
  const target = el.dataset.scramble || el.textContent;
  el.dataset.scramble = target;
  if (reducedMotion()) { el.textContent = target; return; }
  const start = performance.now() + delay;
  const tick = (now) => {
    const p = Math.min(1, Math.max(0, (now - start) / duration));
    const settled = Math.floor(p * target.length);
    let out = '';
    for (let i = 0; i < target.length; i++) {
      const ch = target[i];
      if (i < settled || ch === ' ') out += ch;
      else out += chars[Math.floor(Math.random() * chars.length)];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Barra fina no topo mostrando o progresso da rolagem. */
export function scrollProgressBar() {
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.appendChild(bar);
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

export function enhance(root = document) {
  root.querySelectorAll('[data-magnetic]').forEach((el) => magnetic(el, { strength: Number(el.dataset.magnetic) || 0.3 }));
  root.querySelectorAll('[data-spotlight]').forEach((el) => spotlight(el));
  root.querySelectorAll('[data-tilt]').forEach((el) => tilt(el, { max: Number(el.dataset.tilt) || 9 }));
  root.querySelectorAll('[data-ripple]').forEach((el) => ripple(el));
  root.querySelectorAll('[data-spark]').forEach((el) => clickSpark(el, { color: el.dataset.spark || '#8fb2ff' }));
  root.querySelectorAll('[data-glare]').forEach((el) => el.classList.add('has-glare'));
  root.querySelectorAll('[data-marquee]').forEach((el) => marquee(el, { speed: Number(el.dataset.marquee) || 40 }));
  root.querySelectorAll('[data-scramble]').forEach((el, i) => inView(el, () => scramble(el, { delay: i * 80 })));
  scrollReveal(root);
  parallax(root);
}

export { animate, set, stagger, inView, spring, reducedMotion };
