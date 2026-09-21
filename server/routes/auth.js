import { q, nowISO } from '../db.js';
import { ok, created, readJson, bad, rateLimiter } from '../http.js';
import crypto from 'node:crypto';
import { createUser, authenticate, startSession, endSession, requireUser, publicUser, upsertGoogleUser } from '../auth.js';
import { config, aiEnabled, serverTranscriptionEnabled } from '../config.js';
import { googleEnabled, callbackUrl, authorizeUrl, exchangeCode, fetchProfile } from '../services/google.js';
import { parseCookies, setCookie, clearCookie, sign, safeEqual } from '../http.js';

const STATE_COOKIE = 'bc_oauth';
const redirectTo = (res, location) => { res.writeHead(302, { location, 'cache-control': 'no-store' }); res.end(); };

const limit = rateLimiter({ windowMs: 60_000, max: 12 });

export default function authRoutes(router) {
  router.post('/api/auth/register', async (req, res) => {
    if (!limit(`reg:${req.socket.remoteAddress}`)) throw bad('Muitas tentativas. Espere um minuto.');
    const body = await readJson(req);
    const user = createUser(body);
    startSession(res, user);
    seedFirstCourse(user.id);
    return created(res, { user: publicUser(user) });
  });

  router.post('/api/auth/login', async (req, res) => {
    if (!limit(`login:${req.socket.remoteAddress}`)) throw bad('Muitas tentativas. Espere um minuto.');
    const { email, password } = await readJson(req);
    const user = authenticate(email, password);
    startSession(res, user);
    return ok(res, { user: publicUser(user) });
  });

  router.post('/api/auth/logout', async (req, res) => {
    endSession(req, res);
    return ok(res, { ok: true });
  });

  /* ── Entrar com o Google ────────────────────────────── */
  router.get('/api/auth/config', async (req, res) => ok(res, { google: googleEnabled() }));

  router.get('/api/auth/google', async (req, res) => {
    if (!googleEnabled()) return redirectTo(res, '/entrar?erro=google-desligado');
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, STATE_COOKIE, `${state}.${sign(state, config.sessionSecret)}`, {
      maxAge: 600, secure: config.isProd,
    });
    return redirectTo(res, authorizeUrl({ state, redirect: callbackUrl(req) }));
  });

  router.get('/api/auth/google/callback', async (req, res, { url }) => {
    const fail = (motivo) => redirectTo(res, `/entrar?erro=${encodeURIComponent(motivo)}`);
    if (!googleEnabled()) return fail('google-desligado');

    if (url.searchParams.get('error')) return fail('google-cancelado');

    const raw = parseCookies(req)[STATE_COOKIE] || '';
    const [state, signature] = raw.split('.');
    clearCookie(res, STATE_COOKIE);
    if (!state || !signature || !safeEqual(signature, sign(state, config.sessionSecret))) return fail('estado-invalido');
    if (!safeEqual(state, url.searchParams.get('state') || '')) return fail('estado-invalido');

    const code = url.searchParams.get('code');
    if (!code) return fail('sem-codigo');

    try {
      const tokens = await exchangeCode({ code, redirect: callbackUrl(req) });
      const profile = await fetchProfile(tokens.access_token);
      const { user, created } = upsertGoogleUser(profile);
      startSession(res, user);
      if (created) seedFirstCourse(user.id);
      return redirectTo(res, '/app');
    } catch (error) {
      console.error('[google]', error.message);
      return fail('google-falhou');
    }
  });

  router.get('/api/me', async (req, res) => {
    const user = requireUser(req);
    return ok(res, {
      user: publicUser(user),
      capabilities: { ai: aiEnabled(), serverTranscription: serverTranscriptionEnabled(), google: googleEnabled() },
    });
  });

  router.patch('/api/me', async (req, res) => {
    const user = requireUser(req);
    const body = await readJson(req);
    const current = (() => { try { return JSON.parse(user.settings || '{}'); } catch { return {}; } })();
    const next = { ...current };
    for (const key of ['autoPipeline', 'liveTranscript', 'theme', 'reduceMotion', 'chunkSeconds']) {
      if (body[key] !== undefined) next[key] = body[key];
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      q.run('UPDATE users SET name = ? WHERE id = ?', body.name.trim().slice(0, 80), user.id);
    }
    q.run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(next), user.id);
    const fresh = q.get('SELECT id, name, email, settings, created_at FROM users WHERE id = ?', user.id);
    return ok(res, { user: publicUser(fresh) });
  });
}

function seedFirstCourse(userId) {
  const exists = q.get('SELECT id FROM courses WHERE user_id = ?', userId);
  if (exists) return;
  const stamp = nowISO();
  const defaults = [
    ['Cálculo I', 'blue'],
    ['Algoritmos', 'violet'],
    ['Anatomia', 'rose'],
  ];
  defaults.forEach(([name, color], i) => {
    q.run('INSERT INTO courses (id, user_id, name, professor, color, created_at) VALUES (?,?,?,?,?,?)',
      `c_${userId.slice(2, 10)}${i}`, userId, name, '', color, stamp);
  });
}
