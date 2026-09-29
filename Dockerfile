FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  fonts-noto-color-emoji \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV AUTH_DATA_PATH=/data/.wwebjs_auth

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./

RUN mkdir -p /data

VOLUME /data

EXPOSE 8080

CMD ["node", "index.js"]
