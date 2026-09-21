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

const deaccent = (word) => word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Palavras relevantes preservando a grafia original (com acentos). */
function words(text) {
  return clean(text).toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length > 3 && !STOPWORDS.has(deaccent(word)) && !/^[\d-]+$/.test(word));
}

/** Tokens normalizados — usados para pontuar frases. */
export function tokenize(text) {
  return words(text).map(deaccent);
}

/** Termos-chave (uni e bigramas) devolvidos na grafia original. */
export function keywords(text, limit = 14) {
  const freq = new Map();
  const forms = new Map();
  const list = words(text);

  const bump = (key, form, weight) => {
    freq.set(key, (freq.get(key) || 0) + weight);
    if (!forms.has(key)) forms.set(key, form);
  };

  list.forEach((word, i) => {
    bump(deaccent(word), word, 1);
    if (i < list.length - 1) {
      const pair = `${word} ${list[i + 1]}`;
      bump(deaccent(pair), pair, 1.4);
    }
  });

  return [...freq.entries()]
    .filter(([key, count]) => count > (key.includes(' ') ? 2 : 1))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => forms.get(key));
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

/** Assunto de UMA frase — não depende de repetição, ao contrário de keywords(). */
function topicOf(sentence) {
  const list = words(sentence);
  if (!list.length) return '';
  let best = 0;
  list.forEach((word, i) => { if (word.length > list[best].length) best = i; });
  const next = list[best + 1];
  return titleCase(next && next.length > 4 ? `${list[best]} ${next}` : list[best]);
}

function sectionTitle(sentences, fallback) {
  const terms = keywords(sentences.join(' '), 5);
  if (!terms.length) return fallback;
  const main = terms.find((term) => term.includes(' ')) || terms[0];
  // evita títulos repetitivos do tipo "Sangue e sangue ventrículo"
  const other = terms.find((term) => term !== main && !overlaps(term, main));
  return titleCase(other ? `${main} e ${other}` : main);
}

const overlaps = (a, b) => {
  const wordsA = new Set(a.split(' '));
  return b.split(' ').some((word) => wordsA.has(word));
};

function definitions(text) {
  const out = [];
  for (const sentence of splitSentences(text)) {
    const match = sentence.match(/^(.{4,70}?)\s+(?:é|são|significa|consiste em|define-se como|chama-se|trata-se de)\s+(.{20,260})$/i);
    if (match) {
      const term = clean(match[1]).replace(/^(o|a|os|as|um|uma|esse|essa|este|esta)\s+/i, '');
      if (term.split(' ').length <= 7) out.push({ term: titleCase(term), definition: titleCase(clean(match[2])) });
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
    ...highlights.slice(0, 6).map((sentence) => ({
      front: `Explique com suas palavras: ${topicOf(sentence) || 'a ideia central desta parte da aula'}`,
      back: sentence,
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
