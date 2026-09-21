/**
 * effects.js — os poucos efeitos que o Better Class usa.
 *
 * Cada um existe por um motivo de produto:
 *   · marker      → marcar o que importa, que é o que o app faz com a aula
 *   · audioBars   → mostrar o nível real do microfone durante a gravação
 *   · countUp     → dar peso aos números do painel (dados reais, nunca fictícios)
 *   · revealText  → uma única entrada, no título da página inicial
 *   · typewriter  → simular a legenda ao vivo no exemplo da página inicial
 *
 * Não há spotlight de cursor, inclinação 3D, partículas nem revelação por
 * scroll: nada disso explicaria estado ou hierarquia aqui.
 */
import { animate, set, stagger, inView, reducedMotion } from './motion.js';

/* ── Texto ────────────────────────────────────────────────── */

/** Quebra o texto em <span> por palavra ou caractere, preservando espaços. */
export function splitText(el, { by = 'words' } = {}) {
  if (el.dataset.split) return [...el.querySelectorAll('.split-unit')];
  const source = el.textContent;
  el.dataset.split = by;
  el.textContent = '';
  el.setAttribute('aria-label', source);

  const units = [];
  for (const chunk of source.split(/(\s+)/)) {
    if (/^\s+$/.test(chunk)) { el.appendChild(document.createTextNode(chunk)); continue; }
    const word = document.createElement('span');
    word.className = 'split-word';
    word.setAttribute('aria-hidden', 'true');
    if (by === 'words') {
      word.classList.add('split-unit');
      word.textContent = chunk;
      units.push(word);
    } else {
      for (const char of chunk) {
        const span = document.createElement('span');
        span.className = 'split-unit';
        span.textContent = char;
        word.appendChild(span);
        units.push(span);
      }
    }
    el.appendChild(word);
  }
  return units;
}

/** Entrada do título: sobe e ganha nitidez, uma vez só. */
export function revealText(el, { by = 'words', delay = 0, step = 42, duration = 620 } = {}) {
  if (!el) return;
  if (reducedMotion()) { el.style.opacity = '1'; return; }
  const units = splitText(el, { by });
  set(units, { opacity: 0, translateY: 14 });
  el.style.opacity = '1';
  animate(units, {
    opacity: [0, 1], translateY: 0,
    duration, delay: stagger(step, { start: delay }), easing: 'quart.out',
  });
}

/** Passa o marca-texto sobre um trecho. */
export function mark(el, { delay = 0 } = {}) {
  if (!el) return;
  if (reducedMotion()) { el.classList.add('is-on'); return; }
  setTimeout(() => el.classList.add('is-on'), delay);
}

/** Números do painel. Só para dados reais. */
export function countUp(el, to, { duration = 900, decimals = 0, suffix = '', prefix = '' } = {}) {
  const target = Number(to);
  const format = (value) => `${prefix}${value.toFixed(decimals).replace('.', ',')}${suffix}`;
  if (reducedMotion() || !Number.isFinite(target)) { el.textContent = format(target || 0); return; }
  const state = { value: 0 };
  animate(state, {
    value: [0, target], duration, easing: 'quart.out',
    onUpdate: () => { el.textContent = format(state.value); },
    onComplete: () => { el.textContent = format(target); },
  });
}

/** Legenda do exemplo na página inicial. */
export function typewriter(el, phrases, { speed = 46, hold = 2600 } = {}) {
  if (!el) return () => {};
  if (reducedMotion()) { el.textContent = phrases[0]; return () => {}; }
  let phrase = 0, char = 0, deleting = false, timer;
  const step = () => {
    const current = phrases[phrase % phrases.length];
    char += deleting ? -1 : 1;
    el.textContent = current.slice(0, char);
    let next = deleting ? speed / 2.4 : speed;
    if (!deleting && char === current.length) { deleting = true; next = hold; }
    else if (deleting && char === 0) { deleting = false; phrase++; next = 280; }
    timer = setTimeout(step, next);
  };
  step();
  return () => clearTimeout(timer);
}

/* ── Áudio ────────────────────────────────────────────────── */

/** Barras de nível. `getLevels` devolve os dados reais do analisador. */
export function audioBars(canvas, getLevels, { bars = 56, color } = {}) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  let raf = 0, width = 0, height = 0;
  const smooth = new Array(bars).fill(0);
  const ink = () => color || getComputedStyle(canvas).color || '#adaca6';

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
    ctx.fillStyle = ink();
    for (let i = 0; i < bars; i++) {
      const sample = data.length ? data[Math.floor((i / bars) * data.length)] / 255 : 0;
      smooth[i] = smooth[i] * 0.7 + sample * 0.3;
      const barHeight = Math.max(2, smooth[i] * height);
      const x = i * (barWidth + gap);
      ctx.globalAlpha = 0.35 + smooth[i] * 0.65;
      ctx.beginPath();
      ctx.roundRect(x, (height - barHeight) / 2, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener('resize', resize);
  // O canvas pode nascer oculto (ex.: só aparece ao gravar). Sem observar o
  // tamanho, ele ficaria com 0 x 0 para sempre.
  const observer = new ResizeObserver(() => { if (canvas.offsetWidth !== width || canvas.offsetHeight !== height) resize(); });
  observer.observe(canvas);
  raf = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener('resize', resize);
  };
}

/** Aplica os efeitos declarativos que restaram. */
export function enhance(root = document) {
  root.querySelectorAll('[data-mark]').forEach((el, i) => {
    inView(el, () => mark(el, { delay: Number(el.dataset.mark) || i * 120 }), { amount: 0.6 });
  });
}

export { animate, set, stagger, inView, reducedMotion };
