import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { q, uid, nowISO } from '../db.js';
import { emit } from './events.js';
import { analyseLecture, suggestTitle } from './ai.js';
import { transcribeFile, available as serverTranscription } from './transcribe.js';

const queue = [];
let working = false;

const STEPS = [
  { key: 'merge', label: 'Juntando os pedaços da gravação', weight: 15 },
  { key: 'transcribe', label: 'Transcrevendo a aula', weight: 35 },
  { key: 'analyse', label: 'A IA está estudando a aula por você', weight: 35 },
  { key: 'materials', label: 'Montando resumo, apontamentos e revisão', weight: 15 },
];

export function enqueue(lectureId, userId, type = 'full') {
  const existing = q.get(
    "SELECT * FROM jobs WHERE lecture_id = ? AND status IN ('queued','running') ORDER BY created_at DESC",
    lectureId,
  );
  if (existing) return existing;

  const job = {
    id: uid('j_'), lecture_id: lectureId, user_id: userId, type,
    status: 'queued', step: 'Na fila', progress: 0, error: '',
    created_at: nowISO(), updated_at: nowISO(),
  };
  q.run(
    'INSERT INTO jobs (id, lecture_id, user_id, type, status, step, progress, error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    job.id, job.lecture_id, job.user_id, job.type, job.status, job.step, job.progress, job.error, job.created_at, job.updated_at,
  );
  q.run("UPDATE lectures SET status = 'processing', updated_at = ? WHERE id = ?", nowISO(), lectureId);
  emit(userId, 'job', { jobId: job.id, lectureId, status: 'queued', progress: 0, step: job.step });

  queue.push(job.id);
  setImmediate(drain);
  return job;
}

async function drain() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const jobId = queue.shift();
      try { await runJob(jobId); }
      catch (error) { failJob(jobId, error); }
    }
  } finally {
    working = false;
  }
}

function update(job, patch) {
  Object.assign(job, patch, { updated_at: nowISO() });
  q.run('UPDATE jobs SET status = ?, step = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?',
    job.status, job.step, job.progress, job.error, job.updated_at, job.id);
  emit(job.user_id, 'job', {
    jobId: job.id, lectureId: job.lecture_id,
    status: job.status, step: job.step, progress: job.progress, error: job.error,
  });
}

function failJob(jobId, error) {
  const job = q.get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) return;
  update(job, { status: 'error', error: String(error?.message || error).slice(0, 400), progress: 100, step: 'Falhou' });
  q.run("UPDATE lectures SET status = 'failed', updated_at = ? WHERE id = ?", nowISO(), job.lecture_id);
}

/** Junta os pedaços gravados num único ficheiro de áudio. */
export function mergeChunks(lectureId) {
  const lecture = q.get('SELECT * FROM lectures WHERE id = ?', lectureId);
  if (!lecture) return null;
  const chunks = q.all('SELECT * FROM chunks WHERE lecture_id = ? ORDER BY idx ASC', lectureId);
  if (!chunks.length) return null;

  const ext = (lecture.audio_mime || '').includes('ogg') ? 'ogg' : (lecture.audio_mime || '').includes('mp4') ? 'mp4' : 'webm';
  const target = path.join(config.uploadDir, `${lectureId}.${ext}`);
  const out = fs.createWriteStream(target);
  let bytes = 0;
  for (const chunk of chunks) {
    if (!fs.existsSync(chunk.path)) continue;
    const buf = fs.readFileSync(chunk.path);
    out.write(buf);
    bytes += buf.length;
  }
  out.end();
  q.run('UPDATE lectures SET audio_path = ?, size_bytes = ?, updated_at = ? WHERE id = ?', target, bytes, nowISO(), lectureId);
  return { path: target, bytes };
}

function progressUpTo(index, inner = 1) {
  const before = STEPS.slice(0, index).reduce((sum, s) => sum + s.weight, 0);
  return Math.min(99, Math.round(before + STEPS[index].weight * inner));
}

