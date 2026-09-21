import { q, nowISO } from '../db.js';
import { ok, created, readJson, bad, rateLimiter } from '../http.js';
import { createUser, authenticate, startSession, endSession, requireUser, publicUser } from '../auth.js';
import { aiEnabled, serverTranscriptionEnabled } from '../config.js';

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

  router.get('/api/me', async (req, res) => {
    const user = requireUser(req);
    return ok(res, {
      user: publicUser(user),
      capabilities: { ai: aiEnabled(), serverTranscription: serverTranscriptionEnabled() },
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
