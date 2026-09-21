let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error(
    '\n  Este projeto precisa do Node 22.13 ou superior (o módulo node:sqlite é nativo).\n' +
    `  Versão encontrada: ${process.version}. Atualize o Node e tente de novo.\n`,
  );
  process.exit(1);
}

import crypto from 'node:crypto';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  professor  TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lectures (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id         TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'recording',
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  audio_path        TEXT,
  audio_mime        TEXT NOT NULL DEFAULT 'audio/webm',
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  transcript        TEXT NOT NULL DEFAULT '',
  transcript_source TEXT NOT NULL DEFAULT '',
  live_notes        TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lectures_user ON lectures(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chunks (
  id         TEXT PRIMARY KEY,
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  path       TEXT NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_lecture ON chunks(lecture_id, idx);

CREATE TABLE IF NOT EXISTS outputs (
  id         TEXT PRIMARY KEY,
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  engine     TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  UNIQUE(lecture_id, kind)
);

CREATE TABLE IF NOT EXISTS flashcards (
  id            TEXT PRIMARY KEY,
  lecture_id    TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  front         TEXT NOT NULL,
  back          TEXT NOT NULL,
  ease          REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  reps          INTEGER NOT NULL DEFAULT 0,
  lapses        INTEGER NOT NULL DEFAULT 0,
  due_at        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_due ON flashcards(user_id, due_at);

CREATE TABLE IF NOT EXISTS questions (
  id            TEXT PRIMARY KEY,
  lecture_id    TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt        TEXT NOT NULL,
  options       TEXT NOT NULL,
  answer        INTEGER NOT NULL DEFAULT 0,
  explanation   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lecture_id TEXT,
  kind       TEXT NOT NULL,
  correct    INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_user ON study_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',
  step       TEXT NOT NULL DEFAULT '',
  progress   INTEGER NOT NULL DEFAULT 0,
  error      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_lecture ON jobs(lecture_id, created_at DESC);
`);

export const nowISO = () => new Date().toISOString();
export const uid = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

/** Helpers finos em cima do driver. */
export const q = {
  all(sql, ...params) { return db.prepare(sql).all(...params).map(plain); },
  get(sql, ...params) { const row = db.prepare(sql).get(...params); return row ? plain(row) : null; },
  run(sql, ...params) { return db.prepare(sql).run(...params); },
};

function plain(row) { return { ...row }; }

export function jsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
