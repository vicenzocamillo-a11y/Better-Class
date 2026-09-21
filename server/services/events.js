/** Barramento de eventos em memória → Server-Sent Events por utilizador. */
const listeners = new Map(); // userId -> Set<res>

export function subscribe(userId, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

  if (!listeners.has(userId)) listeners.set(userId, new Set());
  listeners.get(userId).add(res);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* ignora */ }
  }, 25_000);

  const close = () => {
    clearInterval(ping);
    listeners.get(userId)?.delete(res);
    if (!listeners.get(userId)?.size) listeners.delete(userId);
  };
  res.on('close', close);
  res.on('error', close);
}

export function emit(userId, type, payload = {}) {
  const set = listeners.get(userId);
  if (!set?.size) return;
  const frame = `event: ${type}\ndata: ${JSON.stringify({ ...payload, at: Date.now() })}\n\n`;
  for (const res of set) {
    try { res.write(frame); } catch { set.delete(res); }
  }
}

export const connectedUsers = () => listeners.size;
