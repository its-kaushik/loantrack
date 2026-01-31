# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

# Prisma generate needs DATABASE_URL + DIRECT_URL at parse time even though it
# doesn't connect. Use dummy URLs since the real ones are only available at runtime.
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    npx prisma generate --schema=prisma/schema.prisma

COPY tsconfig.json ./
COPY src ./src/

RUN npx tsc

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema + config and regenerate client against production node_modules
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/prisma.config.ts ./
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    npx prisma generate --schema=prisma/schema.prisma

# Copy compiled output (tsc emits to dist/src/ since rootDir is ".")
COPY --from=builder /app/dist ./dist

# The generated Prisma client (./generated/prisma/) is resolved at runtime via
# package.json "imports" field: #generated/prisma/* → ./generated/prisma/*
# It was already generated above by prisma generate into ./generated/prisma/

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
