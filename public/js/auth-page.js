import { animate, reducedMotion } from './motion.js';
import { api } from './api.js';

const form = document.getElementById('form');
const nameField = document.getElementById('nameField');
const nameInput = document.getElementById('name');
const password = document.getElementById('password');
const submit = document.getElementById('submit');
const errorBox = document.getElementById('error');
const intro = document.getElementById('intro');
const googleBtn = document.getElementById('googleBtn');
const googleLabel = document.getElementById('googleLabel');
const divider = document.getElementById('divider');

/* Mensagens de volta do Google, quando algo não deu certo */
const MOTIVOS = {
  'google-desligado': 'O login com o Google não está configurado neste servidor.',
  'google-cancelado': 'Você cancelou a autorização no Google.',
  'estado-invalido': 'A sessão de login expirou. Tente novamente.',
  'sem-codigo': 'O Google não devolveu o código de autorização.',
  'google-falhou': 'Não consegui concluir o login pelo Google. Tente de novo.',
};

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  if (!reducedMotion()) animate(errorBox, { opacity: [0, 1], translateY: [-4, 0], duration: 240, easing: 'quart.out' });
}

const motivo = new URLSearchParams(location.search).get('erro');
if (motivo) {
  showError(MOTIVOS[motivo] || 'Não consegui entrar. Tente novamente.');
  history.replaceState({}, '', location.pathname);
}

/* Entrar ou criar conta */
let mode = location.pathname === '/criar-conta' ? 'register' : 'login';

function setMode(next) {
  mode = next;
  const registering = mode === 'register';
  for (const tab of document.querySelectorAll('.auth-switch-btn')) {
    const on = tab.dataset.tab === mode;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  }
  nameField.hidden = !registering;
  password.autocomplete = registering ? 'new-password' : 'current-password';
  submit.querySelector('.txt').textContent = registering ? 'Criar conta' : 'Entrar';
  googleLabel.textContent = registering ? 'Criar conta com o Google' : 'Continuar com o Google';
  intro.textContent = registering
    ? 'A conta guarda suas aulas, o material gerado e a fila de revisão.'
    : 'Entre para ver suas aulas e a fila de revisão de hoje.';
  errorBox.hidden = true;
  history.replaceState({}, '', registering ? '/criar-conta' : '/entrar');
  document.title = `${registering ? 'Criar conta' : 'Entrar'} · Better Class`;
}

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.auth-switch-btn');
  if (tab) setMode(tab.dataset.tab);
});
setMode(mode);

/* O botão do Google só existe se o servidor tiver as credenciais */
api.authConfig()
  .then(({ google }) => {
    if (!google) return;
    googleBtn.hidden = false;
    divider.hidden = false;
  })
  .catch(() => {});

googleBtn.addEventListener('click', () => {
  googleBtn.disabled = true;
  googleLabel.textContent = 'Abrindo o Google…';
  location.href = '/api/auth/google';
});

/* Entrar com e-mail */
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const data = {
    email: document.getElementById('email').value.trim(),
    password: password.value,
    ...(mode === 'register' ? { name: nameInput.value.trim() } : {}),
  };
  submit.disabled = true;
  const label = submit.querySelector('.txt').textContent;
  submit.querySelector('.txt').textContent = mode === 'register' ? 'Criando…' : 'Entrando…';
  try {
    if (mode === 'register') await api.register(data);
    else await api.login(data);
    location.href = '/app';
  } catch (error) {
    showError(error.message || 'Não consegui entrar. Tente novamente.');
    submit.disabled = false;
    submit.querySelector('.txt').textContent = label;
  }
});

/* Quem já está logado vai direto para o app */
api.me().then(() => { location.href = '/app'; }).catch(() => {});
