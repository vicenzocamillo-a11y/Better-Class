import { animate, reducedMotion } from './motion.js';
import { mark, typewriter, audioBars, enhance } from './effects.js';

/* Menu em telas estreitas */
const burger = document.getElementById('burger');
const links = document.querySelector('.nav-links');
burger?.addEventListener('click', () => {
  const open = links.classList.toggle('is-open');
  burger.setAttribute('aria-expanded', String(open));
});
links?.addEventListener('click', (event) => {
  if (event.target.tagName === 'A') {
    links.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
  }
});

/* Abertura: o título entra uma vez e o marca-texto passa sobre a ação
   central do produto. É a única animação de entrada da página. */
mark(document.getElementById('heroMark'), { delay: 820 });

if (!reducedMotion()) {
  const copy = document.querySelector('.hero-copy');
  animate('.hero-line', {
    opacity: [0, 1], translateY: [12, 0],
    duration: 560, delay: (el, i) => 60 + i * 110, easing: 'quart.out',
  });
  for (const [i, el] of [...copy.querySelectorAll('.lead, .hero-actions, .hero-note')].entries()) {
    animate(el, { opacity: [0, 1], translateY: [10, 0], duration: 500, delay: 260 + i * 90, easing: 'quart.out' });
  }
  animate('.specimen', { opacity: [0, 1], translateY: [14, 0], duration: 620, delay: 200, easing: 'quart.out' });
}

/* Exemplo da tela de gravação: cronômetro, nível e legenda ao vivo.
   Ilustra o produto, e o rótulo acima deixa claro que é um exemplo. */
const timer = document.getElementById('demoTimer');
if (timer && !reducedMotion()) {
  let seconds = 42 * 60 + 15;
  setInterval(() => {
    seconds += 1;
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timer.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

const wave = document.getElementById('demoWave');
if (wave) {
  const levels = new Uint8Array(64);
  audioBars(wave, () => {
    if (reducedMotion()) { levels.fill(40); return levels; }
    const t = Date.now() / 220;
    for (let i = 0; i < levels.length; i++) {
      levels[i] = 26 + Math.abs(Math.sin(t / 3 + i / 4.5)) * (70 + Math.sin(t / 7 + i) * 55);
    }
    return levels;
  }, { bars: 46 });
}

typewriter(document.getElementById('demoCaption'), [
  'então o teorema fundamental conecta derivada e integral',
  'atenção, f precisa ser contínua no intervalo fechado',
  'isso cai na prova, anotem a condição de continuidade',
]);

enhance(document);

/* Navegação interna suave, respeitando a altura da barra fixa */
for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    const top = target.getBoundingClientRect().top + scrollY - 76;
    window.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
}
