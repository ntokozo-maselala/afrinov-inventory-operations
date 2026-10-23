# syntax=docker/dockerfile:1
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci --workspace=@afrinov/backend --include-workspace-root=false

# Prisma generation and the backend build both require the schema and sources.
COPY apps/backend apps/backend
RUN npm run build --workspace=@afrinov/backend
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime

# The service binds an unprivileged port and needs no root capability.
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/apps/backend ./apps/backend

WORKDIR /app/apps/backend
EXPOSE 4000
USER app
CMD ["node", "dist/index.js"]
