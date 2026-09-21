import fs from 'node:fs';
import path from 'node:path';
import { config, serverTranscriptionEnabled } from '../config.js';

/**
 * Transcrição no servidor (opcional). Aceita qualquer endpoint compatível
 * com /v1/audio/transcriptions (Whisper/OpenAI, Groq, LocalAI…).
 * Sem configuração, devolve null e o app usa a transcrição ao vivo do navegador.
 */
export async function transcribeFile(filePath, { language = 'pt' } = {}) {
  if (!serverTranscriptionEnabled()) return null;
  if (!filePath || !fs.existsSync(filePath)) return null;

  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/webm' }), path.basename(filePath));
  form.append('model', config.transcribe.model);
  form.append('language', language);
  form.append('response_format', 'json');

  const response = await fetch(config.transcribe.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.transcribe.key}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Transcrição falhou (${response.status}): ${(await response.text().catch(() => '')).slice(0, 200)}`);
  }
  const data = await response.json();
  return String(data.text || '').trim() || null;
}

export const available = serverTranscriptionEnabled;
