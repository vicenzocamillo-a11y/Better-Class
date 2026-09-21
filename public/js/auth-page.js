import { animate, set, stagger, timeline } from './motion.js';
import { aurora, spotlight, ripple, revealText } from './effects.js';
import { api } from './api.js';

aurora(document.getElementById('aurora'), { blobs: 3 });
document.querySelectorAll('[data-spotlight]').forEach(spotlight);
document.querySelectorAll('[data-ripple]').forEach(ripple);

/* Entrada da página */
set('.auth-card, .auth-list li, .auth-pitch .lead, .back-home', { opacity: 0, translateY: 24, blur: 6 });
requestAnimationFrame(() => {
  revealText(document.getElementById('pitchTitle'), { by: 'words', step: 36, delay: 80 });
  timeline({ easing: 'swift', duration: 900 })
    .add('.auth-pitch .lead', { opacity: 1, translateY: 0, blur: 0 }, 260)
    .add('.auth-list li', { opacity: 1, translateY: 0, blur: 0, delay: stagger(80) }, 380)
    .add('.auth-card', { opacity: 1, translateY: 0, blur: 0, duration: 1100 }, 180)
    .add('.back-home', { opacity: 1, translateY: 0, blur: 0 }, 700)
    .play();
});

/* Alternar entre entrar e criar conta */
const googleBtn = document.getElementById('googleBtn');
const googleLabel = document.getElementById('googleLabel');
const divider = document.getElementById('divider');
const form = document.getElementById('form');
const nameField = document.getElementById('nameField');
const nameInput = document.getElementById('name');
const password = document.getElementById('password');
const submit = document.getElementById('submit');
const errorBox = document.getElementById('error');
const pill = document.getElementById('tabPill');
const hint = document.getElementById('switchHint');

/* O botão do Google só aparece se o servidor tiver as credenciais */
api.authConfig()
  .then(({ google }) => {
    if (!google) return;
    googleBtn.hidden = false;
    divider.hidden = false;
    set(googleBtn, { opacity: 0, translateY: 8 });
    animate(googleBtn, { opacity: 1, translateY: 0, duration: 520, easing: 'swift' });
  })
  .catch(() => {});

googleBtn.addEventListener('click', () => {
  googleBtn.disabled = true;
  googleLabel.textContent = 'Abrindo o Google…';
  location.href = '/api/auth/google';
});

/* Quando o Google devolve um erro, ele volta na URL */
const MOTIVOS = {
  'google-desligado': 'O login com o Google não está configurado neste servidor.',
  'google-cancelado': 'Você cancelou a autorização no Google.',
  'estado-invalido': 'A sessão de login expirou. Tente novamente.',
  'sem-codigo': 'O Google não devolveu o código de autorização.',
  'google-falhou': 'Não consegui concluir o login pelo Google. Tente de novo.',
};

let mode = location.pathname === '/criar-conta' ? 'register' : 'login';

function setMode(next) {
  mode = next;
  const isRegister = mode === 'register';
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    const active = tab.dataset.tab === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  pill.classList.toggle('right', isRegister);
  nameField.hidden = !isRegister;
  if (isRegister) {
    set(nameField, { opacity: 0, translateY: -8 });
    animate(nameField, { opacity: 1, translateY: 0, duration: 520, easing: 'swift' });
  }
  password.autocomplete = isRegister ? 'new-password' : 'current-password';
  submit.querySelector('.label').textContent = isRegister ? 'Criar conta' : 'Entrar';
  googleLabel.textContent = isRegister ? 'Criar conta com o Google' : 'Continuar com o Google';
  hint.innerHTML = isRegister
    ? 'Já tem conta? <button type="button" class="linkish" data-goto="login">Entrar</button>'
    : 'Ainda não tem conta? <button type="button" class="linkish" data-goto="register">Criar agora</button>';
  errorBox.hidden = true;
  history.replaceState({}, '', isRegister ? '/criar-conta' : '/entrar');
  document.title = `${isRegister ? 'Criar conta' : 'Entrar'} · Better Class`;
}

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.auth-tab');
  if (tab) setMode(tab.dataset.tab);
  const link = event.target.closest('[data-goto]');
  if (link) setMode(link.dataset.goto);
});
setMode(mode);

const motivo = new URLSearchParams(location.search).get('erro');
if (motivo) {
  showError(MOTIVOS[motivo] || 'Não consegui entrar. Tente novamente.');
  history.replaceState({}, '', location.pathname);
}

/* Envio */
function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  set(errorBox, { opacity: 0, translateY: -6 });
  animate(errorBox, { opacity: 1, translateY: 0, duration: 420, easing: 'swift' });
  animate('.auth-card', { translateX: [0, -9, 8, -5, 0], duration: 460, easing: 'quad.out' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const data = {
    email: document.getElementById('email').value.trim(),
    password: password.value,
    ...(mode === 'register' ? { name: nameInput.value.trim() } : {}),
  };
  submit.disabled = true;
  const label = submit.querySelector('.label').textContent;
  submit.querySelector('.label').textContent = mode === 'register' ? 'Criando…' : 'Entrando…';
  try {
    if (mode === 'register') await api.register(data);
    else await api.login(data);
    await animate('.auth-card', { scale: 0.97, opacity: 0, blur: 8, duration: 420, easing: 'appleIn' }).finished;
    location.href = '/app';
  } catch (error) {
    showError(error.message || 'Não deu certo. Tente de novo.');
    submit.disabled = false;
    submit.querySelector('.label').textContent = label;
  }
});

/* Se já estiver logado, vai direto para o app */
api.me().then(() => { location.href = '/app'; }).catch(() => {});
