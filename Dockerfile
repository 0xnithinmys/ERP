# ── Build ──────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096 NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build

# ── Runtime ────────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production PORT=3000
COPY --from=build /app ./
RUN mkdir -p /app/storage/uploads
EXPOSE 3000
# Apply pending migrations (non-destructive), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && node node_modules/next/dist/bin/next start -p ${PORT}"]
