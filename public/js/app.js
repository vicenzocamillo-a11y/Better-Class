/**
 * app.js — o app do Better Class.
 * Roteamento por hash, views renderizadas em JS e progresso ao vivo por SSE.
 */
import { animate, set, stagger, timeline, reducedMotion } from './motion.js';
import { enhance, countUp, audioBars } from './effects.js';
import { api, listenEvents } from './api.js';
import { LectureRecorder, formatDuration, speechSupported, pickMime } from './recorder.js';

/* ── Estado ───────────────────────────────────────────────── */
const state = {
  user: null,
  capabilities: { ai: false, serverTranscription: false },
  settings: {},
  courses: [],
  lectures: [],
  stats: null,
  recorder: null,
  recording: null,
  search: '',
};

const view = document.getElementById('view');
const viewTitle = document.getElementById('viewTitle');
const viewSub = document.getElementById('viewSub');

/* ── Utilidades ───────────────────────────────────────────── */
export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(message, kind = 'info', ms = 4200) {
  const node = el(`<div class="toast ${kind}"><span class="dot"></span><div>${esc(message)}</div></div>`);
  document.getElementById('toasts').appendChild(node);
  set(node, { opacity: 0, translateY: 14, scale: 0.96 });
  animate(node, { opacity: 1, translateY: 0, scale: 1, duration: 520, easing: 'swift' });
  setTimeout(() => {
    animate(node, { opacity: 0, translateX: 24, duration: 420, easing: 'appleIn', onComplete: () => node.remove() });
  }, ms);
  return node;
}

