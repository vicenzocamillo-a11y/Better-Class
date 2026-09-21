import { config, aiEnabled } from '../config.js';
import { analyseLocally } from './local.js';

const SYSTEM = `Você é o motor de estudo do Better Class, um assistente que transforma a gravação de uma aula de faculdade em material de estudo de altíssima qualidade, em português do Brasil.

Regras:
- Use SOMENTE o que está na transcrição. Nunca invente dados, datas, fórmulas ou nomes.
- Se a transcrição estiver ruidosa ou incompleta, trabalhe com o que existe e sinalize lacunas em "gaps".
- Escreva como um monitor excelente: direto, claro, sem enrolação e sem repetir a pergunta.
- Priorize o que costuma cair em prova: definições, fórmulas, critérios, exceções, relações de causa e efeito.
- Responda APENAS com JSON válido, sem markdown, sem comentários.`;

const SCHEMA = `{
  "summary": {
    "tldr": "1 frase com a ideia central da aula",
    "abstract": "parágrafo de 3 a 5 frases",
    "highlights": ["5 a 8 pontos essenciais"],
    "keywords": ["6 a 12 termos-chave"]
  },
  "notes": {
    "sections": [{ "heading": "título do bloco", "bullets": ["apontamentos objetivos"] }]
  },
  "glossary": [{ "term": "termo", "definition": "definição curta" }],
  "flashcards": [{ "front": "pergunta", "back": "resposta completa mas curta" }],
  "questions": [{ "prompt": "pergunta de múltipla escolha", "options": ["a","b","c","d"], "answer": 0, "explanation": "por que a correta é correta" }],
  "review": {
    "examFocus": ["o que estudar primeiro para a prova"],
    "commonMistakes": ["erros comuns sobre este conteúdo"],
    "studyPlan": [{ "day": "Hoje", "task": "o que fazer" }]
  },
  "gaps": ["trechos que ficaram confusos na gravação e valem confirmar com o professor"]
}`;

