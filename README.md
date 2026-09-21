# Better Class

**Assista à aula. O resto é automático.**

Deixe o computador gravando a aula em segundo plano. Quando você encerra, uma esteira
automática junta o áudio, transcreve, chama a IA e devolve **resumo**, **apontamentos**,
**glossário**, **flashcards com repetição espaçada**, **quiz** e um **plano de revisão** até
o dia da prova.

Interface com estética Apple — vidro, tipografia SF, animações cinematográficas
(motor próprio inspirado no anime.js e nos componentes do ReactBits).

---

## Rodando

Precisa apenas de **Node.js 22.5 ou superior**. Não há dependências para instalar —
o banco é o `node:sqlite` embutido e o front-end é JavaScript moderno sem build.

```bash
cp .env.example .env          # ajuste o SESSION_SECRET
npm start                     # http://localhost:3000
```

Comandos úteis:

```bash
npm run dev     # com recarregamento automático
npm run seed    # cria a conta demo@betterclass.app (senha: demo12345) com 3 aulas
npm run check   # verificação de ponta a ponta (sobe o servidor, importa aula, confere o material)
```

### IA (opcional, mas recomendado)

Sem chave, o app funciona inteiro usando um **motor local extrativo** que pontua frases,
extrai termos e monta o material. Com a chave da Anthropic, quem escreve é o Claude:

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5
```

### Transcrição

| Modo | Como funciona | Quando usar |
| --- | --- | --- |
| Navegador (padrão) | Web Speech API transcreve ao vivo enquanto o professor fala | Chrome/Edge, sem custo |
| Servidor (opcional) | O áudio é reenviado a um endpoint compatível com Whisper | Áudio ruim, outros navegadores |

Para ligar o modo servidor, preencha `TRANSCRIBE_URL`, `TRANSCRIBE_KEY` e `TRANSCRIBE_MODEL`.
Qualquer API no formato `/v1/audio/transcriptions` serve (OpenAI, Groq, LocalAI…).

---

## Como a gravação aguenta o mundo real

- O `MediaRecorder` entrega o áudio em **pedaços de 15s** (configurável), enviados na hora —
  se o navegador fechar, o que já subiu está salvo.
- Falha de rede entra numa **fila de reenvio com backoff** (1s, 2s, 4s, 8s, 16s) e nova
  tentativa ao encerrar a aula.
- **Wake Lock** evita que a tela durma; um aviso de `beforeunload` impede fechar a aba sem querer.
- Fontes de áudio: microfone (aula presencial), áudio da aba (aula online) ou os dois misturados.
- Pausar e retomar sem perder o cronômetro.

## A esteira de automação

```
encerrar gravação
   ├─ 1. junta os pedaços num áudio navegável
   ├─ 2. transcreve (navegador → servidor, se configurado)
   ├─ 3. IA estuda a aula (Claude ou motor local)
   └─ 4. publica resumo, apontamentos, glossário, flashcards, quiz e plano de revisão
```

A fila vive no banco: se o servidor reiniciar no meio, os trabalhos pendentes são retomados
na subida (`resumePendingJobs`). O progresso chega à interface por **SSE** (`/api/events`),
sem polling.

## Revisão espaçada

Cada flashcard guarda facilidade, intervalo, repetições e recaídas. As notas são
**Errei / Difícil / Bom / Fácil** (teclas 1–4) e um SM-2 enxuto agenda a próxima aparição —
de 10 minutos a 180 dias.

## Deploy

Back-end e front-end são o mesmo serviço: o servidor Node responde a `/api/*` e serve
`public/`. O repositório já traz `Dockerfile`, `railway.json`, `fly.toml` e `render.yaml`.
O passo a passo (Railway, Fly.io, Render e VPS com Caddy) está em **[DEPLOY.md](DEPLOY.md)**.

Requisitos do host: processo sempre ligado, disco persistente para `data/`, HTTPS
(sem ele o navegador bloqueia o microfone) e uma única instância — a fila e o SSE vivem
no processo. Plataformas serverless (Vercel, Netlify, Workers) não servem.

---

## Estrutura

```
server/
  index.js              servidor HTTP, rotas estáticas e SPA
  config.js             .env próprio, pastas e capacidades
  db.js                 esquema SQLite (node:sqlite)
  auth.js               contas, scrypt e sessões assinadas
  router.js             roteador de padrões (/api/lectures/:id/chunk)
  http.js               JSON, cookies, limites e rate limit
  routes/               auth · lectures · study
  services/
    pipeline.js         fila de trabalhos e as 4 etapas da automação
    ai.js               cliente Claude + normalização do JSON
    local.js            motor extrativo offline (resumo, cards, quiz)
    transcribe.js       Whisper opcional
    events.js           barramento SSE por usuário
  scripts/              seed.js · check.js
public/
  index.html            landing cinematográfica
  login.html  app.html  autenticação e aplicativo
  css/                  base (design system) · landing · auth · app
  js/
    motion.js           motor de animação (easings, timeline, stagger, scroll)
    effects.js          SplitText, CountUp, Magnet, Spotlight, Tilt, Aurora, Partículas
    recorder.js         gravação resiliente + transcrição ao vivo
    api.js  app.js      cliente da API e as telas do app
```

## API (resumo)

| Método | Rota | O que faz |
| --- | --- | --- |
| `POST` | `/api/auth/register` · `/login` · `/logout` | conta e sessão |
| `GET` | `/api/me` | usuário, preferências e capacidades do servidor |
| `GET/POST` | `/api/courses` | disciplinas |
| `GET/POST` | `/api/lectures` | listar e iniciar aula |
| `POST` | `/api/lectures/:id/chunk` | enviar pedaço de áudio (corpo binário) |
| `POST` | `/api/lectures/:id/transcript` | acumular transcrição ao vivo |
| `POST` | `/api/lectures/:id/stop` | encerrar e disparar a automação |
| `POST` | `/api/lectures/:id/process` | reprocessar |
| `POST` | `/api/lectures/:id/ask` | perguntar à aula |
| `GET` | `/api/lectures/:id/audio` | áudio com suporte a `Range` |
| `GET` | `/api/lectures/:id/export` | material em Markdown |
| `GET` | `/api/study/queue` · `POST /api/study/review/:id` | repetição espaçada |
| `GET` | `/api/study/quiz` · `POST /api/study/quiz/attempt` | quiz e placar |
| `GET` | `/api/stats` | números do painel |
| `GET` | `/api/events` | progresso ao vivo (SSE) |

## Privacidade

Áudios, transcrições e material ficam em `data/` no seu próprio servidor. Só sai da máquina
o texto enviado à IA — e apenas se você configurar a chave.

## Limitações conhecidas

- A transcrição ao vivo depende da Web Speech API (Chrome/Edge; o Safari varia).
- O navegador precisa continuar aberto durante a gravação — pode estar minimizado ou em outra aba.
- O motor local entrega material honesto, porém extrativo: para resumos escritos de verdade, use a chave da IA.