function confirmDialog({ title, body, confirm = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const back = el(`
      <div class="modal-back">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <p class="muted">${esc(body)}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-no>Cancelar</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirm)}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(back);
    animate(back, { opacity: [0, 1], duration: 260 });
    animate(back.querySelector('.modal'), { opacity: [0, 1], scale: [0.94, 1], translateY: [18, 0], duration: 560, easing: 'swift' });
    const close = (result) => {
      animate(back, { opacity: 0, duration: 220, onComplete: () => back.remove() });
      resolve(result);
    };
    back.querySelector('[data-yes]').onclick = () => close(true);
    back.querySelector('[data-no]').onclick = () => close(false);
    back.onclick = (event) => { if (event.target === back) close(false); };
  });
}

const relativeDate = (iso) => {
  const date = new Date(iso);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 90) return 'agora mesmo';
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  if (diff < 172800) return 'ontem';
  if (diff < 604800) return `há ${Math.round(diff / 86400)} dias`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

const minutesOf = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);

const STATUS_TAG = {
  recording: ['rose', 'gravando'],
  processing: ['amber', 'processando'],
  ready: ['green', 'pronta'],
  needs_transcript: ['amber', 'falta transcrição'],
  failed: ['rose', 'falhou'],
};

/* ── Navegação ────────────────────────────────────────────── */
const routes = {};
export const route = (name, handler) => { routes[name] = handler; };

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [name, ...rest] = hash.split('/');
  return { name: name || 'inicio', params: rest };
}

let currentView = null;
async function render() {
  const { name, params } = currentRoute();
  const handler = routes[name] || routes.inicio;

  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === name || (name === 'aula' && link.dataset.nav === 'aulas'));
  });
  document.querySelector('.sidebar')?.classList.remove('open');

  if (currentView && !reducedMotion()) {
    await animate(currentView, { opacity: 0, translateY: -12, blur: 4, duration: 220, easing: 'appleIn' }).finished;
  }
  view.innerHTML = '';

  const node = el('<div class="view-inner"></div>');
  view.appendChild(node);
  currentView = node;
  set(node, { opacity: 0, translateY: 18, blur: 5 });

  try {
    await handler(node, params);
  } catch (error) {
    if (error.status === 401) { location.href = '/entrar'; return; }
    node.appendChild(el(`<div class="empty"><div class="ring">!</div><p>${esc(error.message)}</p></div>`));
  }

  animate(node, { opacity: 1, translateY: 0, blur: 0, duration: 620, easing: 'swift' });
  const children = [...node.children].slice(0, 14);
  if (children.length > 1) {
    set(children, { opacity: 0, translateY: 16 });
    animate(children, { opacity: 1, translateY: 0, duration: 700, delay: stagger(55), easing: 'swift' });
  }
  enhance(node);
}

function setHeader(title, subtitle) {
  viewTitle.textContent = title;
  viewSub.textContent = subtitle;
  if (!reducedMotion()) {
    animate([viewTitle, viewSub], { opacity: [0, 1], translateY: [8, 0], duration: 500, delay: stagger(40), easing: 'swift' });
  }
  document.title = `${title} · Better Class`;
}

window.addEventListener('hashchange', render);

/* ── Dados ────────────────────────────────────────────────── */
async function refreshLectures() {
  const data = await api.lectures(state.search ? { q: state.search } : {});
  state.lectures = data.lectures;
  return state.lectures;
}

async function refreshStats() {
  state.stats = await api.stats();
  const badge = document.getElementById('dueBadge');
  badge.hidden = !state.stats.due;
  badge.textContent = state.stats.due;
  return state.stats;
}

/* ── Arranque ─────────────────────────────────────────────── */
async function boot() {
  try {
    const me = await api.me();
    state.user = me.user;
    state.capabilities = me.capabilities;
    state.settings = me.user.settings || {};
  } catch {
    location.href = '/entrar';
    return;
  }

  applySettings();

  document.getElementById('userName').textContent = state.user.name;
  document.getElementById('avatar').textContent = state.user.name.charAt(0).toUpperCase();
  document.getElementById('engineBadge').textContent = state.capabilities.ai ? 'IA: Claude' : 'IA: motor local';

  const [courses] = await Promise.all([api.courses(), refreshLectures(), refreshStats()]);
  state.courses = courses.courses;

  const bootScreen = document.getElementById('boot');
  const app = document.getElementById('app');
  app.hidden = false;
  set(app, { opacity: 0 });
  animate(bootScreen, { opacity: 0, scale: 1.06, duration: 480, easing: 'appleIn', onComplete: () => bootScreen.remove() });
  animate(app, { opacity: 1, duration: 700, easing: 'swift' });
  timeline({ easing: 'swift', duration: 800 })
    .add('.sidebar', { opacity: [0, 1], translateX: [-18, 0] }, 60)
    .add('.topbar', { opacity: [0, 1], translateY: [-14, 0] }, 140)
    .play();

  await render();
  wireChrome();
  wireEvents();
}

function applySettings() {
  document.documentElement.dataset.motion = state.settings.reduceMotion ? 'reduced' : 'full';
}

function wireChrome() {
  document.getElementById('menuBtn')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  document.getElementById('logout').addEventListener('click', async () => {
    if (state.recorder && state.recorder.state !== 'idle') {
      const leave = await confirmDialog({ title: 'Ainda gravando', body: 'A gravação vai ser encerrada e processada antes de sair. Continuar?', confirm: 'Encerrar e sair' });
      if (!leave) return;
      await state.recorder.stop();
    }
    await api.logout();
    location.href = '/';
  });

  let searchTimer;
  document.getElementById('search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.search = event.target.value.trim();
      await refreshLectures();
      if (['aulas', 'inicio'].includes(currentRoute().name)) render();
      else location.hash = '#/aulas';
    }, 300);
  });

}

/** Progresso da automação chegando do servidor. */
function wireEvents() {
  listenEvents({
    job: (data) => {
      const lecture = state.lectures.find((item) => item.id === data.lectureId);
      if (lecture) lecture.job = { id: data.jobId, status: data.status, step: data.step, progress: data.progress, error: data.error };

      document.querySelectorAll(`[data-job-for="${data.lectureId}"]`).forEach((node) => {
        const bar = node.querySelector('[data-job-bar]');
        const step = node.querySelector('[data-job-step]');
        if (bar) bar.style.width = `${data.progress}%`;
        if (step) step.textContent = data.step;
        node.querySelectorAll('[data-stepper] li').forEach((li) => {
          const reached = data.progress >= Number(li.dataset.at);
          if (reached && !li.classList.contains('done')) {
            li.classList.add('done');
            animate(li.querySelector('i'), { scale: [0.4, 1.25, 1], duration: 560, easing: 'elastic.out' });
          }
        });
        node.dataset.status = data.status;
      });

      if (data.status === 'done') {
        toast('Material da aula pronto', 'ok');
        refreshLectures().then(() => {
          const { name, params } = currentRoute();
          // se a aula que terminou está aberta, o material aparece sem precisar recarregar
          if (['inicio', 'aulas'].includes(name) || (name === 'aula' && params[0] === data.lectureId)) {
            setTimeout(render, 900);   // deixa os passos acenderem antes de trocar a tela
          }
        });
        refreshStats();
      }
      if (data.status === 'error') toast(`Falhou: ${data.error}`, 'error', 7000);
    },
    lecture: () => { refreshStats(); },
  });
}

/* Cronómetro da gravação na barra lateral */
export function updateMiniRecorder() {
  const mini = document.getElementById('recMini');
  const recorder = state.recorder;
  const active = recorder && (recorder.state === 'recording' || recorder.state === 'paused');
  mini.hidden = !active;
  if (active) document.getElementById('recMiniTime').textContent = formatDuration(recorder.elapsedMs);
}
setInterval(updateMiniRecorder, 500);

/* ═══════════════════════════════════════════════════════════
   Início
   ═══════════════════════════════════════════════════════════ */
route('inicio', async (node) => {
  setHeader(`Olá, ${state.user.name.split(' ')[0]}`, hojeResumo());
  await refreshStats();
  const stats = state.stats;
  const recent = state.lectures.slice(0, 6);

  node.appendChild(el(`
    <section class="metrics">
      <div class="metric"><strong data-metric="${stats.lectures}">0</strong><span>aulas gravadas</span></div>
      <div class="metric"><strong data-metric="${stats.hoursRecorded}" data-decimals="1" data-suffix=" h">0</strong><span>de aula guardada</span></div>
      <div class="metric"><strong data-metric="${stats.due}">0</strong><span>cards para revisar hoje</span>
        <div class="spark">${sparkline(stats.activity)}</div></div>
      <div class="metric"><strong data-metric="${stats.streak}">0</strong><span>dias seguidos estudando</span></div>
    </section>`));

  node.appendChild(el(`
    <section class="panel-card">
      <div class="section-title"><h2>Próximo passo</h2></div>
      <div class="cards">
        <a class="lecture-card" href="#/gravar">
          <h3>Gravar a aula de agora</h3>
          <p class="small muted">Deixa rodando em segundo plano. O material chega sozinho no fim.</p>
        </a>
        <a class="lecture-card" href="#/revisar">
          <h3>Revisar ${stats.due} card${stats.due === 1 ? '' : 's'}</h3>
          <p class="small muted">${stats.due ? 'Vencem hoje. Cinco minutos resolvem.' : 'Nada vencendo agora. Volte amanhã.'}</p>
        </a>
        <button class="lecture-card" data-import style="text-align:left">
          <h3>Importar uma aula em texto</h3>
          <p class="small muted">Já tem a transcrição ou as anotações? A IA monta o resto.</p>
        </button>
      </div>
    </section>`));

  node.appendChild(el(`
    <section class="panel-card">
      <div class="section-title"><h2>Atividade dos últimos 30 dias</h2><span class="micro">${stats.quizAccuracy === null ? 'sem quiz ainda' : `${stats.quizAccuracy}% de acerto no quiz`}</span></div>
      <div class="heat">${stats.activity.map((day) => `<i data-level="${level(day.count)}" title="${day.day}: ${day.count} revisões"></i>`).join('')}</div>
    </section>`));

  const list = el(`
    <section class="panel-card">
      <div class="section-title"><h2>Aulas recentes</h2><a href="#/aulas">ver todas</a></div>
      <div class="cards" data-recent></div>
    </section>`);
  const container = list.querySelector('[data-recent]');
  if (!recent.length) {
    container.appendChild(el(`<div class="empty"><div class="ring">·</div><p>Nenhuma aula ainda. A primeira gravação leva 10 segundos para começar.</p><a class="btn btn-primary" href="#/gravar">Gravar agora</a></div>`));
  } else {
    recent.forEach((lecture) => container.appendChild(lectureCard(lecture)));
  }
  node.appendChild(list);

  node.querySelector('[data-import]')?.addEventListener('click', importDialog);
  node.querySelectorAll('[data-metric]').forEach((metric) => {
    countUp(metric, Number(metric.dataset.metric), {
      decimals: Number(metric.dataset.decimals || 0), suffix: metric.dataset.suffix || '',
    });
  });
});

function hojeResumo() {
  const date = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return date.charAt(0).toUpperCase() + date.slice(1);
}
const level = (count) => (count === 0 ? 0 : count < 3 ? 1 : count < 8 ? 2 : count < 16 ? 3 : 4);
const sparkline = (activity) => activity.slice(-14)
  .map((day) => `<i style="height:${Math.min(100, 12 + day.count * 12)}%"></i>`).join('');

function lectureCard(lecture) {
  const [color, label] = STATUS_TAG[lecture.status] || ['blue', lecture.status];
  const job = lecture.job && lecture.status === 'processing' ? lecture.job : null;
  const card = el(`
    <article class="lecture-card" data-lecture="${lecture.id}" ${job ? `data-job-for="${lecture.id}"` : ''}>
      <div class="lecture-meta">
        <span class="tag ${color}"><span class="tag-dot"></span>${label}</span>
        ${lecture.course ? `<span>${esc(lecture.course.name)}</span>` : ''}
        <span>·</span><span>${relativeDate(lecture.startedAt)}</span>
      </div>
      <h3>${esc(lecture.title)}</h3>
      <div class="lecture-meta">
        <span>${minutesOf(lecture.durationMs)}</span>
        ${lecture.counts.cards ? `<span>· ${lecture.counts.cards} cards</span>` : ''}
        ${lecture.counts.questions ? `<span>· ${lecture.counts.questions} questões</span>` : ''}
      </div>
      ${job ? `<div class="lecture-progress"><i data-job-bar style="width:${job.progress}%"></i></div>
               <small class="micro" data-job-step>${esc(job.step)}</small>` : ''}
    </article>`);
  card.addEventListener('click', () => { location.hash = `#/aula/${lecture.id}`; });
  return card;
}

/* ═══════════════════════════════════════════════════════════
   Gravar
   ═══════════════════════════════════════════════════════════ */
route('gravar', async (node) => {
  setHeader('Gravar aula', 'Deixe rodando. Pode minimizar, trocar de aba ou anotar em outro app.');

  const canRecord = Boolean(pickMime()) && Boolean(navigator.mediaDevices?.getUserMedia);
  const courseOptions = state.courses.map((course) => `<option value="${course.id}">${esc(course.name)}</option>`).join('');

  const shell = el(`
    <div class="recorder">
      <section class="rec-stage">
        <div class="rec-state">
          <span class="pill" data-pill><i></i>pronto para gravar</span>
          <span class="pill" data-uploads hidden>nada enviado ainda</span>
        </div>
        <div class="rec-timer mono" data-timer>00:00:00</div>
        <canvas class="rec-wave" data-wave></canvas>

        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
          <div class="field">
            <label for="recTitle">Título da aula</label>
            <input class="input" id="recTitle" placeholder="ex.: Integrais definidas">
          </div>
          <div class="field">
            <label for="recCourse">Disciplina</label>
            <select class="select" id="recCourse">
              <option value="">Sem disciplina</option>${courseOptions}
              <option value="__new">+ nova disciplina…</option>
            </select>
          </div>
          <div class="field">
            <label for="recSource">Fonte do áudio</label>
            <select class="select" id="recSource">
              <option value="mic">Microfone (presencial)</option>
              <option value="tab">Áudio da aba (online)</option>
              <option value="both">Microfone + aba</option>
            </select>
          </div>
        </div>

        <div class="rec-controls">
          <button class="rec-button" data-toggle ${canRecord ? '' : 'disabled'} aria-label="Iniciar gravação"><span class="glyph"></span></button>
          <div class="stack gap-2" style="justify-content:center">
            <button class="btn btn-ghost" data-pause hidden>Pausar</button>
            <button class="btn btn-ghost" data-stop hidden>Encerrar e processar</button>
            <small class="micro" data-hint>${canRecord ? 'A gravação sobe em pedaços de 15 s. Se algo fechar, nada se perde.' : 'Este navegador não suporta gravação. Use Chrome, Edge ou Safari.'}</small>
          </div>
        </div>
      </section>

      <aside class="rec-side">
        <div class="live-transcript">
          <div class="between">
            <strong style="font-size:.95rem">Transcrição ao vivo</strong>
            <span class="tag ${speechSupported() ? 'green' : 'amber'}"><span class="tag-dot"></span>${speechSupported() ? 'ligada' : 'indisponível neste navegador'}</span>
          </div>
          <div class="transcript-box" data-transcript><span class="muted small">O texto aparece aqui conforme o professor fala.</span></div>
        </div>
        <div class="live-transcript">
          <div class="between"><strong style="font-size:.95rem">Envio do áudio</strong><span class="micro" data-bytes>0 KB</span></div>
          <div class="upload-log" data-log><span class="micro">nenhum pedaço enviado ainda</span></div>
        </div>
      </aside>
    </div>`);
  node.appendChild(shell);

  const ui = {
    pill: shell.querySelector('[data-pill]'),
    uploads: shell.querySelector('[data-uploads]'),
    timer: shell.querySelector('[data-timer]'),
    wave: shell.querySelector('[data-wave]'),
    toggle: shell.querySelector('[data-toggle]'),
    pause: shell.querySelector('[data-pause]'),
    stop: shell.querySelector('[data-stop]'),
    hint: shell.querySelector('[data-hint]'),
    transcript: shell.querySelector('[data-transcript]'),
    log: shell.querySelector('[data-log]'),
    bytes: shell.querySelector('[data-bytes]'),
    title: shell.querySelector('#recTitle'),
    course: shell.querySelector('#recCourse'),
    source: shell.querySelector('#recSource'),
  };


  ui.course.addEventListener('change', async () => {
    if (ui.course.value !== '__new') return;
    const name = prompt('Nome da disciplina:');
    ui.course.value = '';
    if (!name?.trim()) return;
    const { course } = await api.createCourse({ name: name.trim() });
    state.courses.push(course);
    ui.course.insertBefore(el(`<option value="${course.id}">${esc(course.name)}</option>`), ui.course.lastElementChild);
    ui.course.value = course.id;
    toast(`Disciplina "${course.name}" criada.`, 'ok');
  });

  // A onda respira de leve mesmo parada — e passa a mostrar o áudio real ao gravar.
  const idle = new Uint8Array(64);
  audioBars(ui.wave, () => {
    const recorder = state.recorder;
    if (recorder && recorder.state === 'recording') return recorder.getLevels();
    const time = Date.now() / 600;
    for (let i = 0; i < idle.length; i++) idle[i] = 8 + Math.abs(Math.sin(time + i / 5)) * 14;
    return idle;
  }, { bars: 56, color: '#141413' });

  let totalBytes = 0;
  const attach = (recorder) => {
    recorder.addEventListener('tick', () => { ui.timer.textContent = formatDuration(recorder.elapsedMs); });
    recorder.addEventListener('transcript', (event) => {
      const { text, interim } = event.detail;
      ui.transcript.innerHTML = `${esc(text)} <span class="interim">${esc(interim)}</span>`;
      ui.transcript.scrollTop = ui.transcript.scrollHeight;
    });
    recorder.addEventListener('uploaded', (event) => {
      if (event.detail.index < 0) return;
      totalBytes += event.detail.bytes;
      ui.bytes.textContent = `${(totalBytes / 1024).toFixed(0)} KB`;
      ui.uploads.hidden = false;
      const total = event.detail.index + 1;
      ui.uploads.textContent = total === 1 ? '1 pedaço enviado' : `${total} pedaços enviados`;
      const line = el(`<div><b>✓</b> pedaço ${event.detail.index + 1} · ${(event.detail.bytes / 1024).toFixed(0)} KB</div>`);
      if (ui.log.firstElementChild?.classList.contains('micro')) ui.log.innerHTML = '';
      ui.log.prepend(line);
      animate(line, { opacity: [0, 1], translateX: [-10, 0], duration: 400, easing: 'swift' });
    });
    recorder.addEventListener('retrying', (event) => {
      toast(`Sem conexão. Tentando enviar de novo em ${event.detail.wait / 1000} s`, 'warn', 2600);
    });
    recorder.addEventListener('chunk-failed', () => {
      toast('Um pedaço do áudio não subiu. Vamos tentar de novo ao encerrar.', 'warn', 6000);
    });
    recorder.addEventListener('speech-off', () => {
      toast('A transcrição ao vivo precisa de permissão do microfone no navegador.', 'warn', 6000);
    });
  };

  const setRecordingUI = (recording, paused = false) => {
    ui.toggle.classList.toggle('recording', recording);
    ui.toggle.setAttribute('aria-label', recording ? 'Encerrar gravação' : 'Iniciar gravação');
    ui.pause.hidden = !recording;
    ui.stop.hidden = !recording;
    ui.pause.textContent = paused ? 'Retomar' : 'Pausar';
    ui.pill.className = `pill ${recording && !paused ? 'live' : ''}`;
    ui.pill.innerHTML = recording
      ? `<i></i>${paused ? 'pausada' : 'gravando, pode minimizar'}`
      : '<i></i>pronto para gravar';
    [ui.title, ui.course, ui.source].forEach((input) => { input.disabled = recording; });
  };

  /* Já existe gravação rolando (o usuário só mudou de tela) */
  if (state.recorder && state.recorder.state !== 'idle') {
    attach(state.recorder);
    setRecordingUI(true, state.recorder.state === 'paused');
    ui.title.value = state.recorder.lecture?.title || '';
    ui.transcript.innerHTML = esc(state.recorder.transcriptBuffer) || '<span class="muted small">Ouvindo…</span>';
  }

  const start = async () => {
    try {
      ui.hint.textContent = 'Pedindo acesso ao áudio…';
      const recorder = new LectureRecorder({
        chunkSeconds: Number(state.settings.chunkSeconds) || 15,
        liveTranscript: state.settings.liveTranscript !== false,
      });
      state.recorder = recorder;
      attach(recorder);
      await recorder.start({
        courseId: ui.course.value || null,
        title: ui.title.value.trim(),
        source: ui.source.value,
      });
      setRecordingUI(true);
      ui.hint.textContent = 'Gravando. Pode fechar esta tela, mas não a aba.';
      animate(ui.toggle, { scale: [1, 1.12, 1], duration: 680, easing: 'elastic.out' });
      toast('Gravação iniciada. Bom estudo!', 'ok');
      await refreshLectures();
    } catch (error) {
      state.recorder = null;
      ui.hint.textContent = error.message;
      toast(error.message, 'error', 6500);
    }
  };

  const finish = async () => {
    const recorder = state.recorder;
    if (!recorder) return;
    ui.hint.textContent = 'Encerrando e enviando o que faltava…';
    ui.toggle.disabled = true;
    try {
      const result = await recorder.stop({ autoProcess: state.settings.autoPipeline !== false });
      state.recorder = null;
      setRecordingUI(false);
      ui.toggle.disabled = false;
      await refreshLectures();
      toast('Aula salva. A IA já está trabalhando.', 'ok');
      if (result?.lecture) location.hash = `#/aula/${result.lecture.id}`;
    } catch (error) {
      ui.toggle.disabled = false;
      toast(`Não consegui encerrar: ${error.message}`, 'error', 7000);
    }
  };

  ui.toggle.addEventListener('click', () => {
    if (state.recorder && state.recorder.state !== 'idle') finish();
    else start();
  });
  ui.stop.addEventListener('click', finish);
  ui.pause.addEventListener('click', () => {
    const recorder = state.recorder;
    if (!recorder) return;
    if (recorder.state === 'recording') { recorder.pause(); setRecordingUI(true, true); }
    else { recorder.resume(); setRecordingUI(true, false); }
  });
});

/* ═══════════════════════════════════════════════════════════
   Lista de aulas
   ═══════════════════════════════════════════════════════════ */
route('aulas', async (node) => {
  await refreshLectures();
  setHeader('Minhas aulas', state.search
    ? `${state.lectures.length} resultado(s) para "${state.search}"`
    : `${state.lectures.length} aula(s) guardada(s)`);

  const header = el(`
    <div class="between" style="margin-bottom:6px">
      <div class="chips" data-filters></div>
      <button class="btn btn-ghost btn-sm" data-import>Importar texto</button>
    </div>`);
  const filters = header.querySelector('[data-filters]');
  filters.appendChild(el('<button class="tag" data-course="">todas</button>'));
  state.courses.forEach((course) => filters.appendChild(el(`<button class="tag ${course.color}" data-course="${course.id}">${esc(course.name)}</button>`)));
  node.appendChild(header);
  header.querySelector('[data-import]').addEventListener('click', importDialog);

  const grid = el('<div class="cards"></div>');
  node.appendChild(grid);

  const draw = (courseId) => {
    grid.innerHTML = '';
    const list = courseId ? state.lectures.filter((item) => item.course?.id === courseId) : state.lectures;
    if (!list.length) {
      grid.appendChild(el('<div class="empty"><div class="ring">·</div><p>Nada por aqui ainda.</p><a class="btn btn-primary" href="#/gravar">Gravar uma aula</a></div>'));
      return;
    }
    list.forEach((lecture) => grid.appendChild(lectureCard(lecture)));
    set([...grid.children], { opacity: 0, translateY: 18 });
    animate([...grid.children], { opacity: 1, translateY: 0, duration: 700, delay: stagger(45), easing: 'swift' });
  };
  draw('');

  filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-course]');
    if (!button) return;
    filters.querySelectorAll('[data-course]').forEach((tag) => tag.style.opacity = '.55');
    button.style.opacity = '1';
    draw(button.dataset.course);
  });
  filters.firstElementChild.style.opacity = '1';
});

