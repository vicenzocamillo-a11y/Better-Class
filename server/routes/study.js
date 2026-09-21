import { q, uid, nowISO, jsonParse } from '../db.js';
import { ok, readJson, bad, notFound } from '../http.js';
import { requireUser } from '../auth.js';

/** SM-2 enxuto: grade 0 (errei) · 1 (difícil) · 2 (bom) · 3 (fácil) */
function schedule(card, grade) {
  let { ease, interval_days: interval, reps, lapses } = card;
  if (grade === 0) {
    reps = 0; lapses += 1; interval = 0.007; ease = Math.max(1.3, ease - 0.2);   // ~10 min
  } else {
    reps += 1;
    ease = Math.min(3.2, Math.max(1.3, ease + (grade === 3 ? 0.12 : grade === 2 ? 0 : -0.15)));
    if (reps === 1) interval = grade === 1 ? 0.5 : 1;
    else if (reps === 2) interval = grade === 1 ? 2 : 4;
    else interval = Math.round(interval * ease * (grade === 1 ? 0.7 : grade === 3 ? 1.25 : 1));
    interval = Math.min(interval, 180);
  }
  const due = new Date(Date.now() + interval * 86400000).toISOString();
  return { ease, interval, reps, lapses, due };
}

export default function studyRoutes(router) {
  /** Fila de revisão do dia (cartões vencidos + novos). */
  router.get('/api/study/queue', async (req, res, { url }) => {
    const user = requireUser(req);
    const limit = Math.min(60, Number(url.searchParams.get('limit') || 20));
    const lectureId = url.searchParams.get('lecture');
    const now = nowISO();
    const params = lectureId ? [user.id, now, lectureId] : [user.id, now];
    const cards = q.all(
      `SELECT f.*, l.title AS lecture_title FROM flashcards f
       JOIN lectures l ON l.id = f.lecture_id
       WHERE f.user_id = ? AND f.due_at <= ? ${lectureId ? 'AND f.lecture_id = ?' : ''}
       ORDER BY f.due_at ASC LIMIT ${limit}`, ...params);
    const pending = q.get('SELECT COUNT(*) AS n FROM flashcards WHERE user_id = ? AND due_at <= ?', user.id, now)?.n || 0;
    return ok(res, {
      cards: cards.map((c) => ({
        id: c.id, front: c.front, back: c.back, reps: c.reps,
        lecture: { id: c.lecture_id, title: c.lecture_title },
      })),
      pending,
    });
  });

  router.post('/api/study/review/:cardId', async (req, res, { params }) => {
    const user = requireUser(req);
    const card = q.get('SELECT * FROM flashcards WHERE id = ? AND user_id = ?', params.cardId, user.id);
    if (!card) throw notFound('Flashcard não encontrado.');
    const { grade } = await readJson(req);
    const value = Number(grade);
    if (![0, 1, 2, 3].includes(value)) throw bad('Nota inválida.');

    const next = schedule(card, value);
    q.run('UPDATE flashcards SET ease = ?, interval_days = ?, reps = ?, lapses = ?, due_at = ? WHERE id = ?',
      next.ease, next.interval, next.reps, next.lapses, next.due, card.id);
    q.run('INSERT INTO study_log (id, user_id, lecture_id, kind, correct, total, created_at) VALUES (?,?,?,?,?,?,?)',
      uid('sl_'), user.id, card.lecture_id, 'flashcard', value > 0 ? 1 : 0, 1, nowISO());

    return ok(res, { dueAt: next.due, intervalDays: next.interval });
  });

  router.get('/api/study/quiz', async (req, res, { url }) => {
    const user = requireUser(req);
    const lectureId = url.searchParams.get('lecture');
    const limit = Math.min(30, Number(url.searchParams.get('limit') || 10));
    const rows = lectureId
      ? q.all('SELECT * FROM questions WHERE user_id = ? AND lecture_id = ? LIMIT ?', user.id, lectureId, limit)
      : q.all('SELECT * FROM questions WHERE user_id = ? ORDER BY RANDOM() LIMIT ?', user.id, limit);
    return ok(res, {
      questions: rows.map((row) => ({
        id: row.id, lectureId: row.lecture_id, prompt: row.prompt,
        options: jsonParse(row.options, []), answer: row.answer, explanation: row.explanation,
      })),
    });
  });

  router.post('/api/study/quiz/attempt', async (req, res) => {
    const user = requireUser(req);
    const { lectureId = null, correct = 0, total = 0 } = await readJson(req);
    q.run('INSERT INTO study_log (id, user_id, lecture_id, kind, correct, total, created_at) VALUES (?,?,?,?,?,?,?)',
      uid('sl_'), user.id, lectureId, 'quiz', Number(correct) || 0, Number(total) || 0, nowISO());
    return ok(res, { saved: true });
  });

  /** Painel: números do topo + atividade dos últimos 30 dias. */
  router.get('/api/stats', async (req, res) => {
    const user = requireUser(req);
    const now = nowISO();
    const lectures = q.get('SELECT COUNT(*) AS n, COALESCE(SUM(duration_ms),0) AS ms FROM lectures WHERE user_id = ?', user.id);
    const ready = q.get("SELECT COUNT(*) AS n FROM lectures WHERE user_id = ? AND status = 'ready'", user.id)?.n || 0;
    const cards = q.get('SELECT COUNT(*) AS n FROM flashcards WHERE user_id = ?', user.id)?.n || 0;
    const due = q.get('SELECT COUNT(*) AS n FROM flashcards WHERE user_id = ? AND due_at <= ?', user.id, now)?.n || 0;
    const quiz = q.get("SELECT COALESCE(SUM(correct),0) AS c, COALESCE(SUM(total),0) AS t FROM study_log WHERE user_id = ? AND kind = 'quiz'", user.id);

    const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const rows = q.all(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM study_log
       WHERE user_id = ? AND substr(created_at, 1, 10) >= ? GROUP BY day`, user.id, since);
    const byDay = new Map(rows.map((r) => [r.day, r.n]));
    const activity = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      activity.push({ day, count: byDay.get(day) || 0 });
    }

    let streak = 0;
    for (let i = activity.length - 1; i >= 0; i--) {
      if (activity[i].count > 0) streak++;
      else if (i !== activity.length - 1) break;
    }

    return ok(res, {
      lectures: lectures?.n || 0,
      ready,
      hoursRecorded: Math.round(((lectures?.ms || 0) / 3600000) * 10) / 10,
      cards, due, streak,
      quizAccuracy: quiz?.t ? Math.round((quiz.c / quiz.t) * 100) : null,
      activity,
    });
  });
}
