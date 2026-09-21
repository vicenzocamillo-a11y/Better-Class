# Better Class — imagem única: o mesmo processo serve a API e o front-end.
FROM node:22-alpine

WORKDIR /app

# Não há dependências para instalar: o projeto usa apenas módulos nativos do Node.
# Copiar o package.json primeiro mantém a camada em cache entre deploys.
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# Banco SQLite e áudios das aulas. Monte aqui o volume persistente da plataforma.
RUN mkdir -p /data
EXPOSE 3000

# Usa o próprio Node em vez de curl/wget: sempre presente, sem instalar nada.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server/index.js"]
