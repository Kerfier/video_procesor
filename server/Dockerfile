# ─── Stage 1: client builder ─────────────────────────────────────────────────
FROM node:24-alpine AS client-builder

WORKDIR /app/client

RUN npm install -g pnpm

# Copy manifests first for layer caching
COPY client/package.json client/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY client/ ./

RUN pnpm build

# ─── Stage 2: server builder ─────────────────────────────────────────────────
FROM node:24-alpine AS server-builder

WORKDIR /app/server

RUN npm install -g pnpm

# Copy manifests first for layer caching
COPY server/package.json server/pnpm-lock.yaml ./

# Install all deps including devDependencies (TypeScript compiler, NestJS CLI)
RUN pnpm install --frozen-lockfile

COPY server/ ./

RUN pnpm build

# ─── Stage 3: production ─────────────────────────────────────────────────────
FROM node:24-alpine AS production

# ffmpeg + ffprobe: required by NestJS for HLS segmentation of uploaded files
RUN apk add --no-cache ffmpeg

WORKDIR /app

RUN npm install -g pnpm

# Copy manifests and install production dependencies only (strips devDeps)
COPY server/package.json server/pnpm-lock.yaml ./server/
RUN cd server && pnpm install --frozen-lockfile --prod

# Copy compiled NestJS output from builder
COPY --from=server-builder /app/server/dist ./server/dist

# Copy React build to the path ServeStaticModule resolves at runtime:
# join(__dirname, '..', '..', 'client', 'dist')
# __dirname = /app/server/dist  →  /app/client/dist
COPY --from=client-builder /app/client/dist ./client/dist

ENV PORT=3000
ENV PYTHON_SERVICE_URL=http://processor:8000
ENV OUTPUT_DIR=/tmp/streams

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server/dist/main"]
