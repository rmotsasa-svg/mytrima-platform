# Real gap closed 2026-09-17: compute.tf's own EC2 app instance installs
# Docker via user_data, but nothing existed to actually build an image
# from. This does not decide HOW an image built from this file gets onto
# that instance (ECR + a pull step, `docker save`/scp, a CI push job) —
# that's a real deploy-mechanism decision for whoever runs the first
# `terraform apply`, not one to guess at here (see compute.tf's own top
# comment). This only makes the app buildable as one.
#
# Multi-stage: the builder stage has devDependencies (typescript, the
# Nest CLI) the runtime image never needs; only dist/ and production
# node_modules cross into the final stage, keeping the shipped image
# smaller and its attack surface closer to what's actually running.
#
# NOT locally verified with a real `docker build` — same disclosed gap
# as ci.yml's own sast job (this machine has neither Docker nor a usable
# WSL distro). Every command/path here was traced against the real
# package.json (`npm run build` -> `nest build` -> dist/main.js, the
# exact same entrypoint `npm start` already uses) rather than guessed —
# verify with a real `docker build .` once this reaches a machine that
# has Docker, before relying on it.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# DISCLOSED LIMITATION, not fixed here: uploads.ts stores tenant-uploaded
# Catalog/Deal images on local disk (UPLOADS_ROOT, ./uploads) — the exact
# same limitation that file's own comment already names. A container has
# no durable local disk across a redeploy/restart, so uploads/ MUST be a
# mounted volume (or this needs to move to S3/equivalent object storage)
# before this ever holds a real tenant's files — do not skip this the
# first time a container gets replaced.
RUN mkdir -p uploads

# Runs as the image's own non-root `node` user (present on the official
# node:* images by default) rather than root — real least-privilege, not
# just a default left unexamined.
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