async function importDialog() {
  const back = el(`
    <div class="modal-back">
      <div class="modal">
        <h3>Importar aula em texto</h3>
        <p class="muted small">Cole a transcrição, o PDF da aula em texto ou suas anotações. A IA monta resumo, apontamentos, flashcards e quiz.</p>
        <div class="field"><label for="impTitle">Título</label><input class="input" id="impTitle" placeholder="ex.: Termodinâmica, 2ª lei"></div>
        <div class="field"><label for="impText">Conteúdo</label><textarea class="textarea" id="impText" rows="9" placeholder="Cole aqui…"></textarea></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-no>Cancelar</button>
          <button class="btn btn-primary" data-yes>Gerar material</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(back);
  animate(back, { opacity: [0, 1], duration: 240 });
  animate(back.querySelector('.modal'), { opacity: [0, 1], scale: [0.95, 1], translateY: [20, 0], duration: 620, easing: 'swift' });

  const close = () => animate(back, { opacity: 0, duration: 200, onComplete: () => back.remove() });
  back.querySelector('[data-no]').onclick = close;
  back.onclick = (event) => { if (event.target === back) close(); };
  back.querySelector('[data-yes]').onclick = async (event) => {
    const button = event.currentTarget;
    const title = back.querySelector('#impTitle').value.trim();
    const transcript = back.querySelector('#impText').value.trim();
    button.disabled = true; button.textContent = 'Enviando…';
    try {
      const { lecture } = await api.importLecture({ title, transcript });
      close();
      toast('Importada! A IA está montando o material.', 'ok');
      await refreshLectures();
      location.hash = `#/aula/${lecture.id}`;
    } catch (error) {
      button.disabled = false; button.textContent = 'Gerar material';
      toast(error.message, 'error', 6000);
    }
  };
}

