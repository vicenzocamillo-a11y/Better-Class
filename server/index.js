import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, aiEnabled, serverTranscriptionEnabled } from './config.js';
import { createRouter } from './router.js';
import { json, HttpError } from './http.js';
import { currentUser, requireUser, cleanupSessions } from './auth.js';
import { subscribe } from './services/events.js';
import { resumePendingJobs } from './services/pipeline.js';
import authRoutes from './routes/auth.js';
import lectureRoutes from './routes/lectures.js';
import studyRoutes from './routes/study.js';

const router = createRouter();
authRoutes(router);
lectureRoutes(router);
studyRoutes(router);

router.get('/api/events', async (req, res) => {
  const user = requireUser(req);
  subscribe(user.id, res);
});

router.get('/api/health', async (req, res) => json(res, 200, {
  ok: true,
  ai: aiEnabled() ? 'claude' : 'local',
  serverTranscription: serverTranscriptionEnabled(),
  uptime: Math.round(process.uptime()),
}));

/* ── Ficheiros estáticos ──────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const PAGES = {
  '/': 'index.html',
  '/entrar': 'login.html',
  '/criar-conta': 'login.html',
  '/app': 'app.html',
  '/gravar': 'app.html',
  '/estudar': 'app.html',
};

function serveStatic(req, res, pathname) {
  let rel = PAGES[pathname] || pathname.replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  const file = path.join(config.publicDir, path.normalize(rel));
  if (!file.startsWith(config.publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;

  const ext = path.extname(file).toLowerCase();
  const { size, mtime } = fs.statSync(file);
  const etag = `W/"${size}-${mtime.getTime()}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304).end();
    return true;
  }
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': size,
    etag,
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  const method = req.method === 'HEAD' ? 'GET' : req.method;   // HEAD = GET sem corpo (o Node corta o body)

  try {
    const route = router.match(method, pathname);
    if (route) {
      await route.handler(req, res, { params: route.params, url, user: currentUser(req) });
      return;
    }
    if (method === 'GET' && serveStatic(req, res, pathname)) return;
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Rota inexistente.' });

    // SPA fallback: qualquer rota desconhecida cai na landing
    if (method === 'GET') {
      if (serveStatic(req, res, '/')) return;
    }
    json(res, 404, { error: 'Não encontrado.' });
  } catch (error) {
    if (res.headersSent) return res.end();
    if (error instanceof HttpError) {
      return json(res, error.status, { error: error.message, details: error.details });
    }
    console.error('[better-class]', error);
    json(res, 500, { error: 'Algo quebrou do nosso lado.', detail: String(error?.message || error).slice(0, 200) });
  }
});

server.requestTimeout = 0;
server.headersTimeout = 65_000;

if (process.env.NODE_ENV !== 'test') {
  cleanupSessions();
  const resumed = resumePendingJobs();
  server.listen(config.port, config.host, () => {
    const engine = aiEnabled() ? `Claude (${config.ai.model})` : 'motor local (sem ANTHROPIC_API_KEY)';
    console.log(`\n  Better Class  ·  http://localhost:${config.port}`);
    console.log(`  IA: ${engine}`);
    console.log(`  Transcrição no servidor: ${serverTranscriptionEnabled() ? 'ligada' : 'desligada (usa o navegador)'}`);
    if (resumed) console.log(`  ${resumed} processamento(s) retomado(s).`);
    console.log('');
  });
  setInterval(cleanupSessions, 6 * 3600_000).unref();
}

export { server, router };
