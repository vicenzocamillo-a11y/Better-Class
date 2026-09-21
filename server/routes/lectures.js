import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { q, uid, nowISO, jsonParse } from '../db.js';
import { ok, created, json, readJson, readBody, bad, notFound, HttpError } from '../http.js';
import { requireUser } from '../auth.js';
import { enqueue, mergeChunks, saveOutputs } from '../services/pipeline.js';
import { askAboutLecture } from '../services/ai.js';
import { emit } from '../services/events.js';

const STATUS_LABEL = {
  recording: 'Gravando',
  processing: 'Processando',
  ready: 'Pronta',
  needs_transcript: 'Falta transcrição',
  failed: 'Falhou',
};

function lectureOr404(id, userId) {
  const lecture = q.get('SELECT * FROM lectures WHERE id = ? AND user_id = ?', id, userId);
  if (!lecture) throw notFound('Aula não encontrada.');
  return lecture;
}

function shape(lecture) {
  const course = lecture.course_id ? q.get('SELECT * FROM courses WHERE id = ?', lecture.course_id) : null;
  const job = q.get('SELECT * FROM jobs WHERE lecture_id = ? ORDER BY created_at DESC LIMIT 1', lecture.id);
  const counts = {
    cards: q.get('SELECT COUNT(*) AS n FROM flashcards WHERE lecture_id = ?', lecture.id)?.n || 0,
    questions: q.get('SELECT COUNT(*) AS n FROM questions WHERE lecture_id = ?', lecture.id)?.n || 0,
  };
  return {
    id: lecture.id,
    title: lecture.title,
    status: lecture.status,
    statusLabel: STATUS_LABEL[lecture.status] || lecture.status,
    course: course ? { id: course.id, name: course.name, color: course.color } : null,
    startedAt: lecture.started_at,
    endedAt: lecture.ended_at,
    durationMs: lecture.duration_ms,
    sizeBytes: lecture.size_bytes,
    hasAudio: Boolean(lecture.audio_path && fs.existsSync(lecture.audio_path)),
    transcriptChars: (lecture.transcript || '').length,
    transcriptSource: lecture.transcript_source,
    counts,
    job: job ? { id: job.id, status: job.status, step: job.step, progress: job.progress, error: job.error } : null,
    updatedAt: lecture.updated_at,
  };
}

function outputsOf(lectureId) {
  const rows = q.all('SELECT kind, payload, engine FROM outputs WHERE lecture_id = ?', lectureId);
  const out = {};
  for (const row of rows) out[row.kind] = jsonParse(row.payload, null);
  out.engine = rows[0]?.engine || null;
  return out;
}