/* ═══════════════════════════════════════════════════════════
   Detalhe da aula
   ═══════════════════════════════════════════════════════════ */
route('aula', async (node, params) => {
  const id = params[0];
  const data = await api.lecture(id);
  const { lecture, outputs, transcript, flashcards, questions } = data;
  setHeader(lecture.title, `${new Date(lecture.startedAt).toLocaleString('pt-BR')} · ${minutesOf(lecture.durationMs)}`);

  const [color, label] = STATUS_TAG[lecture.status] || ['blue', lecture.status];
  const head = el(`
    <header class="lecture-head">
      <div class="lecture-meta">
        <span class="tag ${color}"><span class="tag-dot"></span>${label}</span>
        ${lecture.course ? `<span class="tag">${esc(lecture.course.name)}</span>` : ''}
        ${outputs.meta?.engine ? `<span class="tag ${outputs.meta.engine === 'claude' ? 'violet' : ''}">${outputs.meta.engine === 'claude' ? 'gerado pelo Claude' : 'motor local'}</span>` : ''}
        ${lecture.transcriptChars ? `<span class="micro">${lecture.transcriptChars.toLocaleString('pt-BR')} caracteres transcritos</span>` : ''}
      </div>
      <div class="title-row">
        <h2 contenteditable="plaintext-only" data-title>${esc(lecture.title)}</h2>
        <div class="lecture-actions">
          <a class="btn btn-ghost btn-sm" href="${api.exportUrl(lecture.id)}" download>Exportar .md</a>
          <button class="btn btn-ghost btn-sm" data-reprocess>Reprocessar</button>
          <button class="btn btn-danger btn-sm" data-delete>Apagar</button>
        </div>
      </div>
    </header>`);
  node.appendChild(head);

  /* progresso, quando ainda está processando */
  if (lecture.status === 'processing' || lecture.job?.status === 'running') {
    node.appendChild(el(`
      <div class="job-card" data-job-for="${lecture.id}">
        <div class="between"><strong>A IA está montando seu material</strong><span class="micro" data-job-step>${esc(lecture.job?.step || 'na fila')}</span></div>
        <ol class="stepper" data-stepper>
          ${[['Juntar áudio', 15], ['Transcrever', 50], ['IA estudando', 85], ['Material pronto', 100]].map(([name, at]) =>
            `<li data-at="${at}" class="${(lecture.job?.progress || 0) >= at ? 'done' : ''}"><i></i><span>${name}</span></li>`).join('')}
        </ol>
        <div class="job-bar"><i data-job-bar style="width:${lecture.job?.progress || 4}%"></i></div>
        <small class="micro">Pode sair desta tela. Avisamos quando ficar pronto.</small>
      </div>`));
  }
  if (lecture.status === 'needs_transcript') {
    const box = el(`
      <div class="job-card">
        <strong>Faltou transcrição nesta aula</strong>
        <p class="small muted">A gravação existe, mas não veio texto suficiente. Cole a transcrição (ou suas anotações) e a IA gera o material.</p>
        <textarea class="textarea" data-fix placeholder="Cole aqui o texto da aula…"></textarea>
        <div class="row gap-2"><button class="btn btn-primary btn-sm" data-fix-save>Salvar e processar</button></div>
      </div>`);
    node.appendChild(box);
    box.querySelector('[data-fix-save]').addEventListener('click', async (event) => {
      const text = box.querySelector('[data-fix]').value.trim();
      if (text.length < 80) return toast('Cole um texto um pouco maior.', 'warn');
      event.currentTarget.disabled = true;
      await api.updateLecture(lecture.id, { transcript: text });
      await api.processLecture(lecture.id);
      toast('Mandamos para a IA!', 'ok');
      render();
    });
  }

  /* abas */
  const tabs = [
    ['resumo', 'Resumo'],
    ['apontamentos', 'Apontamentos'],
    ['revisao', 'Revisão'],
    ['cards', `Flashcards${flashcards.length ? ` (${flashcards.length})` : ''}`],
    ['quiz', `Quiz${questions.length ? ` (${questions.length})` : ''}`],
    ['transcricao', 'Transcrição'],
    ['audio', 'Áudio'],
    ['perguntar', 'Perguntar'],
  ];
  const tabBar = el(`<div class="tabs">${tabs.map(([key, name], i) =>
    `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${key}">${name}</button>`).join('')}</div>`);
  const panel = el('<div class="tab-panel"></div>');
  node.append(tabBar, panel);

  const renderTab = (key) => {
    panel.innerHTML = '';
    panel.appendChild(tabContent(key, data));
    set(panel, { opacity: 0, translateY: 12 });
    animate(panel, { opacity: 1, translateY: 0, duration: 520, easing: 'swift' });
    const items = [...panel.querySelectorAll('.prose > *, .glossary > div, .quiz-question, .ask-item')].slice(0, 20);
    if (items.length) {
      set(items, { opacity: 0, translateY: 14 });
      animate(items, { opacity: 1, translateY: 0, duration: 620, delay: stagger(45), easing: 'swift' });
    }
    wireTab(key, panel, data);
  };

  tabBar.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    tabBar.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
    renderTab(tab.dataset.tab);
  });
  renderTab(lecture.status === 'ready' ? 'resumo' : 'transcricao');

  /* ações do cabeçalho */
  const titleEl = head.querySelector('[data-title]');
  titleEl.addEventListener('blur', async () => {
    const title = titleEl.textContent.trim();
    if (!title || title === lecture.title) return;
    await api.updateLecture(lecture.id, { title });
    await refreshLectures();
    toast('Título atualizado.', 'ok');
  });
  head.querySelector('[data-reprocess]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    await api.processLecture(lecture.id);
    toast('Reprocessando com a IA…', 'ok');
    render();
  });
  head.querySelector('[data-delete]').addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Apagar esta aula?', body: 'O áudio, a transcrição e todo o material gerado somem. Não dá para desfazer.',
      confirm: 'Apagar', danger: true,
    });
    if (!yes) return;
    await api.deleteLecture(lecture.id);
    await Promise.all([refreshLectures(), refreshStats()]);
    toast('Aula apagada.', 'ok');
    location.hash = '#/aulas';
  });
});

