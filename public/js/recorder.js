/**
 * recorder.js — gravação de aula que aguenta o mundo real.
 *
 * · grava com a aba em segundo plano, minimizada ou com a tela bloqueada
 * · envia o áudio em pedaços (padrão: 15s) — nada fica só na memória
 * · fila de reenvio com backoff se a internet oscilar
 * · transcrição ao vivo pelo navegador (Web Speech API), enviada aos poucos
 * · Wake Lock para a tela não dormir e aviso antes de fechar a aba
 */
import { api } from './api.js';

const SUPPORTED_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return SUPPORTED_MIMES.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
}

export const speechSupported = () =>
  Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

export class LectureRecorder extends EventTarget {
  constructor({ chunkSeconds = 15, liveTranscript = true, language = 'pt-BR' } = {}) {
    super();
    this.chunkSeconds = chunkSeconds;
    this.liveTranscript = liveTranscript && speechSupported();
    this.language = language;

    this.state = 'idle';          // idle · recording · paused · stopping
    this.lecture = null;
    this.startedAt = 0;
    this.pausedMs = 0;
    this.chunkIndex = 0;
    this.pendingUploads = 0;
    this.failedChunks = [];
    this.transcriptBuffer = '';
    this.transcriptSent = 0;
    this.interim = '';
    this.levels = new Uint8Array(0);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  get elapsedMs() {
    if (!this.startedAt) return 0;
    return Date.now() - this.startedAt - this.pausedMs;
  }

  /* ── Início ───────────────────────────────────────────── */
  async start({ courseId = null, title = '', source = 'mic' } = {}) {
    if (this.state !== 'idle') throw new Error('Já existe uma gravação em andamento.');
    const mime = pickMime();
    if (!mime) throw new Error('Este navegador não grava áudio. Use Chrome, Edge ou Safari recentes.');

    this.stream = await this.captureAudio(source);
    this.lecture = (await api.createLecture({ courseId, title, mime })).lecture;

    this.setupAnalyser(this.stream);
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime, audioBitsPerSecond: 96_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.queueUpload(event.data);
    };
    this.recorder.onerror = (event) => this.emit('error', event.error || new Error('Falha na gravação.'));

    this.recorder.start(this.chunkSeconds * 1000);
    this.state = 'recording';
    this.startedAt = Date.now();
    this.pausedMs = 0;

    this.keepAwake();
    this.guardUnload();
    if (this.liveTranscript) this.startSpeech();
    this.transcriptTimer = setInterval(() => this.flushTranscript(), 20_000);
    this.tickTimer = setInterval(() => this.emit('tick', { elapsedMs: this.elapsedMs }), 250);

    localStorage.setItem('bc:recording', JSON.stringify({ id: this.lecture.id, startedAt: this.startedAt }));
    this.emit('started', { lecture: this.lecture });
    return this.lecture;
  }

  /** Microfone, áudio da aula online (aba/tela) ou os dois misturados. */
  async captureAudio(source) {
    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    };
    if (source === 'mic') return navigator.mediaDevices.getUserMedia(constraints);

    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const displayAudio = display.getAudioTracks();
    display.getVideoTracks().forEach((track) => track.stop());   // só interessa o som
    if (!displayAudio.length) {
      display.getTracks().forEach((t) => t.stop());
      throw new Error('Nenhum áudio foi compartilhado. Marque "compartilhar áudio da aba" na janela do navegador.');
    }
    if (source === 'tab') return new MediaStream(displayAudio);

