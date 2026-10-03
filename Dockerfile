# API server image for Render (docs/plans/move-off-replit.md).
# Debian-based (glibc): pnpm-workspace.yaml removes musl/Alpine native binaries.
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@11.19.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..." \
 && pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim
# ffmpeg/ffprobe: lecture transcription splits audio before sending it to the STT provider.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# node_modules are kept: the bundle leaves pdfjs-dist, mammoth and jszip external.
COPY --from=build /app /app
ENV NODE_ENV=production
USER node
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