function tabContent(key, data) {
  const { lecture, outputs, transcript, flashcards, questions } = data;
  const empty = (text) => el(`<div class="empty"><div class="ring">·</div><p>${esc(text)}</p></div>`);

  if (key === 'resumo') {
    const summary = outputs.summary;
    if (!summary) return empty('O resumo aparece assim que a IA terminar.');
    return el(`
      <div class="prose">
        <div class="tldr">${esc(summary.tldr)}</div>
        ${summary.abstract ? `<p>${esc(summary.abstract)}</p>` : ''}
        ${summary.highlights?.length ? `<h3>Pontos essenciais</h3><ul>${summary.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${summary.keywords?.length ? `<h3>Termos-chave</h3><div class="chips">${summary.keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}
        ${outputs.meta?.gaps?.length ? `<h3>Vale confirmar com o professor</h3><ul>${outputs.meta.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      </div>`);
  }

  if (key === 'apontamentos') {
    const sections = outputs.notes?.sections || [];
    const glossary = outputs.glossary || [];
    if (!sections.length) return empty('Os apontamentos aparecem depois do processamento.');
    return el(`
      <div class="prose">
        ${sections.map((section) => `
          <h3>${esc(section.heading)}</h3>
          <ul>${section.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`).join('')}
        ${glossary.length ? `<h3>Glossário</h3><div class="glossary">${glossary.map((g) =>
          `<div><strong>${esc(g.term)}</strong><p>${esc(g.definition)}</p></div>`).join('')}</div>` : ''}
      </div>`);
  }

  if (key === 'revisao') {
    const review = outputs.review;
    if (!review) return empty('O plano de revisão aparece depois do processamento.');
    return el(`
      <div class="prose">
        ${review.examFocus?.length ? `<h3>Foco para a prova</h3><ul>${review.examFocus.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${review.commonMistakes?.length ? `<h3>Erros comuns</h3><ul>${review.commonMistakes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${review.studyPlan?.length ? `<h3>Plano de estudo</h3><ul>${review.studyPlan.map((p) =>
          `<li><strong>${esc(p.day)}:</strong> ${esc(p.task)}</li>`).join('')}</ul>` : ''}
      </div>`);
  }

  if (key === 'cards') {
    if (!flashcards.length) return empty('Nenhum flashcard gerado ainda.');
    return el(`
      <div class="prose">
        <p class="small muted">Estes cards entram na sua fila de revisão espaçada.
          <a href="#/revisar" style="color:var(--accent)">Revisar agora →</a></p>
        <div class="glossary">${flashcards.map((card) =>
          `<div><strong>${esc(card.front)}</strong><p>${esc(card.back)}</p></div>`).join('')}</div>
      </div>`);
  }

  if (key === 'quiz') {
    if (!questions.length) return empty('Nenhuma questão gerada ainda.');
    const node = el('<div class="quiz"></div>');
    questions.forEach((question, index) => node.appendChild(questionCard(question, index, lecture.id)));
    return node;
  }

  if (key === 'transcricao') {
    if (!transcript?.trim()) return empty('Sem transcrição. Grave com a transcrição ao vivo ligada ou cole o texto da aula.');
    return el(`<div class="transcript-full">${esc(transcript)}</div>`);
  }

  if (key === 'audio') {
    if (!lecture.hasAudio) return empty('Esta aula não tem áudio salvo (foi importada como texto).');
    return el(`
      <div class="prose">
        <p class="small muted">${(lecture.sizeBytes / 1048576).toFixed(1)} MB · ${minutesOf(lecture.durationMs)}</p>
        <audio controls preload="metadata" src="${api.audioUrl(lecture.id)}"></audio>
      </div>`);
  }

  if (key === 'perguntar') {
    return el(`
      <div class="ask-box">
        <div class="field">
          <label for="askInput">Pergunte qualquer coisa sobre esta aula</label>
          <textarea class="textarea" id="askInput" rows="3" placeholder="ex.: o professor falou qual condição para o teorema?"></textarea>
        </div>
        <div class="row gap-2"><button class="btn btn-primary" data-ask>Perguntar</button>
          <small class="micro">${state.capabilities.ai ? 'Responde com o Claude, usando só a sua aula.' : 'Sem chave de IA: devolve os trechos mais relevantes da transcrição.'}</small></div>
        <div class="ask-log" data-ask-log></div>
      </div>`);
  }
  return empty('—');
}

function questionCard(question, index, lectureId) {
  const card = el(`
    <article class="quiz-question">
      <div class="q">${index + 1}. ${esc(question.prompt)}</div>
      <div class="options">${question.options.map((option, i) =>
        `<button class="option" data-option="${i}"><span class="key">${String.fromCharCode(65 + i)}</span>${esc(option)}</button>`).join('')}</div>
      <div class="explain" hidden></div>
    </article>`);

  card.addEventListener('click', async (event) => {
    const button = event.target.closest('.option');
    if (!button || card.dataset.done) return;
    card.dataset.done = '1';
    const chosen = Number(button.dataset.option);
    const correct = chosen === question.answer;
    card.querySelectorAll('.option').forEach((option, i) => {
      option.disabled = true;
      if (i === question.answer) option.classList.add('correct');
      else if (i === chosen) option.classList.add('wrong');
    });
    const explain = card.querySelector('.explain');
    explain.hidden = false;
    explain.textContent = question.explanation || (correct ? 'Isso mesmo.' : 'Reveja os apontamentos desta aula.');
    animate(explain, { opacity: [0, 1], translateY: [-8, 0], duration: 440, easing: 'swift' });
    animate(card, correct
      ? { scale: [1, 1.012, 1], duration: 420 }
      : { translateX: [0, -7, 6, -3, 0], duration: 420 });
    await api.saveAttempt({ lectureId, correct: correct ? 1 : 0, total: 1 });
    refreshStats();
  });
  return card;
}

function wireTab(key, panel, data) {
  if (key !== 'perguntar') return;
  const input = panel.querySelector('#askInput');
  const log = panel.querySelector('[data-ask-log]');
  panel.querySelector('[data-ask]').addEventListener('click', async (event) => {
    const question = input.value.trim();
    if (!question) return;
    const button = event.currentTarget;
    button.disabled = true;
    const original = button.textContent;
    button.innerHTML = '<span class="spinner"></span> pensando…';
    log.prepend(el(`<div class="ask-item q"><p>${esc(question)}</p></div>`));
    input.value = '';
    try {
      const answer = await api.askLecture(data.lecture.id, question);
      const node = el(`<div class="ask-item"><p>${esc(answer.answer)}</p></div>`);
      log.insertBefore(node, log.firstElementChild.nextSibling);
      animate(node, { opacity: [0, 1], translateY: [10, 0], duration: 520, easing: 'swift' });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   Revisar (repetição espaçada)
   ═══════════════════════════════════════════════════════════ */
route('revisar', async (node) => {
  const { cards, pending } = await api.queue({ limit: 30 });
  setHeader('Revisar', pending ? `${pending} card(s) vencendo agora` : 'Fila em dia');

  if (!cards.length) {
    node.appendChild(el(`
      <div class="empty">
        <div class="ring">·</div>
        <p>Nada para revisar agora. A repetição espaçada traz os cards de volta no momento certo.</p>
        <a class="btn btn-ghost" href="#/aulas">Ver minhas aulas</a>
      </div>`));
    return;
  }

  const stage = el(`
    <div class="study">
      <div class="study-progress"><i style="width:0%"></i></div>
      <div class="between" style="width:100%">
        <span class="micro" data-counter>1 de ${cards.length}</span>
        <span class="micro" data-from></span>
      </div>
      <div class="card-stage">
        <div class="study-ghost g2" data-ghost="2"></div>
        <div class="study-ghost g1" data-ghost="1"></div>
        <div class="study-card" data-card tabindex="0" role="button" aria-label="Mostrar resposta">
          <div class="face front"><span class="micro">pergunta</span><p class="q" data-front></p><span class="micro">clique ou espaço para virar</span></div>
          <div class="face back"><span class="micro">resposta</span><p class="a" data-back></p></div>
        </div>
      </div>
      <div class="grade-row" data-grades hidden>
        <button class="grade-btn" data-grade="0"><strong>Errei</strong><small>10 min</small></button>
        <button class="grade-btn" data-grade="1"><strong>Difícil</strong><small>em breve</small></button>
        <button class="grade-btn" data-grade="2"><strong>Bom</strong><small>no ritmo</small></button>
        <button class="grade-btn" data-grade="3"><strong>Fácil</strong><small>mais tarde</small></button>
      </div>
    </div>`);
  node.appendChild(stage);

  const card = stage.querySelector('[data-card]');
  const front = stage.querySelector('[data-front]');
  const back = stage.querySelector('[data-back]');
  const grades = stage.querySelector('[data-grades]');
  const counter = stage.querySelector('[data-counter]');
  const from = stage.querySelector('[data-from]');
  const progress = stage.querySelector('.study-progress i');

  let index = 0;
  const show = (i) => {
    const item = cards[i];
    front.textContent = item.front;
    back.textContent = item.back;
    from.textContent = item.lecture.title;
    counter.textContent = `${i + 1} de ${cards.length}`;
    progress.style.width = `${(i / cards.length) * 100}%`;
    card.classList.remove('flipped');
    grades.hidden = true;
    const remaining = cards.length - i - 1;
    stage.querySelectorAll('[data-ghost]').forEach((ghost) => { ghost.hidden = remaining < Number(ghost.dataset.ghost); });
    // a ficha de trás vem para a frente
    animate(card, { opacity: [0, 1], translateY: [14, 0], scale: [0.96, 1], duration: 560, easing: 'swift' });
  };

  const flip = () => {
    card.classList.toggle('flipped');
    if (card.classList.contains('flipped')) {
      grades.hidden = false;
      set([...grades.children], { opacity: 0, translateY: 12 });
      animate([...grades.children], { opacity: 1, translateY: 0, duration: 480, delay: stagger(50), easing: 'swift' });
    }
  };

  const grade = async (value) => {
    const item = cards[index];
    grades.hidden = true;
    await animate(card, { opacity: 0, translateX: value === 0 ? -80 : 80, rotate: value === 0 ? -4 : 4, duration: 360, easing: 'appleIn' }).finished;
    set(card, { translateX: 0, rotate: 0 });
    try { await api.review(item.id, value); } catch (error) { toast(error.message, 'error'); }

    index++;
    if (index >= cards.length) {
      await refreshStats();
      stage.replaceWith(el(`
        <div class="empty">
          <div class="ring">✓</div>
          <p><strong>${cards.length} cards revisados.</strong> Os que você errou voltam em minutos; os fáceis, só daqui a dias.</p>
          <div class="row gap-2">
            <a class="btn btn-primary" href="#/quiz">Fazer um quiz</a>
            <a class="btn btn-ghost" href="#/inicio">Voltar ao início</a>
          </div>
        </div>`));
      return;
    }
    show(index);
  };

  card.addEventListener('click', flip);
  card.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); flip(); }
  });
  grades.addEventListener('click', (event) => {
    const button = event.target.closest('[data-grade]');
    if (button) grade(Number(button.dataset.grade));
  });
  const keys = (event) => {
    if (!document.body.contains(stage)) return document.removeEventListener('keydown', keys);
    if (!card.classList.contains('flipped')) return;
    if (['1', '2', '3', '4'].includes(event.key)) grade(Number(event.key) - 1);
  };
  document.addEventListener('keydown', keys);

  show(0);
  card.focus();
});

/* ═══════════════════════════════════════════════════════════
   Quiz
   ═══════════════════════════════════════════════════════════ */
route('quiz', async (node) => {
  const { questions } = await api.quiz({ limit: 12 });
  setHeader('Quiz', questions.length ? `${questions.length} questões das suas aulas` : 'Sem questões ainda');

  if (!questions.length) {
    node.appendChild(el(`
      <div class="empty"><div class="ring">?</div>
        <p>As questões nascem das suas aulas processadas. Grave (ou importe) uma aula para começar.</p>
        <a class="btn btn-primary" href="#/gravar">Gravar aula</a>
      </div>`));
    return;
  }
  const quiz = el('<div class="quiz"></div>');
  questions.forEach((question, index) => quiz.appendChild(questionCard(question, index, question.lectureId)));
  quiz.appendChild(el(`<p class="micro center">Respondeu tudo? O placar entra na sua média de acerto.</p>`));
  node.appendChild(quiz);
});

/* ═══════════════════════════════════════════════════════════
   Ajustes
   ═══════════════════════════════════════════════════════════ */
route('ajustes', async (node) => {
  setHeader('Ajustes', 'Como o Better Class se comporta na sua máquina');
  const settings = state.settings;

  const save = async (patch) => {
    const { user } = await api.updateMe(patch);
    state.user = user;
    state.settings = user.settings;
    applySettings();
    toast('Preferência salva.', 'ok', 2200);
  };

  const box = el(`
    <div class="settings">
      <div class="setting-row">
        <div class="txt"><strong>Processar automaticamente ao encerrar</strong>
          <small>Assim que você para a gravação, a esteira de IA dispara sozinha.</small></div>
        <label class="switch"><input type="checkbox" data-set="autoPipeline" ${settings.autoPipeline !== false ? 'checked' : ''}><span class="track"></span></label>
      </div>
      <div class="setting-row">
        <div class="txt"><strong>Transcrição ao vivo no navegador</strong>
          <small>${speechSupported() ? 'Transcreve enquanto o professor fala, sem custo de API.' : 'Seu navegador não tem essa API. Use Chrome ou Edge.'}</small></div>
        <label class="switch"><input type="checkbox" data-set="liveTranscript" ${settings.liveTranscript !== false ? 'checked' : ''} ${speechSupported() ? '' : 'disabled'}><span class="track"></span></label>
      </div>
      <div class="setting-row">
        <div class="txt"><strong>Tamanho do pedaço de áudio</strong>
          <small>De quanto em quanto tempo o áudio sobe para o servidor.</small></div>
        <select class="select" data-set="chunkSeconds">
          ${[10, 15, 30, 60].map((n) => `<option value="${n}" ${Number(settings.chunkSeconds || 15) === n ? 'selected' : ''}>${n}s</option>`).join('')}
        </select>
      </div>
      <div class="setting-row">
        <div class="txt"><strong>Reduzir animações</strong><small>Desliga os movimentos mais longos da interface.</small></div>
        <label class="switch"><input type="checkbox" data-set="reduceMotion" ${settings.reduceMotion ? 'checked' : ''}><span class="track"></span></label>
      </div>

      <div class="setting-row">
        <div class="txt"><strong>Motor de IA</strong>
          <small>${state.capabilities.ai
            ? 'Claude conectado. Resumos e questões gerados pela IA.'
            : 'Sem ANTHROPIC_API_KEY: usando o motor local extrativo. Configure a chave no .env do servidor para ligar o Claude.'}</small></div>
        <span class="tag ${state.capabilities.ai ? 'green' : 'amber'}"><span class="tag-dot"></span>${state.capabilities.ai ? 'Claude' : 'local'}</span>
      </div>
      <div class="setting-row">
        <div class="txt"><strong>Transcrição no servidor</strong>
          <small>${state.capabilities.serverTranscription
            ? 'Whisper configurado. O áudio é reprocessado no servidor quando a transcrição do navegador falha.'
            : 'Desligada. Defina TRANSCRIBE_URL e TRANSCRIBE_KEY no .env para ativar.'}</small></div>
        <span class="tag ${state.capabilities.serverTranscription ? 'green' : ''}"><span class="tag-dot"></span>${state.capabilities.serverTranscription ? 'ligada' : 'desligada'}</span>
      </div>

      <div class="setting-row">
        <div class="txt"><strong>Disciplinas</strong><small>${state.courses.map((c) => esc(c.name)).join(' · ') || 'nenhuma ainda'}</small></div>
        <button class="btn btn-ghost btn-sm" data-add-course>Adicionar</button>
      </div>
      <div class="setting-row">
        <div class="txt"><strong>Conta</strong><small>${esc(state.user.email)} · desde ${new Date(state.user.createdAt).toLocaleDateString('pt-BR')}</small></div>
        <button class="btn btn-ghost btn-sm" data-logout>Sair</button>
      </div>
    </div>`);
  node.appendChild(box);

  box.querySelectorAll('[data-set]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.set;
      const value = input.type === 'checkbox' ? input.checked : (key === 'chunkSeconds' ? Number(input.value) : input.value);
      save({ [key]: value });
    });
  });
  box.querySelector('[data-add-course]').addEventListener('click', async () => {
    const name = prompt('Nome da disciplina:');
    if (!name?.trim()) return;
    const { course } = await api.createCourse({ name: name.trim() });
    state.courses.push(course);
    toast(`"${course.name}" adicionada.`, 'ok');
    render();
  });
  box.querySelector('[data-logout]').addEventListener('click', () => document.getElementById('logout').click());
});

/* ── Partida ──────────────────────────────────────────────── */
boot();
