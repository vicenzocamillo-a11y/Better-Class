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
export function enhance(root = document) {
  root.querySelectorAll('[data-magnetic]').forEach((el) => magnetic(el, { strength: Number(el.dataset.magnetic) || 0.3 }));
  root.querySelectorAll('[data-spotlight]').forEach((el) => spotlight(el));
  root.querySelectorAll('[data-tilt]').forEach((el) => tilt(el, { max: Number(el.dataset.tilt) || 9 }));
  root.querySelectorAll('[data-ripple]').forEach((el) => ripple(el));
  scrollReveal(root);
  parallax(root);
}

export { animate, set, stagger, inView, spring, reducedMotion };
