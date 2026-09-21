import { animate, set, stagger, inView, reducedMotion } from './motion.js';
import { typewriter } from './effects.js';

const reduce = reducedMotion();

/* ── Navegação ────────────────────────────────────────────── */
const nav = document.getElementById('nav');
const burger = document.getElementById('burger');
const links = document.querySelector('.nav-links');

const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

burger?.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  burger.setAttribute('aria-expanded', String(open));
});
links?.addEventListener('click', (event) => {
  if (event.target.tagName === 'A') { links.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
});

// Sublinha o link da seção que está na tela
const sectionObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    links?.querySelectorAll('a').forEach((a) => a.classList.remove('current'));
    links?.querySelector(`a[href="#${entry.target.id}"]`)?.classList.add('current');
  }
}, { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('main section[id]').forEach((section) => sectionObserver.observe(section));

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    const top = target.getBoundingClientRect().top + scrollY - 72;
    window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
  });
});

/* ── Abertura: linhas sobem da máscara, marca-texto risca, resto entra ── */
const lines = [...document.querySelectorAll('.hero-title .line')];
const intro = [...document.querySelectorAll('[data-intro]')];
const heroMark = document.getElementById('heroMark');

if (reduce) {
  set(intro, { opacity: 1 });
  heroMark?.classList.add('on');
} else {
  lines.forEach((line) => set(line, { translateY: line.offsetHeight * 1.15 }));
  set(intro, { opacity: 0, translateY: 14 });
  requestAnimationFrame(() => {
    animate(lines, { translateY: 0, duration: 1100, delay: stagger(110, { start: 80 }), easing: 'swift' });
    setTimeout(() => heroMark?.classList.add('on'), 900);
    animate(intro, { opacity: 1, translateY: 0, duration: 900, delay: stagger(90, { start: 520 }), easing: 'swift' });
  });
}