export default function lectureRoutes(router) {
  /* ── Disciplinas ──────────────────────────────────────── */
  router.get('/api/courses', async (req, res) => {
    const user = requireUser(req);
    const courses = q.all(
      `SELECT c.*, (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS lectures
       FROM courses c WHERE c.user_id = ? ORDER BY c.created_at ASC`, user.id);
    return ok(res, { courses });
  });

  router.post('/api/courses', async (req, res) => {
    const user = requireUser(req);
    const { name, professor = '', color = 'blue' } = await readJson(req);
    if (!String(name || '').trim()) throw bad('Dê um nome à disciplina.');
    const course = {
      id: uid('c_'), user_id: user.id, name: String(name).trim().slice(0, 80),
      professor: String(professor).slice(0, 80), color: String(color).slice(0, 20), created_at: nowISO(),
    };
    q.run('INSERT INTO courses (id, user_id, name, professor, color, created_at) VALUES (?,?,?,?,?,?)',
      course.id, course.user_id, course.name, course.professor, course.color, course.created_at);
    return created(res, { course });
  });

  router.delete('/api/courses/:id', async (req, res, { params }) => {
    const user = requireUser(req);
    q.run('DELETE FROM courses WHERE id = ? AND user_id = ?', params.id, user.id);
    return ok(res);
  });

  /* ── Aulas ────────────────────────────────────────────── */
  router.get('/api/lectures', async (req, res, { url }) => {
    const user = requireUser(req);
    const search = (url.searchParams.get('q') || '').trim().toLowerCase();
    const courseId = url.searchParams.get('course');
    let rows = q.all('SELECT * FROM lectures WHERE user_id = ? ORDER BY started_at DESC LIMIT 300', user.id);
    if (courseId) rows = rows.filter((r) => r.course_id === courseId);
    if (search) {
      rows = rows.filter((r) =>
        r.title.toLowerCase().includes(search) || (r.transcript || '').toLowerCase().includes(search));
    }
    return ok(res, { lectures: rows.map(shape) });
  });

  router.post('/api/lectures', async (req, res) => {
    const user = requireUser(req);
    const body = await readJson(req);
    const stamp = nowISO();
    const lecture = {
      id: uid('l_'), user_id: user.id,
      course_id: body.courseId || null,
      title: String(body.title || '').trim().slice(0, 140) || `Aula de ${new Date().toLocaleDateString('pt-BR')}`,
      status: 'recording',
      started_at: stamp,
      audio_mime: String(body.mime || 'audio/webm').slice(0, 60),
      created_at: stamp, updated_at: stamp,
    };
    q.run(
      `INSERT INTO lectures (id, user_id, course_id, title, status, started_at, audio_mime, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      lecture.id, lecture.user_id, lecture.course_id, lecture.title, lecture.status,
      lecture.started_at, lecture.audio_mime, lecture.created_at, lecture.updated_at,
    );
    emit(user.id, 'lecture', { lectureId: lecture.id, status: 'recording' });
    return created(res, { lecture: shape(q.get('SELECT * FROM lectures WHERE id = ?', lecture.id)) });
  });

  /** Upload de um pedaço de áudio (corpo binário puro). */
  router.post('/api/lectures/:id/chunk', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    const buffer = await readBody(req, config.maxChunkBytes);
    if (!buffer.length) throw bad('Pedaço vazio.');

    const index = Math.min(999_999, Math.max(0, Math.trunc(Number(req.headers['x-chunk-index'])) || 0));
    const dir = path.join(config.uploadDir, lecture.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${String(index).padStart(5, '0')}.part`);
    fs.writeFileSync(file, buffer);

    q.run('INSERT INTO chunks (id, lecture_id, idx, path, bytes, created_at) VALUES (?,?,?,?,?,?)',
      uid('ch_'), lecture.id, index, file, buffer.length, nowISO());
    q.run('UPDATE lectures SET size_bytes = size_bytes + ?, duration_ms = ?, updated_at = ? WHERE id = ?',
      buffer.length, Math.max(0, Number(req.headers['x-elapsed-ms']) || lecture.duration_ms), nowISO(), lecture.id);

    return ok(res, { index, bytes: buffer.length });
  });

  /** Transcrição ao vivo vinda do navegador (acumulativa). */
  router.post('/api/lectures/:id/transcript', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    const { append = '', replace, source = 'navegador', notes } = await readJson(req, 4 * 1024 * 1024);
    let text = lecture.transcript || '';
    if (typeof replace === 'string') text = replace;
    else if (append) text = `${text} ${append}`.trim();
    q.run('UPDATE lectures SET transcript = ?, transcript_source = ?, updated_at = ? WHERE id = ?',
      text.slice(0, 2_000_000), source, nowISO(), lecture.id);
    if (typeof notes === 'string') q.run('UPDATE lectures SET live_notes = ? WHERE id = ?', notes.slice(0, 200_000), lecture.id);
    return ok(res, { chars: text.length });
  });

  /** Fim da gravação → dispara a automação. */
  router.post('/api/lectures/:id/stop', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    const { durationMs = lecture.duration_ms, autoProcess = true } = await readJson(req);
    q.run("UPDATE lectures SET ended_at = ?, duration_ms = ?, status = 'processing', updated_at = ? WHERE id = ?",
      nowISO(), Number(durationMs) || lecture.duration_ms, nowISO(), lecture.id);
    mergeChunks(lecture.id);
    const job = autoProcess ? enqueue(lecture.id, user.id) : null;
    return ok(res, { lecture: shape(q.get('SELECT * FROM lectures WHERE id = ?', lecture.id)), job });
  });

  /** Reprocessar (ou processar depois de colar uma transcrição). */
  router.post('/api/lectures/:id/process', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    const job = enqueue(lecture.id, user.id);
    return ok(res, { job });
  });

  router.get('/api/lectures/:id', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    return ok(res, {
      lecture: shape(lecture),
      transcript: lecture.transcript,
      liveNotes: lecture.live_notes,
      outputs: outputsOf(lecture.id),
      flashcards: q.all('SELECT id, front, back, due_at, reps FROM flashcards WHERE lecture_id = ?', lecture.id),
      questions: q.all('SELECT id, prompt, options, answer, explanation FROM questions WHERE lecture_id = ?', lecture.id)
        .map((row) => ({ ...row, options: jsonParse(row.options, []) })),
    });
  });

  router.patch('/api/lectures/:id', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    const body = await readJson(req);
    if (typeof body.title === 'string') {
      q.run('UPDATE lectures SET title = ?, updated_at = ? WHERE id = ?', body.title.trim().slice(0, 140) || lecture.title, nowISO(), lecture.id);
    }
    if (body.courseId !== undefined) {
      q.run('UPDATE lectures SET course_id = ?, updated_at = ? WHERE id = ?', body.courseId || null, nowISO(), lecture.id);
    }
    if (typeof body.transcript === 'string') {
      q.run("UPDATE lectures SET transcript = ?, transcript_source = 'manual', updated_at = ? WHERE id = ?",
        body.transcript.slice(0, 2_000_000), nowISO(), lecture.id);
    }
    return ok(res, { lecture: shape(q.get('SELECT * FROM lectures WHERE id = ?', lecture.id)) });
  });

  router.delete('/api/lectures/:id', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    for (const chunk of q.all('SELECT path FROM chunks WHERE lecture_id = ?', lecture.id)) {
      fs.rmSync(chunk.path, { force: true });
    }
    fs.rmSync(path.join(config.uploadDir, lecture.id), { recursive: true, force: true });
    if (lecture.audio_path) fs.rmSync(lecture.audio_path, { force: true });
    q.run('DELETE FROM lectures WHERE id = ?', lecture.id);
    return ok(res);
  });

  /* ── Áudio com suporte a Range (para poder arrastar o player) ── */
  router.get('/api/lectures/:id/audio', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    let file = lecture.audio_path;
    if (!file || !fs.existsSync(file)) file = mergeChunks(lecture.id)?.path;
    if (!file || !fs.existsSync(file)) throw notFound('Esta aula ainda não tem áudio salvo.');

    const { size } = fs.statSync(file);
    const range = req.headers.range;
    const type = lecture.audio_mime || 'audio/webm';
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = Number(match?.[1] || 0);
      const end = match?.[2] ? Number(match[2]) : size - 1;
      if (start >= size) throw new HttpError(416, 'Range inválido.');
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
    return fs.createReadStream(file).pipe(res);
  });

  /* ── Exportar material em Markdown ────────────────────── */
  router.get('/api/lectures/:id/export', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    const markdown = toMarkdown(lecture, outputsOf(lecture.id),
      q.all('SELECT front, back FROM flashcards WHERE lecture_id = ?', lecture.id));
    const name = lecture.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'aula';
    res.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.md"`,
    });
    res.end(markdown);
  });

  /* ── Pergunte à aula ──────────────────────────────────── */
  router.post('/api/lectures/:id/ask', async (req, res, { params }) => {
    const user = requireUser(req);
    const lecture = lectureOr404(params.id, user.id);
    const { question } = await readJson(req);
    if (!String(question || '').trim()) throw bad('Escreva uma pergunta.');
    const answer = await askAboutLecture({
      question: String(question).slice(0, 2000),
      transcript: lecture.transcript,
      title: lecture.title,
      outputs: outputsOf(lecture.id),
    });
    return ok(res, answer);
  });

  /* ── Importar aula sem gravação (colar texto) ─────────── */
  router.post('/api/lectures/import', async (req, res) => {
    const user = requireUser(req);
    const { title, transcript, courseId } = await readJson(req, 4 * 1024 * 1024);
    if (String(transcript || '').trim().length < 80) throw bad('Cole um texto maior para a IA trabalhar.');
    const stamp = nowISO();
    const id = uid('l_');
    q.run(
      `INSERT INTO lectures (id, user_id, course_id, title, status, started_at, ended_at, duration_ms, transcript, transcript_source, created_at, updated_at)
       VALUES (?,?,?,?,'processing',?,?,?,?, 'importado', ?, ?)`,
      id, user.id, courseId || null, String(title || 'Aula importada').slice(0, 140),
      stamp, stamp, 0, String(transcript).slice(0, 2_000_000), stamp, stamp,
    );
    const job = enqueue(id, user.id);
    return created(res, { lecture: shape(q.get('SELECT * FROM lectures WHERE id = ?', id)), job });
  });
}