async function runJob(jobId) {
  const job = q.get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) return;
  const lecture = q.get('SELECT * FROM lectures WHERE id = ?', job.lecture_id);
  if (!lecture) throw new Error('Aula não encontrada.');
  const course = lecture.course_id ? q.get('SELECT name FROM courses WHERE id = ?', lecture.course_id) : null;

  update(job, { status: 'running', step: STEPS[0].label, progress: 4 });

  /* 1 — juntar áudio */
  const merged = mergeChunks(lecture.id);
  update(job, { step: STEPS[0].label, progress: progressUpTo(0) });

  /* 2 — transcrever */
  update(job, { step: STEPS[1].label, progress: progressUpTo(1, 0.2) });
  let transcript = String(lecture.transcript || '').trim();
  let source = lecture.transcript_source || (transcript ? 'navegador' : '');

  if (transcript.length < 200 && serverTranscription() && merged?.path) {
    try {
      const text = await transcribeFile(merged.path);
      if (text && text.length > transcript.length) { transcript = text; source = 'servidor'; }
    } catch (error) {
      update(job, { step: `Transcrição do servidor falhou: ${error.message.slice(0, 80)}` });
    }
  }
  if (transcript) {
    q.run('UPDATE lectures SET transcript = ?, transcript_source = ?, updated_at = ? WHERE id = ?',
      transcript, source, nowISO(), lecture.id);
  }
  update(job, { step: STEPS[1].label, progress: progressUpTo(1) });

  if (transcript.trim().length < 40) {
    q.run("UPDATE lectures SET status = 'needs_transcript', updated_at = ? WHERE id = ?", nowISO(), lecture.id);
    update(job, {
      status: 'done', progress: 100,
      step: 'Sem transcrição suficiente — grave com a transcrição ao vivo ligada ou cole o texto da aula.',
    });
    emit(job.user_id, 'lecture', { lectureId: lecture.id, status: 'needs_transcript' });
    return;
  }

  /* 3 — IA */
  update(job, { step: STEPS[2].label, progress: progressUpTo(2, 0.15) });
  const result = await analyseLecture({
    title: lecture.title,
    course: course?.name,
    transcript,
    durationMs: lecture.duration_ms,
    onStep: (message) => update(job, { step: message, progress: progressUpTo(2, 0.5) }),
  });
  update(job, { step: STEPS[3].label, progress: progressUpTo(3, 0.3) });

  /* 4 — materiais */
  saveOutputs(lecture, result);
  if (/^(aula de \d|aula sem t|gravação)/i.test(lecture.title) || !lecture.title.trim()) {
    const title = await suggestTitle(transcript);
    if (title) q.run('UPDATE lectures SET title = ? WHERE id = ?', title, lecture.id);
  }

  q.run("UPDATE lectures SET status = 'ready', updated_at = ? WHERE id = ?", nowISO(), lecture.id);
  update(job, {
    status: 'done', progress: 100,
    step: result.engine === 'claude' ? 'Pronto — material gerado pelo Claude.' : 'Pronto — material gerado pelo motor local.',
  });
  emit(job.user_id, 'lecture', { lectureId: lecture.id, status: 'ready', engine: result.engine });
}

export function saveOutputs(lecture, result) {
  const stamp = nowISO();
  const put = (kind, payload) => {
    q.run(
      `INSERT INTO outputs (id, lecture_id, kind, payload, engine, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(lecture_id, kind) DO UPDATE SET payload = excluded.payload, engine = excluded.engine, created_at = excluded.created_at`,
      uid('o_'), lecture.id, kind, JSON.stringify(payload), result.engine || 'local', stamp,
    );
  };
  put('summary', result.summary);
  put('notes', result.notes);
  put('glossary', result.glossary || []);
  put('review', result.review);
  put('meta', { engine: result.engine, degraded: result.degraded || null, gaps: result.gaps || [] });

  q.run('DELETE FROM flashcards WHERE lecture_id = ?', lecture.id);
  for (const card of result.flashcards || []) {
    q.run(
      'INSERT INTO flashcards (id, lecture_id, user_id, front, back, ease, interval_days, reps, lapses, due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      uid('f_'), lecture.id, lecture.user_id, card.front, card.back, 2.5, 0, 0, 0, stamp, stamp,
    );
  }
  q.run('DELETE FROM questions WHERE lecture_id = ?', lecture.id);
  for (const item of result.questions || []) {
    q.run(
      'INSERT INTO questions (id, lecture_id, user_id, prompt, options, answer, explanation, created_at) VALUES (?,?,?,?,?,?,?,?)',
      uid('q_'), lecture.id, lecture.user_id, item.prompt, JSON.stringify(item.options), item.answer, item.explanation || '', stamp,
    );
  }
}

/** Retoma trabalhos interrompidos por um restart do servidor. */
export function resumePendingJobs() {
  const pending = q.all("SELECT id FROM jobs WHERE status IN ('queued','running') ORDER BY created_at ASC");
  for (const job of pending) queue.push(job.id);
  if (pending.length) setImmediate(drain);
  return pending.length;
}
