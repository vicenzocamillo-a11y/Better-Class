/**
 * Motor local de análise — funciona sem chave de IA.
 * Extrativo: pontua frases, extrai termos, monta apontamentos,
 * flashcards e perguntas a partir da transcrição.
 */

const STOPWORDS = new Set(`a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sobre entre até após
e ou mas que se como quando onde porque pois então também já não sim muito mais menos mesmo assim isso isto aquilo
ser estar ter haver fazer poder dever ir vir ver dar dizer ficar saber
eu tu ele ela nós vós eles elas me te lhe nos vos lhes meu minha seu sua nosso nossa
é são foi eram será seria está estão tem têm há vai vão pode podem deve devem
ao aos à às pelo pela pelos pelas num numa dum duma
aqui ali lá hoje ontem amanhã agora depois antes sempre nunca talvez cada todo toda todos todas
tipo coisa gente bem ok certo vamos olha pronto tá né então aí
the and for with this that from your you are was were will can`.split(/\s+/));

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function splitSentences(text) {
  return clean(text)
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(clean)
    .filter((s) => s.length > 24);
}

export function tokenize(text) {
  return clean(text)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9çãõáéíóúâêô-]+/i)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

export function keywords(text, limit = 14) {
  const freq = new Map();
  for (const word of tokenize(text)) freq.set(word, (freq.get(word) || 0) + 1);
  // bigramas relevantes
  const words = tokenize(text);
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    freq.set(pair, (freq.get(pair) || 0) + 1.4);
  }
  return [...freq.entries()]
    .filter(([term, count]) => count > (term.includes(' ') ? 2 : 1))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

function scoreSentences(sentences, text) {
  const weights = new Map();
  for (const word of tokenize(text)) weights.set(word, (weights.get(word) || 0) + 1);
  const max = Math.max(1, ...weights.values());
  const cueWords = /(portanto|ou seja|em resumo|conclus|important|atenção|principal|defin|significa|regra|fórmula|teorema|lei de|exemplo|cai na prova|para a prova)/i;

  return sentences.map((sentence, index) => {
    const tokens = tokenize(sentence);
    if (!tokens.length) return { sentence, index, score: 0 };
    let score = tokens.reduce((sum, t) => sum + (weights.get(t) || 0) / max, 0) / Math.sqrt(tokens.length);
    if (cueWords.test(sentence)) score *= 1.45;
    if (index < sentences.length * 0.15) score *= 1.15;   // abertura
    if (index > sentences.length * 0.85) score *= 1.2;    // fecho/conclusão
    if (sentence.length > 320) score *= 0.85;
    return { sentence, index, score };
  });
}

export function summarize(text, count = 6) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];
  return scoreSentences(sentences, text)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence);
}

function chunk(array, parts) {
  if (array.length <= parts) return array.map((item) => [item]);
  const size = Math.ceil(array.length / parts);
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function sectionTitle(sentences, fallback) {
  const terms = keywords(sentences.join(' '), 3);
  if (!terms.length) return fallback;
  return titleCase(terms.slice(0, 2).join(' e '));
}

function definitions(text) {
  const out = [];
  for (const sentence of splitSentences(text)) {
    const match = sentence.match(/^(.{4,70}?)\s+(?:é|são|significa|consiste em|define-se como|chama-se|trata-se de)\s+(.{20,260})$/i);
    if (match) {
      const term = clean(match[1]).replace(/^(o|a|os|as|um|uma|esse|essa|este|esta)\s+/i, '');
      if (term.split(' ').length <= 7) out.push({ term: titleCase(term), definition: clean(match[2]) });
    }
  }
  const seen = new Set();
  return out.filter((d) => {
    const key = d.term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function buildQuestions(text, terms) {
  const sentences = scoreSentences(splitSentences(text), text).sort((a, b) => b.score - a.score);
  const questions = [];
  for (const { sentence } of sentences) {
    if (questions.length >= 6) break;
    const target = terms.find((t) => !t.includes(' ') && sentence.toLowerCase().includes(t));
    if (!target) continue;
    const distractors = terms.filter((t) => t !== target && !t.includes(' ')).slice(0, 8);
    if (distractors.length < 3) continue;
    const pool = [target, ...shuffle(distractors).slice(0, 3)];
    const options = shuffle(pool).map(titleCase);
    const regex = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    questions.push({
      prompt: `Complete a ideia da aula: "${sentence.replace(regex, '_____')}"`,
      options,
      answer: options.findIndex((o) => o.toLowerCase() === titleCase(target).toLowerCase()),
      explanation: `Na aula: “${sentence}”`,
    });
  }
  return questions;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Análise completa offline, mesmo formato devolvido pela IA. */
export function analyseLocally({ title, transcript, durationMs = 0 }) {
  const text = clean(transcript);
  const sentences = splitSentences(text);
  const terms = keywords(text, 16);
  const highlights = summarize(text, 6);
  const defs = definitions(text);

  const groups = chunk(sentences, Math.min(5, Math.max(2, Math.round(sentences.length / 8) || 2)));
  const sections = groups.map((group, i) => ({
    heading: sectionTitle(group, `Bloco ${i + 1} da aula`),
    bullets: summarize(group.join(' '), 4).map((s) => clean(s)),
  })).filter((s) => s.bullets.length);

  const cards = [
    ...defs.map((d) => ({ front: `O que é ${d.term}?`, back: d.definition })),
    ...highlights.slice(0, 6).map((s) => ({
      front: `Explique com suas palavras: ${keywords(s, 2).map(titleCase).join(' / ') || 'a ideia central'}`,
      back: s,
    })),
  ].slice(0, 12);

  const minutes = Math.max(1, Math.round(durationMs / 60000));

  return {
    engine: 'local',
    summary: {
      tldr: highlights[0] || 'Ainda não há transcrição suficiente para resumir esta aula.',
      abstract: highlights.slice(0, 3).join(' ') || '',
      highlights,
      keywords: terms.slice(0, 10).map(titleCase),
    },
    notes: { sections },
    glossary: defs,
    flashcards: cards,
    questions: buildQuestions(text, terms),
    review: {
      examFocus: terms.slice(0, 5).map((t) => `Domine ${titleCase(t)} — apareceu várias vezes na aula.`),
      commonMistakes: defs.slice(0, 3).map((d) => `Confundir a definição de ${d.term} com conceitos próximos.`),
      studyPlan: [
        { day: 'Hoje', task: `Revise os apontamentos (${minutes} min de aula → 10 min de leitura ativa).` },
        { day: 'Amanhã', task: 'Faça os flashcards no modo de repetição espaçada.' },
        { day: 'Daqui a 3 dias', task: 'Responda ao quiz sem consultar os apontamentos.' },
        { day: 'Daqui a 7 dias', task: 'Explique a aula em voz alta, como se estivesse ensinando alguém.' },
      ],
    },
  };
}
