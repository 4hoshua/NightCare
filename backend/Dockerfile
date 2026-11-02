FROM node:22.21.1-bookworm-slim AS dashboard
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
FROM node:22.21.1-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build
FROM build AS test
COPY backend/test ./test
COPY scripts/integration.mjs ./integration.mjs
COPY scripts/demo-integration.mjs ./demo-integration.mjs
RUN npm test
FROM build AS production-deps
RUN npm prune --omit=dev
FROM node:22.21.1-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 DB_PATH=/data/nightcare.sqlite STATIC_ROOT=/app/public
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=dashboard /ui/dist ./public
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node","dist/main.js"]
