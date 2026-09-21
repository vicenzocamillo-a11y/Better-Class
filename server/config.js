import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

/** .env minimalista — sem dependências externas. */
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: DATA_DIR,
  uploadDir: UPLOAD_DIR,
  publicDir: path.join(ROOT, 'public'),
  dbFile: path.join(DATA_DIR, 'better-class.db'),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionDays: 30,
  maxChunkBytes: Number(process.env.MAX_CHUNK_BYTES || 15 * 1024 * 1024),
  ai: {
    key: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    url: process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages',
    version: '2023-06-01',
  },
  transcribe: {
    url: process.env.TRANSCRIBE_URL || '',
    key: process.env.TRANSCRIBE_KEY || '',
    model: process.env.TRANSCRIBE_MODEL || 'whisper-1',
  },
  isProd: process.env.NODE_ENV === 'production',
};

export const aiEnabled = () => Boolean(config.ai.key);
export const serverTranscriptionEnabled = () => Boolean(config.transcribe.url && config.transcribe.key);
