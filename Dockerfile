# Better Class — imagem única: o mesmo processo serve a API e o front-end.
#
# Observações de compatibilidade:
# · sem VOLUME — o Railway rejeita essa instrução (o volume é montado por ele)
# · sem HEALTHCHECK — a plataforma faz a própria verificação em /api/health
# · sem npm install — o projeto não tem dependências, só módulos nativos do Node
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# Banco SQLite e áudios das aulas. Monte aqui o volume persistente da plataforma
# (no Railway: Settings → Volumes → Mount path /data).
RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "--no-warnings", "server/index.js"]
