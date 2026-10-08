# KGF App Service Demo

A small React status page that proves the KGF app service is deployed in a container and healthy.

It shows:

- **Live health checks**: polls `/api/health` every 5 seconds and charts the response time.
- **Container proof**: whether the process runs in a container, how that was detected, and the container hostname/ID.
- **Deployment info**: app version, commit and build time.
- **Runtime info**: Node.js version, OS, CPU, memory, uptime and request count.

## Dependencies

- Runtime: `react`, `react-dom`
- Dev: `vite` (it compiles JSX itself, so no React plugin is needed)
- Server: only Node.js built-ins, with no packages

## Run locally

```bash
npm ci
npm run build
npm start            # http://localhost:8080
```

For frontend development with hot reload, run `npm start` in one terminal and `npm run dev` in another. Vite proxies `/api` to port 8080.

## API

| Endpoint          | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `GET /api/health` | Liveness check: `{ status: "ok", uptimeSeconds }`  |
| `GET /healthz`    | Same as `/api/health`, for platform probes         |
| `GET /api/info`   | Container, platform, runtime and deployment details |

## Deploy on KGF Cloud (build from source)

| Field             | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| Runtime           | Node.js (20.19+ or 22.12+)                                 |
| GitHub repository | `https://github.com/nareshkhuriwal/kgf-app-service-demo`   |
| Commit SHA        | Full 40-character SHA of the commit to deploy              |
| Build command     | `npm ci --include=dev && npm run build`                    |
| Start command     | `node server/server.js`                                    |
| Listening port    | `8080`                                                     |

Optional environment variables (`PORT` is managed by the platform):

```
NODE_ENV=production
APP_VERSION=1.0.0
GIT_COMMIT=<the commit SHA you deployed>
```

The server listens on `0.0.0.0:$PORT`.

## Run with Docker

```bash
docker build -t kgf-app-service-demo \
  --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
  --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) .
docker run --rm -p 8080:8080 kgf-app-service-demo
```

The image runs as the non-root `node` user and has a built-in `HEALTHCHECK` against `/healthz`.

## Environment variables

| Variable      | Default       | Description                    |
| ------------- | ------------- | ------------------------------ |
| `PORT`        | `8080`        | Port to listen on              |
| `HOST`        | `0.0.0.0`     | Interface to bind              |
| `APP_VERSION` | `dev`         | Version shown on the page      |
| `GIT_COMMIT`  | `unknown`     | Commit shown on the page       |
| `BUILD_TIME`  | `unknown`     | Build timestamp shown on page  |
| `NODE_ENV`    | `development` | Environment label              |
