FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Los pedidos y los sitios viven en un volumen persistente.
ENV NODE_ENV=production DATA_DIR=/datos/data SITES_DIR=/datos/sites TRUST_PROXY=1
VOLUME /datos
EXPOSE 3000
CMD ["node", "src/server.js"]