/** Chamada crua à API da Anthropic (sem SDK). */
async function callClaude(messages, { maxTokens = 8000, system = SYSTEM } = {}) {
  const response = await fetch(config.ai.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.ai.key,
      'anthropic-version': config.ai.version,
    },
    body: JSON.stringify({ model: config.ai.model, max_tokens: maxTokens, system, messages }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`IA respondeu ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

/** Extrai JSON mesmo quando vem embrulhado em texto ou cercas de código. */
export function extractJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(trimmed); } catch { /* segue */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* segue */ }
  }
  return null;
}

/** Corta transcrições gigantes mantendo início, meio e fim. */
function fit(transcript, budget = 48000) {
  const text = String(transcript || '');
  if (text.length <= budget) return text;
  const slice = Math.floor(budget / 3);
  return [
    text.slice(0, slice),
    '\n[...trecho intermediário omitido por tamanho...]\n',
    text.slice(Math.floor(text.length / 2) - slice / 2, Math.floor(text.length / 2) + slice / 2),
    '\n[...trecho omitido...]\n',
    text.slice(-slice),
  ].join('');
}

function normalize(data, fallback) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, d = '') => (typeof v === 'string' ? v.trim() : d);
  const out = {
    engine: 'claude',
    summary: {
      tldr: str(data?.summary?.tldr) || fallback.summary.tldr,
      abstract: str(data?.summary?.abstract) || fallback.summary.abstract,
      highlights: arr(data?.summary?.highlights).map(String).filter(Boolean),
      keywords: arr(data?.summary?.keywords).map(String).filter(Boolean),
    },
    notes: {
      sections: arr(data?.notes?.sections)
        .map((s) => ({ heading: str(s?.heading, 'Bloco da aula'), bullets: arr(s?.bullets).map(String).filter(Boolean) }))
        .filter((s) => s.bullets.length),
    },
    glossary: arr(data?.glossary)
      .map((g) => ({ term: str(g?.term), definition: str(g?.definition) }))
      .filter((g) => g.term && g.definition),
    flashcards: arr(data?.flashcards)
      .map((c) => ({ front: str(c?.front), back: str(c?.back) }))
      .filter((c) => c.front && c.back),
    questions: arr(data?.questions)
      .map((q) => ({
        prompt: str(q?.prompt),
        options: arr(q?.options).map(String).filter(Boolean),
        answer: Number.isInteger(q?.answer) ? q.answer : 0,
        explanation: str(q?.explanation),
      }))
      .filter((q) => q.prompt && q.options.length >= 2 && q.answer < q.options.length),
    review: {
      examFocus: arr(data?.review?.examFocus).map(String).filter(Boolean),
      commonMistakes: arr(data?.review?.commonMistakes).map(String).filter(Boolean),
      studyPlan: arr(data?.review?.studyPlan)
        .map((p) => ({ day: str(p?.day), task: str(p?.task) }))
        .filter((p) => p.day && p.task),
    },
    gaps: arr(data?.gaps).map(String).filter(Boolean),
  };
  if (!out.summary.highlights.length) out.summary.highlights = fallback.summary.highlights;
  if (!out.notes.sections.length) out.notes = fallback.notes;
  if (!out.flashcards.length) out.flashcards = fallback.flashcards;
  if (!out.questions.length) out.questions = fallback.questions;
  if (!out.review.studyPlan.length) out.review = fallback.review;
  return out;
}

/**
 * Analisa a aula. Com ANTHROPIC_API_KEY usa o Claude;
 * sem chave (ou se a chamada falhar) cai no motor local.
 */
export async function analyseLecture({ title, course, transcript, durationMs = 0, onStep = () => {} }) {
  const fallback = analyseLocally({ title, transcript, durationMs });
  if (!aiEnabled() || String(transcript || '').trim().length < 120) {
    return { ...fallback, degraded: !aiEnabled() ? 'sem-chave' : 'transcricao-curta' };
  }
  const minutes = Math.round(durationMs / 60000);
  const prompt = `Aula: "${title || 'Sem título'}"${course ? ` — disciplina: ${course}` : ''}
Duração aproximada: ${minutes} minutos.

TRANSCRIÇÃO (pode conter erros de reconhecimento de fala):
"""
${fit(transcript)}
"""

Gere o material de estudo seguindo exatamente este formato JSON:
${SCHEMA}`;

  try {
    onStep('Conversando com o Claude…');
    const text = await callClaude([{ role: 'user', content: prompt }]);
    const parsed = extractJson(text);
    if (!parsed) throw new Error('A IA não devolveu JSON utilizável.');
    return normalize(parsed, fallback);
  } catch (error) {
    onStep(`IA indisponível (${error.message.slice(0, 120)}) — usando motor local.`);
    return { ...fallback, degraded: 'falha-ia', error: error.message.slice(0, 300) };
  }
}

/** Pergunta livre sobre a aula (chat "pergunte à aula"). */
export async function askAboutLecture({ question, transcript, title, outputs }) {
  const context = `Título: ${title}\n\nMaterial já gerado:\n${JSON.stringify(outputs || {}).slice(0, 6000)}\n\nTranscrição:\n${fit(transcript, 30000)}`;
  if (!aiEnabled()) {
    const { summarize } = await import('./local.js');
    const relevant = summarize(`${question} ${transcript}`, 4);
    return {
      engine: 'local',
      answer: relevant.length
        ? `Sem chave de IA configurada, então respondo com os trechos mais relevantes da própria aula:\n\n• ${relevant.join('\n• ')}`
        : 'Ainda não há transcrição suficiente para responder.',
    };
  }
  try {
    const answer = await callClaude(
      [{ role: 'user', content: `${context}\n\nPergunta do aluno: ${question}\n\nResponda em português do Brasil, direto ao ponto, citando o que a aula disse. Se a aula não cobre, diga isso claramente.` }],
      { maxTokens: 1500, system: 'Você é o tutor do Better Class. Responda apenas com base na aula fornecida, em português do Brasil.' },
    );
    return { engine: 'claude', answer: answer.trim() };
  } catch (error) {
    return { engine: 'erro', answer: `Não consegui falar com a IA agora (${error.message.slice(0, 140)}).` };
  }
}

/** Título automático a partir dos primeiros minutos. */
export async function suggestTitle(transcript) {
  const { keywords } = await import('./local.js');
  const local = keywords(transcript, 3).map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' · ');
  if (!aiEnabled() || transcript.trim().length < 200) return local || 'Aula sem título';
  try {
    const text = await callClaude(
      [{ role: 'user', content: `Dê um título curto (máx. 6 palavras) para esta aula:\n\n${transcript.slice(0, 4000)}\n\nResponda só com o título.` }],
      { maxTokens: 60, system: 'Você nomeia aulas de faculdade em português do Brasil. Responda apenas com o título.' },
    );
    return text.trim().replace(/^["']|["']$/g, '').slice(0, 90) || local;
  } catch {
    return local || 'Aula sem título';
  }
}
