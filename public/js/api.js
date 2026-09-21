/** Cliente da API do Better Class. */
const json = (body) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || `Erro ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const api = {
  /* Conta */
  me: () => request('/api/me'),
  register: (data) => request('/api/auth/register', { method: 'POST', ...json(data) }),
  login: (data) => request('/api/auth/login', { method: 'POST', ...json(data) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  updateMe: (data) => request('/api/me', { method: 'PATCH', ...json(data) }),

  /* Disciplinas */
  courses: () => request('/api/courses'),
  createCourse: (data) => request('/api/courses', { method: 'POST', ...json(data) }),
  deleteCourse: (id) => request(`/api/courses/${id}`, { method: 'DELETE' }),

  /* Aulas */
  lectures: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return request(`/api/lectures${search.toString() ? `?${search}` : ''}`);
  },
  lecture: (id) => request(`/api/lectures/${id}`),
  createLecture: (data) => request('/api/lectures', { method: 'POST', ...json(data) }),
  updateLecture: (id, data) => request(`/api/lectures/${id}`, { method: 'PATCH', ...json(data) }),
  deleteLecture: (id) => request(`/api/lectures/${id}`, { method: 'DELETE' }),
  importLecture: (data) => request('/api/lectures/import', { method: 'POST', ...json(data) }),
  stopLecture: (id, data) => request(`/api/lectures/${id}/stop`, { method: 'POST', ...json(data) }),
  processLecture: (id) => request(`/api/lectures/${id}/process`, { method: 'POST' }),
  askLecture: (id, question) => request(`/api/lectures/${id}/ask`, { method: 'POST', ...json({ question }) }),
  saveTranscript: (id, data) => request(`/api/lectures/${id}/transcript`, { method: 'POST', ...json(data) }),
  uploadChunk: (id, blob, index, elapsedMs) => request(`/api/lectures/${id}/chunk`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream', 'x-chunk-index': String(index), 'x-elapsed-ms': String(elapsedMs) },
    body: blob,
  }),
  audioUrl: (id) => `/api/lectures/${id}/audio`,
  exportUrl: (id) => `/api/lectures/${id}/export`,

  /* Estudo */
  queue: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return request(`/api/study/queue${search.toString() ? `?${search}` : ''}`);
  },
  review: (cardId, grade) => request(`/api/study/review/${cardId}`, { method: 'POST', ...json({ grade }) }),
  quiz: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return request(`/api/study/quiz${search.toString() ? `?${search}` : ''}`);
  },
  saveAttempt: (data) => request('/api/study/quiz/attempt', { method: 'POST', ...json(data) }),
  stats: () => request('/api/stats'),
};

/** Eventos do servidor (progresso da automação). */
export function listenEvents(handlers = {}) {
  let source;
  let closed = false;

  const connect = () => {
    if (closed) return;
    source = new EventSource('/api/events');
    for (const [type, handler] of Object.entries(handlers)) {
      source.addEventListener(type, (event) => {
        try { handler(JSON.parse(event.data)); } catch { /* ignora */ }
      });
    }
    source.onerror = () => {
      source.close();
      if (!closed) setTimeout(connect, 4000);   // reconexão simples
    };
  };
  connect();
  return () => { closed = true; source?.close(); };
}
