import crypto from 'node:crypto';

export function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(data);
}

export const ok = (res, body = { ok: true }) => json(res, 200, body);
export const created = (res, body) => json(res, 201, body);

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const bad = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Você precisa entrar na sua conta.') => new HttpError(401, msg);
export const notFound = (msg = 'Não encontrado.') => new HttpError(404, msg);

export async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Arquivo grande demais.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw bad('JSON inválido.'); }
}

/* ── Cookies ─────────────────────────────────────────────── */
export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.secure) bits.push('Secure');
  const prev = res.getHeader('set-cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('set-cookie', [...list, bits.join('; ')]);
}

export const clearCookie = (res, name) => setCookie(res, name, '', { maxAge: 0 });

/* ── Segurança ───────────────────────────────────────────── */
export function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Limitador de pedidos em memória (janela deslizante simples). */
export function rateLimiter({ windowMs = 60_000, max = 60 } = {}) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return list.length <= max;
  };
}
