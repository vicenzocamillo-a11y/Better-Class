# Better Class — imagem única: a mesma aplicação serve a API e o front-end.
FROM node:22-alpine

# Rodar como root evita dor de cabeça com a permissão do volume montado em /data,
# que a maioria das plataformas cria pertencendo ao root.
WORKDIR /app

# Não há dependências para instalar (o projeto usa só módulos nativos do Node),
# mas copiar o package.json primeiro mantém a camada em cache.
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# Banco SQLite e áudios das aulas vivem aqui — monte um volume persistente.
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "--no-warnings", "server/index.js"]
