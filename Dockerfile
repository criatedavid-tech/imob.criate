# ImobiFlow — imagem de produção
# Frontend é buildado pelo Vite (dist/) e servido pelo próprio Express
# (server.ts já serve dist/ estático quando NODE_ENV=production).
# Portável: roda igual em Fly.io, Railway, Render, Cloud Run ou VPS.

FROM node:20-slim

WORKDIR /app

# Instala TODAS as deps (vite e tsx são devDependencies, necessárias para
# buildar o front e rodar o server via tsx). Não setamos NODE_ENV aqui
# para o npm não pular as devDependencies.
COPY package*.json ./
RUN npm ci --include=dev

# Copia o código e gera o build estático do frontend
COPY . .
ARG VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED=false
ENV VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED=$VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED
RUN npm run build

# A partir daqui o processo roda em modo produção (serve dist/ estático)
ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start"]
