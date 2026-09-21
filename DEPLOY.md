# Deploy do Better Class

O back-end e o front-end são **a mesma aplicação**: o servidor Node responde a `/api/*`
e serve os arquivos de `public/`. Ou seja, **um único serviço** — não existe deploy
separado de front-end.

## O que o host precisa oferecer

| Requisito | Por quê |
| --- | --- |
| Processo Node **sempre ligado** (Node 22.5+) | a fila de processamento e o SSE (`/api/events`) vivem na memória do processo |
| **Disco persistente** | `data/better-class.db` (SQLite) e os áudios das aulas |
| **HTTPS** | sem contexto seguro o navegador bloqueia o microfone e a Web Speech API |
| **Uma instância** | escalar horizontal quebraria o SSE e a fila (exigiria sticky sessions) |
| Sem buffering de resposta, corpo de até ~20 MB | conexão SSE longa e pedaços de áudio |

**Não funciona em:** Vercel, Netlify, Cloudflare Pages/Workers, Heroku ou qualquer
plataforma serverless — disco efêmero e sem conexões longas. O plano grátis do Render
também não serve (dorme e não tem disco).

## Variáveis de ambiente

| Variável | Valor | Observação |
| --- | --- | --- |
| `NODE_ENV` | `production` | liga o cookie `Secure` — exige HTTPS |
| `SESSION_SECRET` | string aleatória **fixa** | se mudar a cada deploy, todo mundo é deslogado |
| `DATA_DIR` | `/data` | aponte para o volume persistente |
| `PORT` | injetado pela plataforma | o servidor já respeita |
| `HOST` | `0.0.0.0` | já é o padrão |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | opcional: sem ela, o motor local assume |
| `ANTHROPIC_MODEL` | `claude-opus-5` | opcional |
| `TRANSCRIBE_URL` / `TRANSCRIBE_KEY` | endpoint Whisper | opcional |

Gere o segredo com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Opção 1 — Railway (mais rápido)

1. Suba o repositório para o GitHub.
2. Em [railway.app](https://railway.app): **New Project → Deploy from GitHub repo** e escolha o repositório.
   O `railway.json` já manda usar o `Dockerfile` e o healthcheck `/api/health`.
3. Aba **Variables** → adicione `SESSION_SECRET`, `DATA_DIR=/data` e, se quiser IA, `ANTHROPIC_API_KEY`.
   (`NODE_ENV` e `PORT` a plataforma já resolve.)
4. Aba **Settings → Volumes** → **Add Volume**, ponto de montagem **`/data`**, tamanho 10 GB.
5. **Settings → Networking → Generate Domain** para receber o subdomínio HTTPS.
6. Abra o domínio, crie sua conta e grave uma aula de teste.

Domínio próprio: **Settings → Custom Domain**, e aponte um `CNAME` para o host que o Railway mostrar.

## Opção 2 — Fly.io (região São Paulo)

```bash
# 1. instalar e entrar
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. criar o app com o nome que quiser (edite o campo `app` do fly.toml para bater)
fly apps create better-class

# 3. criar o volume do banco e dos áudios
fly volumes create better_class_data --size 10 --region gru

# 4. segredos
fly secrets set SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly secrets set ANTHROPIC_API_KEY=sk-ant-...     # opcional

# 5. deploy
fly deploy

# 6. abrir
fly open
```

Mantenha `min_machines_running = 1` e `auto_stop_machines = "off"` no `fly.toml`:
com a máquina dormindo, a gravação em andamento perde o destino dos pedaços de áudio.

## Opção 3 — Render

1. **New → Blueprint** apontando para o repositório (ele lê o `render.yaml`), ou **New → Web Service**
   com runtime **Docker**.
2. Escolha um plano pago (o disco persistente não existe no grátis).
3. Confirme o disco montado em `/data` e o healthcheck `/api/health`.
4. Preencha `ANTHROPIC_API_KEY` no painel, se for usar.

## Opção 4 — VPS próprio (melhor custo por GB de áudio)

Ubuntu 24.04, com Caddy cuidando do HTTPS automaticamente.

```bash
# 1. Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git caddy

# 2. código e pastas
sudo useradd -r -m -d /opt/better-class betterclass
sudo -u betterclass git clone https://github.com/<voce>/<repo>.git /opt/better-class
sudo mkdir -p /var/lib/better-class && sudo chown betterclass: /var/lib/better-class

# 3. ambiente
sudo tee /etc/better-class.env >/dev/null <<ENV
NODE_ENV=production
PORT=3000
DATA_DIR=/var/lib/better-class
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# ANTHROPIC_API_KEY=sk-ant-...
ENV
sudo chmod 600 /etc/better-class.env
```

Serviço do systemd:

```ini
# /etc/systemd/system/better-class.service
[Unit]
Description=Better Class
After=network.target

[Service]
Type=simple
User=betterclass
WorkingDirectory=/opt/better-class
EnvironmentFile=/etc/better-class.env
ExecStart=/usr/bin/node --no-warnings server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now better-class
sudo systemctl status better-class
```

Caddy (HTTPS automático, sem buffering, sem limite de corpo por padrão):

```
# /etc/caddy/Caddyfile
aulas.seudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

**Se preferir Nginx**, duas diretivas são obrigatórias — sem elas o progresso ao vivo
trava e o upload de áudio falha:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;          # SSE
    proxy_read_timeout 3600s;     # a conexão de eventos fica aberta durante a aula
    client_max_body_size 20m;     # pedaços de áudio
}
```

---

## Depois do deploy

**Teste em 2 minutos:** abra o domínio, crie a conta, vá em *Gravar aula*, autorize o
microfone, fale por uns 30 segundos e encerre. Se o material aparecer, a esteira inteira
está de pé.

**Atualizar:** Railway, Fly e Render reimplantam a cada `git push`. No VPS:

```bash
cd /opt/better-class && sudo -u betterclass git pull && sudo systemctl restart better-class
```

**Backup** (faça: é aqui que moram suas aulas):

```bash
# VPS — com o serviço rodando, o SQLite precisa do .backup para ficar consistente
sqlite3 /var/lib/better-class/better-class.db ".backup '/tmp/bc.db'"
tar czf backup-$(date +%F).tar.gz -C /var/lib/better-class uploads -C /tmp bc.db
```

Nas plataformas gerenciadas, use o snapshot do volume (Fly: `fly volumes snapshots list`).

**Espaço em disco:** uma hora de aula ocupa ~43 MB. Quatro aulas por dia, vinte dias por
mês, dão ~3,5 GB/mês — acompanhe o volume e aumente antes de encher.

**Erro comum:** se você acessar por `http://` (sem TLS) com `NODE_ENV=production`, o login
não gruda — o cookie é `Secure` e o navegador não o envia de volta. Use sempre o domínio HTTPS.
