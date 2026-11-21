# ---- Weboberfläche bauen ----
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# ---- Nur Laufzeit-Abhängigkeiten ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- Laufzeit-Image ----
FROM node:22-alpine
# ffmpeg wandelt WMA, ALAC, APE & Co. für den Browser um; tini beendet sauber
RUN apk add --no-cache ffmpeg tini
ENV NODE_ENV=production \
    PORT=8080 \
    MUSIC_DIR=/music \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=web /app/dist ./dist
COPY package.json ./
COPY server ./server
RUN mkdir -p /data /music
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]

LABEL org.opencontainers.image.title="discbox" \
      org.opencontainers.image.description="Deine CD-Sammlung in 3D – Musik vom NAS durchblättern, Cover ansehen, abspielen" \
      org.opencontainers.image.source="https://github.com/Jackdefjam/discbox" \
      org.opencontainers.image.licenses="MIT"