    // 'both' — mistura microfone + áudio da aula
    const mic = await navigator.mediaDevices.getUserMedia(constraints);
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    context.createMediaStreamSource(mic).connect(destination);
    context.createMediaStreamSource(new MediaStream(displayAudio)).connect(destination);
    this.mixContext = context;
    this.extraStreams = [mic, new MediaStream(displayAudio)];
    return destination.stream;
  }

  setupAnalyser(stream) {
    try {
      this.audioContext = new AudioContext();
      const sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.7;
      sourceNode.connect(this.analyser);
      this.levels = new Uint8Array(this.analyser.frequencyBinCount);
    } catch { /* visualização é opcional */ }
  }

  getLevels() {
    if (!this.analyser) return this.levels;
    this.analyser.getByteFrequencyData(this.levels);
    return this.levels;
  }

  /* ── Upload resiliente ────────────────────────────────── */
  async queueUpload(blob) {
    const index = this.chunkIndex++;
    this.pendingUploads++;
    this.emit('uploading', { pending: this.pendingUploads });
    await this.sendChunk(blob, index, 0);
    this.pendingUploads--;
    this.emit('uploaded', { index, pending: this.pendingUploads, bytes: blob.size });
  }

  async sendChunk(blob, index, attempt) {
    try {
      await api.uploadChunk(this.lecture.id, blob, index, this.elapsedMs);
      this.failedChunks = this.failedChunks.filter((c) => c.index !== index);
    } catch (error) {
      if (attempt >= 5) {
        this.failedChunks.push({ index, blob });
        this.emit('chunk-failed', { index, error });
        return;
      }
      const wait = Math.min(16000, 1000 * 2 ** attempt);
      this.emit('retrying', { index, attempt: attempt + 1, wait });
      await new Promise((resolve) => setTimeout(resolve, wait));
      return this.sendChunk(blob, index, attempt + 1);
    }
  }

  /** Tenta de novo os pedaços que ficaram para trás (ex.: internet voltou). */
  async retryFailed() {
    const list = [...this.failedChunks];
    this.failedChunks = [];
    for (const item of list) await this.sendChunk(item.blob, item.index, 0);
    this.emit('uploaded', { index: -1, pending: this.pendingUploads, bytes: 0 });
  }

  /* ── Transcrição ao vivo ──────────────────────────────── */
  startSpeech() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = this.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) this.transcriptBuffer += `${result[0].transcript.trim()} `;
        else interim += result[0].transcript;
      }
      this.interim = interim;
      this.emit('transcript', { text: this.transcriptBuffer, interim, chars: this.transcriptBuffer.length });
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.liveTranscript = false;
        this.emit('speech-off', { reason: event.error });
      }
    };
    recognition.onend = () => {
      // O Chrome encerra sozinho depois de um silêncio — religamos.
      if (this.state === 'recording' && this.liveTranscript) {
        try { recognition.start(); } catch { /* ignora */ }
      }
    };
    try { recognition.start(); } catch { /* ignora */ }
    this.recognition = recognition;
  }

  async flushTranscript() {
    if (!this.lecture) return;
    const text = this.transcriptBuffer.slice(this.transcriptSent).trim();
    if (!text) return;
    try {
      await api.saveTranscript(this.lecture.id, { append: text, source: 'navegador' });
      this.transcriptSent = this.transcriptBuffer.length;
    } catch { /* tenta de novo no próximo ciclo */ }
  }

  /* ── Tela acordada e aviso de saída ───────────────────── */
  async keepAwake() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        document.addEventListener('visibilitychange', this.reacquire = async () => {
          if (document.visibilityState === 'visible' && this.state === 'recording') {
            try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignora */ }
          }
        });
      }
    } catch { /* sem wake lock, seguimos mesmo assim */ }
  }

  guardUnload() {
    this.unloadGuard = (event) => {
      if (this.state !== 'recording' && this.state !== 'paused') return;
      event.preventDefault();
      event.returnValue = 'A aula ainda está sendo gravada. Quer mesmo sair?';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', this.unloadGuard);
  }

  /* ── Pausa / retomada ─────────────────────────────────── */
  pause() {
    if (this.state !== 'recording') return;
    this.recorder.pause();
    this.pausedAt = Date.now();
    this.state = 'paused';
    try { this.recognition?.stop(); } catch { /* ignora */ }
    this.emit('paused', {});
  }

  resume() {
    if (this.state !== 'paused') return;
    this.recorder.resume();
    this.pausedMs += Date.now() - this.pausedAt;
    this.state = 'recording';
    if (this.liveTranscript) { try { this.recognition?.start(); } catch { /* ignora */ } }
    this.emit('resumed', {});
  }

  /* ── Fim ──────────────────────────────────────────────── */
  async stop({ autoProcess = true } = {}) {
    if (this.state === 'idle') return null;
    this.state = 'stopping';
    this.emit('stopping', {});

    clearInterval(this.transcriptTimer);
    clearInterval(this.tickTimer);

    const lastChunk = new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') return resolve();
      this.recorder.onstop = resolve;
      this.recorder.stop();
    });
    await lastChunk;

    try { this.recognition && (this.liveTranscript = false, this.recognition.stop()); } catch { /* ignora */ }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.extraStreams?.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    try { await this.audioContext?.close(); await this.mixContext?.close(); } catch { /* ignora */ }
    try { await this.wakeLock?.release(); } catch { /* ignora */ }
    document.removeEventListener('visibilitychange', this.reacquire);
    window.removeEventListener('beforeunload', this.unloadGuard);

    // espera os uploads pendentes (com teto de 30s)
    const deadline = Date.now() + 30_000;
    while (this.pendingUploads > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (this.failedChunks.length) await this.retryFailed();
    await this.flushTranscript();

    const elapsed = this.elapsedMs;
    const result = await api.stopLecture(this.lecture.id, { durationMs: elapsed, autoProcess });

    localStorage.removeItem('bc:recording');
    this.state = 'idle';
    this.emit('stopped', { lecture: result.lecture, job: result.job, durationMs: elapsed });
    return result;
  }
}

export const formatDuration = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
};
