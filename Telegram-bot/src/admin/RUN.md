# Telegram Airdrop Bot — Enterprise Edition

Production-ready Telegram airdrop bot with MongoDB, advanced security, admin panel, metrics, and CI/CD.

## Features
- Telegraf-based bot with modular handlers
- MongoDB storage with comprehensive indexes
- Admin REST API + panel
- Security: device fingerprinting, rate limiting, captcha flows
- Observability: Winston logs + Prometheus metrics
- Scalable deployment: Docker, docker-compose, Kubernetes (HPA)
- CI pipeline (GitHub Actions)

## Quick start (Docker Compose)
1. Copy `.env.example` to `.env` and fill required values
2. Build and run
```bash
docker compose up -d --build
```
- Admin: http://localhost:3002/admin
- API/Miniapp: http://localhost:3001

## Kubernetes (example)
1. Build and push image to your registry
2. Apply manifests
```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

## CI
GitHub Actions runs lint, typecheck, tests, and build on each PR. See `.github/workflows/ci.yml`.

## Development
```bash
npm ci
npm run dev
```

## Environment
See `.env.example`.

## Scripts
- `npm run dev` — run in dev mode
- `npm run build` — compile TypeScript
- `npm start` — build + start
- `npm run ci:validate` — typecheck + lint + format check
- `npm run test:ci` — unit/integration tests

## PM2 (cluster)
```bash
npm run build
pm2 start ecosystem.config.js
```

## Notes
- Leaderboards and referral queries are DB-driven and cached
- Point transactions include `createdAt` for index-friendly sorting
- Health: `/health`, Readiness: `/ready` on admin server
