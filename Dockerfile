# Equity Watchlist: one small Node.js image. Data lives in MongoDB (see docker-compose.yml), never inside the container,
# so rebuilding or redeploying the container keeps every user's logins, watchlists and holdings.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT:-4173}/healthz" >/dev/null || exit 1
CMD ["node", "server.mjs"]
