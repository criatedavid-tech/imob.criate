# ImobiFlow — imagem de produção
# Frontend é buildado pelo Vite (dist/) e servido pelo próprio Express
# (server.ts já serve dist/ estático quando NODE_ENV=production).
# Portável: roda igual em Fly.io, Railway, Render, Cloud Run ou VPS.

FROM node:20-slim

WORKDIR /app

# Instala TODAS as deps: tsx roda o server em produção e o toolchain do Vite
# (@vitejs/plugin-react, @tailwindcss/vite, tailwindcss) builda o front — os
# dois são devDependencies. Não setamos NODE_ENV aqui para o npm não pulá-las.
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

# Menor privilégio: o processo não roda como root. A imagem node:*-slim já
# traz o usuário `node` (uid 1000). O app é stateless em disco — não escreve
# nada no filesystem (uploads vão para o Storage do Supabase), então leitura
# em /app basta. O chown cobre os arquivos que o COPY criou como root.
RUN chown -R node:node /app
USER node

CMD ["npm", "run", "start"]
