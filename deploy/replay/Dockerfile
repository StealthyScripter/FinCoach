FROM node:22-bookworm-slim

WORKDIR /app
RUN useradd --create-home --shell /usr/sbin/nologin fincoach
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
USER fincoach
ENV NODE_ENV=production
CMD ["bash", "scripts/v2-replay/run-cloud-verify.sh"]
