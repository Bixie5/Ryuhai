# Ryuhai game server (serves the website and the online rooms)
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY web ./web
ENV NODE_ENV=production \
    PORT=3000 \
    TRUST_PROXY=1 \
    DATA_DIR=/data
# Accounts and shop skins live in /data. Mount a persistent disk/volume there or they are lost on redeploy.
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
USER node
CMD ["node", "server/server.js"]
