# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm install --workspaces=false
WORKDIR /app/apps/backend
RUN npm install
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine

# The service binds an unprivileged port and needs no root capability.
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /app/apps/backend ./apps/backend

# The build stage installed the full tree, dev dependencies included. Strip
# them so the shipped image does not carry the compiler, linter, test runner
# or dev-only tooling as part of the production attack surface. `prisma` is a
# runtime dependency because the container applies migrations at start-up.
RUN npm prune --omit=dev --no-audit --no-fund \
 && npm cache clean --force

WORKDIR /app/apps/backend
EXPOSE 4000
USER app
CMD ["node", "dist/index.js"]