function toMarkdown(lecture, outputs, cards) {
  const lines = [`# ${lecture.title}`, ''];
  const date = new Date(lecture.started_at).toLocaleString('pt-BR');
  const minutes = Math.round(lecture.duration_ms / 60000);
  const length = lecture.duration_ms >= 60000 ? `${minutes} min` : `${Math.round(lecture.duration_ms / 1000)} s`;
  lines.push(`_Gravada em ${date}${lecture.duration_ms ? ` · ${length}` : ''} · Better Class_`, '');
  if (outputs.summary) {
    lines.push('## Resumo', '', outputs.summary.tldr || '', '', outputs.summary.abstract || '', '');
    if (outputs.summary.highlights?.length) {
      lines.push('### Pontos essenciais', '', ...outputs.summary.highlights.map((h) => `- ${h}`), '');
    }
  }
  if (outputs.notes?.sections?.length) {
    lines.push('## Apontamentos', '');
    for (const section of outputs.notes.sections) {
      lines.push(`### ${section.heading}`, '', ...section.bullets.map((b) => `- ${b}`), '');
    }
  }
  if (outputs.glossary?.length) {
    lines.push('## Glossário', '', ...outputs.glossary.map((g) => `- **${g.term}** — ${g.definition}`), '');
  }
  if (outputs.review) {
    lines.push('## Revisão para a prova', '');
    if (outputs.review.examFocus?.length) lines.push('### Foco', '', ...outputs.review.examFocus.map((t) => `- ${t}`), '');
    if (outputs.review.commonMistakes?.length) lines.push('### Erros comuns', '', ...outputs.review.commonMistakes.map((t) => `- ${t}`), '');
    if (outputs.review.studyPlan?.length) lines.push('### Plano de estudo', '', ...outputs.review.studyPlan.map((p) => `- **${p.day}:** ${p.task}`), '');
  }
  if (cards.length) {
    lines.push('## Flashcards', '', ...cards.map((c) => `- **${c.front}**\n  - ${c.back}`), '');
  }
  return lines.join('\n');
}