/* ── Demonstração: onda, cronômetro, legenda, saídas ─────── */
const wave = document.getElementById('demoWave');
if (wave && !reduce) {
  const ctx = wave.getContext('2d');
  const bars = 56;
  const heights = new Array(bars).fill(0).map(() => Math.random());
  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    wave.width = wave.offsetWidth * dpr; wave.height = 64 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = (time) => {
    const width = wave.offsetWidth, height = 64;
    ctx.clearRect(0, 0, width, height);
    const gap = 3;
    const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
    for (let i = 0; i < bars; i++) {
      const target = 0.12 + Math.abs(Math.sin(time / 420 + i / 3.1)) * (0.3 + heights[i] * 0.6);
      heights[i] += (target - heights[i]) * 0.14;
      const barHeight = Math.max(3, heights[i] * height);
      ctx.fillStyle = i % 7 === 3 ? '#ff3b30' : '#141413';
      ctx.globalAlpha = 0.5 + heights[i] * 0.5;
      ctx.beginPath();
      ctx.roundRect(i * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight, 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  };
  resize();
  addEventListener('resize', resize);
  requestAnimationFrame(draw);
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

inView('#demoOut', () => {
  animate('#demoOut li', { opacity: [0, 1], translateY: [10, 0], duration: 800, delay: stagger(140, { start: 900 }), easing: 'swift' });
}, { amount: 0.3 });

/* ── Marca-texto nos títulos das seções ───────────────────── */
document.querySelectorAll('[data-hl]').forEach((el) => inView(el, () => el.classList.add('on'), { amount: 0.6 }));

/* ── Como funciona: palco fixo que muda com a rolagem ─────── */
const stage = document.getElementById('stage');
const steps = document.getElementById('steps');
if (stage && steps) {
  const scenes = [...stage.querySelectorAll('.scene')];
  const chunks = document.getElementById('chunks');
  const chunkLog = document.getElementById('chunkLog');
  const sceneText = document.getElementById('sceneText');
  const outputs = [...document.querySelectorAll('#outputs li')];
  for (let i = 0; i < 24; i++) chunks.appendChild(document.createElement('i'));
  const squares = [...chunks.children];

  let active = -1;
  let timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  const playChunks = () => {
    squares.forEach((s) => (s.className = ''));
    let n = 0;
    const tick = () => {
      if (n > 0) squares[n - 1].className = 'sent';
      if (n < squares.length) {
        squares[n].className = 'now';
        chunkLog.textContent = `pedaço ${String(n + 1).padStart(2, '0')} · 15 s · ${n === 0 ? 'enviando' : 'enviado'}`;
        n++;
        later(tick, 260);
      } else {
        chunkLog.textContent = `${squares.length} pedaços · 6 min · nada perdido`;
        later(playChunks, 2200);
      }
    };
    tick();
  };

  const TRANSCRIPT = 'então o <b>teorema fundamental</b> conecta derivada e integral. Atenção: f precisa ser <b>contínua</b> no intervalo fechado. Isso cai na prova, anotem a <b>condição de continuidade</b>.';
  const playText = () => {
    const words = TRANSCRIPT.split(' ');
    let i = 0;
    const tick = () => {
      sceneText.innerHTML = `${words.slice(0, i).join(' ')} <span class="caret">▍</span>`;
      if (i < words.length) { i++; later(tick, 120 + Math.random() * 90); }
      else later(playText, 2600);
    };
    tick();
  };

  const playOutputs = () => {
    outputs.forEach((li) => { li.classList.remove('done'); set(li, { opacity: 0, translateY: 8 }); });
    outputs.forEach((li, i) => {
      later(() => {
        animate(li, { opacity: 1, translateY: 0, duration: 600, easing: 'swift' });
        later(() => li.classList.add('done'), 420);
      }, 300 + i * 420);
    });
    later(playOutputs, 5200);
  };

  const show = (index) => {
    if (index === active) return;
    active = index;
    clear();
    steps.classList.add('is-tracking');
    steps.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i === index));
    scenes.forEach((scene, i) => {
      if (reduce) { scene.style.opacity = i === index ? '1' : '0'; return; }
      animate(scene, { opacity: i === index ? 1 : 0, translateY: i === index ? [10, 0] : 0, duration: 520, easing: 'swift' });
    });
    if (reduce) {
      squares.forEach((s) => (s.className = 'sent'));
      sceneText.innerHTML = TRANSCRIPT;
      outputs.forEach((li) => { li.classList.add('done'); set(li, { opacity: 1 }); });
      return;
    }
    [playChunks, playText, playOutputs][index]?.();
  };

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) show(Number(visible.target.dataset.step));
  }, { threshold: [0.35, 0.6], rootMargin: '-20% 0px -30% 0px' });
  steps.querySelectorAll('.step').forEach((s) => observer.observe(s));
  show(0);
}

/* ── Esteira da automação ─────────────────────────────────── */
const pipeline = document.getElementById('pipeline');
if (pipeline) {
  const items = [...pipeline.querySelectorAll('.pipe-step')];
  const fill = document.getElementById('pipeFill');
  let index = -1;
  const advance = () => {
    index = (index + 1) % (items.length + 1);
    items.forEach((step, i) => step.classList.toggle('on', i < index));
    if (fill) fill.style.height = `${(Math.max(0, index - 1) / (items.length - 1)) * 100}%`;
  };
  inView(pipeline, () => { advance(); setInterval(advance, 1400); }, { amount: 0.35 });
}

/* ── Flashcard ────────────────────────────────────────────── */
const flashcard = document.getElementById('flashcard');
const flip = () => flashcard.classList.toggle('flipped');
flashcard?.addEventListener('click', flip);
flashcard?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); }
});

/* ── Intervalos da repetição espaçada ─────────────────────── */
inView('#schedule', () => {
  animate('.ticks li', { opacity: [0, 1], translateY: [8, 0], duration: 700, delay: stagger(110), easing: 'swift' });
}, { amount: 0.5 });
