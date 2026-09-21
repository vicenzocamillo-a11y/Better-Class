import crypto from 'node:crypto';
import { config } from './config.js';
import { q, uid, nowISO } from './db.js';
import { parseCookies, setCookie, clearCookie, sign, safeEqual, unauthorized, bad } from './http.js';

const COOKIE = 'bc_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeEqual(derived, digest);
}

export function createUser({ name, email, password }) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw bad('E-mail inválido.');
  if (String(password || '').length < 8) throw bad('A senha precisa de pelo menos 8 caracteres.');
  if (!String(name || '').trim()) throw bad('Diga como você se chama.');
  if (q.get('SELECT id FROM users WHERE email = ?', clean)) throw bad('Esse e-mail já tem conta — é só fazer login.');

  const user = {
    id: uid('u_'),
    name: String(name).trim().slice(0, 80),
    email: clean,
    password_hash: hashPassword(password),
    settings: JSON.stringify({ autoPipeline: true, liveTranscript: true, theme: 'dark' }),
    created_at: nowISO(),
  };
  q.run(
    'INSERT INTO users (id, name, email, password_hash, settings, created_at) VALUES (?,?,?,?,?,?)',
    user.id, user.name, user.email, user.password_hash, user.settings, user.created_at,
  );
  return user;
}

export function authenticate(email, password) {
  const user = q.get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    throw bad('E-mail ou senha incorretos.');
  }
  return user;
}

export function startSession(res, user) {
  const id = uid('s_');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  q.run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    id, user.id, nowISO(), expires.toISOString());
  setCookie(res, COOKIE, `${id}.${sign(id, config.sessionSecret)}`, {
    maxAge: config.sessionDays * 86400,
    secure: config.isProd,
  });
  return id;
}

export function endSession(req, res) {
  const raw = parseCookies(req)[COOKIE];
  if (raw) q.run('DELETE FROM sessions WHERE id = ?', raw.split('.')[0]);
  clearCookie(res, COOKIE);
}

export function currentUser(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [id, signature] = raw.split('.');
  if (!id || !signature || !safeEqual(signature, sign(id, config.sessionSecret))) return null;
  const session = q.get('SELECT * FROM sessions WHERE id = ?', id);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    q.run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  return q.get('SELECT id, name, email, settings, created_at FROM users WHERE id = ?', session.user_id);
}

export function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw unauthorized();
  return user;
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at,
    settings: (() => { try { return JSON.parse(user.settings || '{}'); } catch { return {}; } })(),
  };
}

export function cleanupSessions() {
  q.run('DELETE FROM sessions WHERE expires_at < ?', nowISO());
}
