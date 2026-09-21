import { animate, set, stagger, timeline, inView, onScrollProgress, reducedMotion } from './motion.js';
import { enhance, revealText, countUp, aurora, particles, typewriter, cursorGlow } from './effects.js';

/* ── Cenário ──────────────────────────────────────────────── */
aurora(document.getElementById('aurora'));
particles(document.getElementById('dust'), { count: 64 });
cursorGlow();

/* ── Navegação ────────────────────────────────────────────── */
const nav = document.getElementById('nav');
const burger = document.getElementById('burger');
const links = document.querySelector('.nav-links');

const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

burger?.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  burger.setAttribute('aria-expanded', String(open));
});
links?.addEventListener('click', (event) => {
  if (event.target.tagName === 'A') { links.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
});

/* ── Abertura cinematográfica ─────────────────────────────── */
const heroCopy = document.querySelector('.hero-copy');
set('.hero-lead, .hero-cta, .hero-note, .eyebrow', { opacity: 0, translateY: 22, blur: 4 });
set('.hero-panel', { opacity: 0, translateY: 48, scale: 0.96, blur: 10 });

requestAnimationFrame(() => {
  revealText(document.getElementById('t1'), { delay: 120, step: 24 });

  // A segunda linha tem gradiente no texto, então entra com um "wipe"
  // (cortina) em vez de letra a letra — assim o gradiente continua inteiro.
  const t2 = document.getElementById('t2');
  if (t2) {
    t2.style.opacity = '1';
    if (reducedMotion()) {
      t2.style.clipPath = 'none';
    } else {
      t2.style.clipPath = 'inset(-0.2em 100% -0.2em -0.05em)';
      const wipe = { value: 100 };
      animate(wipe, {
        value: [100, 0], duration: 1500, delay: 540, easing: 'swift',
        onUpdate: () => { t2.style.clipPath = `inset(-0.2em ${wipe.value.toFixed(2)}% -0.2em -0.05em)`; },
        onComplete: () => { t2.style.clipPath = 'none'; },
      });
      animate(t2, { translateY: [26, 0], blur: [10, 0], duration: 1400, delay: 520, easing: 'swift' });
    }
  }

  timeline({ easing: 'swift', duration: 950 })
    .add('.hero-copy .eyebrow', { opacity: 1, translateY: 0, blur: 0, duration: 700 }, 0)
    .add('.hero-lead', { opacity: 1, translateY: 0, blur: 0 }, 760)
    .add('.hero-cta', { opacity: 1, translateY: 0, blur: 0 }, 880)
    .add('.hero-note', { opacity: 1, translateY: 0, blur: 0 }, 980)
    .add('.hero-panel', { opacity: 1, translateY: 0, scale: 1, blur: 0, duration: 1500 }, 380)
    .play();
});

/* ── Painel do herói: onda, cronómetro, legenda, saídas ───── */
const wave = document.getElementById('demoWave');
if (wave && !reducedMotion()) {
  const ctx = wave.getContext('2d');
  const bars = 54;
  const heights = new Array(bars).fill(0).map(() => Math.random());
  let raf = 0;
  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    wave.width = wave.offsetWidth * dpr; wave.height = 54 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = (time) => {
    const width = wave.offsetWidth, height = 54;
    ctx.clearRect(0, 0, width, height);
    const gap = 3;
    const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
    for (let i = 0; i < bars; i++) {
      const target = 0.18 + Math.abs(Math.sin(time / 420 + i / 3.1)) * (0.35 + heights[i] * 0.6);
      heights[i] += (target - heights[i]) * 0.14;
      const barHeight = Math.max(3, heights[i] * height);
      const x = i * (barWidth + gap);
      const gradient = ctx.createLinearGradient(0, (height - barHeight) / 2, 0, (height + barHeight) / 2);
      gradient.addColorStop(0, '#8fb2ff'); gradient.addColorStop(1, '#5b8cff');
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.45 + heights[i] * 0.55;
      ctx.beginPath();
      ctx.roundRect(x, (height - barHeight) / 2, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };
  resize();
  addEventListener('resize', resize);
  raf = requestAnimationFrame(draw);
}

const timer = document.getElementById('demoTimer');
if (timer) {
  let seconds = 42 * 60 + 15;
  setInterval(() => {
    seconds++;
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timer.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

typewriter(document.getElementById('demoCaption'), [
  '…então o teorema fundamental conecta derivada e integral…',
  '…atenção: f precisa ser contínua no intervalo fechado…',
  '…isso cai na prova, anotem a condição de continuidade…',
], { speed: 42, hold: 2400 });

inView('.panel-out', () => {
  animate('.out-card', {
    opacity: [0, 1], translateY: [22, 0], blur: [8, 0], scale: [0.97, 1],
    duration: 1000, delay: stagger(160, { start: 400 }), easing: 'swift',
  });
}, { amount: 0.3 });

/* ── Contadores ───────────────────────────────────────────── */
inView('.stats', () => {
  document.querySelectorAll('[data-count]').forEach((el, index) => {
    setTimeout(() => countUp(el, Number(el.dataset.count), { suffix: el.dataset.suffix || '' }), index * 110);
  });
}, { amount: 0.4 });

/* ── Esteira da automação ─────────────────────────────────── */
const pipeline = document.getElementById('pipeline');
if (pipeline) {
  const steps = [...pipeline.querySelectorAll('.pipe-step')];
  const fill = document.getElementById('pipeFill');
  let index = -1;
  const advance = () => {
    index = (index + 1) % (steps.length + 1);
    steps.forEach((step, i) => step.classList.toggle('on', i < index));
    if (fill) fill.style.height = `${(Math.max(0, index - 1) / (steps.length - 1)) * 100}%`;
  };
  inView(pipeline, () => {
    advance();
    setInterval(advance, 1500);
  }, { amount: 0.35 });
}

/* ── Flashcard demonstrativo ──────────────────────────────── */
const flashcard = document.getElementById('flashcard');
const flip = () => flashcard.classList.toggle('flipped');
flashcard?.addEventListener('click', flip);
flashcard?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); }
});

/* ── Parallax leve do herói ───────────────────────────────── */
if (!reducedMotion() && heroCopy) {
  onScrollProgress(document.querySelector('.hero'), (progress) => {
    set(heroCopy, { translateY: progress * 46, opacity: Math.max(0, 1 - progress * 1.15) });
  }, { start: 0.9, end: 0 });
}

/* ── Efeitos declarativos + navegação suave ───────────────── */
enhance(document);

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    const top = target.getBoundingClientRect().top + scrollY - 80;
    window.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
});
