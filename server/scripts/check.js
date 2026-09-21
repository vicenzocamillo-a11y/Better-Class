/**
 * Verificação rápida de ponta a ponta: sobe o servidor num porto livre,
 * cria conta, importa uma aula, espera a automação e confere o material.
 *   npm run check
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 3999;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'better-class-check-'));

const TRANSCRIPT = `A segunda lei da termodinâmica afirma que a entropia de um sistema isolado nunca diminui.
A entropia é uma medida da desordem do sistema. Portanto, processos espontâneos sempre aumentam a entropia total do universo.
Em resumo, nenhuma máquina térmica converte todo o calor recebido em trabalho útil. O rendimento de Carnot é o limite superior
para qualquer máquina térmica operando entre duas fontes de temperatura. Atenção: isso cai na prova, principalmente a relação
entre rendimento, temperatura da fonte quente e temperatura da fonte fria.`;

const server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SESSION_SECRET: 'check-secret', NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function call(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...options.headers },
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : await response.text();
  return { status: response.status, body };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready() {
  for (let i = 0; i < 50; i++) {
    try { const { status } = await call('/api/health'); if (status === 200) return true; } catch { /* ainda subindo */ }
    await wait(200);
  }
  throw new Error('O servidor não subiu.');
}

try {
  console.log('\n  Better Class · verificação\n');
  await ready();

  const health = await call('/api/health');
  check('rota /api/health', health.status === 200, `IA: ${health.body.ai}`);

  const register = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Aluno Teste', email: `check${Date.now()}@teste.dev`, password: 'senha-de-teste' }),
  });
  check('criar conta', register.status === 201, register.body?.user?.email);

  const me = await call('/api/me');
  check('sessão ativa', me.status === 200 && Boolean(me.body.user));

  const courses = await call('/api/courses');
  check('disciplinas iniciais', courses.body.courses?.length >= 1, `${courses.body.courses?.length} criadas`);

  const imported = await call('/api/lectures/import', {
    method: 'POST',
    body: JSON.stringify({ title: 'Termodinâmica — 2ª lei', transcript: TRANSCRIPT }),
  });
  check('importar aula', imported.status === 201, imported.body?.lecture?.id);

  const id = imported.body.lecture.id;
  let lecture = null;
  for (let i = 0; i < 40; i++) {
    const detail = await call(`/api/lectures/${id}`);
    lecture = detail.body;
    if (lecture.lecture.status === 'ready' || lecture.lecture.status === 'failed') break;
    await wait(250);
  }
  check('automação concluída', lecture.lecture.status === 'ready', lecture.lecture.status);
  check('resumo gerado', Boolean(lecture.outputs?.summary?.tldr));
  check('apontamentos gerados', (lecture.outputs?.notes?.sections || []).length > 0,
    `${lecture.outputs?.notes?.sections?.length} blocos`);
  check('plano de revisão', (lecture.outputs?.review?.studyPlan || []).length > 0);
  check('flashcards', lecture.flashcards.length > 0, `${lecture.flashcards.length} cards`);
  check('quiz', lecture.questions.length > 0, `${lecture.questions.length} questões`);

  const queue = await call('/api/study/queue');
  check('fila de revisão', queue.body.cards.length > 0, `${queue.body.pending} vencendo`);

  if (queue.body.cards.length) {
    const review = await call(`/api/study/review/${queue.body.cards[0].id}`, { method: 'POST', body: JSON.stringify({ grade: 2 }) });
    check('revisar um card (SM-2)', review.status === 200, `próxima em ${review.body.intervalDays} dia(s)`);
  }

  const exported = await call(`/api/lectures/${id}/export`);
  check('exportar markdown', typeof exported.body === 'string' && exported.body.includes('## Resumo'));

  const stats = await call('/api/stats');
  check('estatísticas', stats.body.lectures === 1 && stats.body.cards > 0);

  const anon = await fetch(`${base}/api/lectures`);
  check('rota protegida sem sessão devolve 401', anon.status === 401);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} verificações passaram\n`);
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error('\n  Falhou:', error.message, '\n');
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}
