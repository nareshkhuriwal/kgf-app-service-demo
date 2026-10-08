// Zero-dependency Node server: serves the built React app and a small status API.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const STARTED_AT = new Date();
let requestCount = 0;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function detectContainer() {
  if (fs.existsSync('/.dockerenv')) return { inContainer: true, detectedBy: '/.dockerenv present' };
  if (fs.existsSync('/run/.containerenv')) return { inContainer: true, detectedBy: '/run/.containerenv present' };
  if (process.env.KUBERNETES_SERVICE_HOST) return { inContainer: true, detectedBy: 'KUBERNETES_SERVICE_HOST set' };
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|kubepods|containerd|libpod/.test(cgroup)) {
      return { inContainer: true, detectedBy: '/proc/1/cgroup' };
    }
  } catch {
    // Not Linux, or /proc is unavailable.
  }
  return { inContainer: false, detectedBy: 'no container markers found' };
}

function detectPlatform() {
  const env = process.env;
  if (env.WEBSITE_SITE_NAME) {
    return {
      name: 'Azure App Service',
      details: {
        siteName: env.WEBSITE_SITE_NAME,
        hostname: env.WEBSITE_HOSTNAME,
        region: env.REGION_NAME,
        sku: env.WEBSITE_SKU,
        instanceId: env.WEBSITE_INSTANCE_ID?.slice(0, 12),
      },
    };
  }
  if (env.KUBERNETES_SERVICE_HOST) {
    return {
      name: 'Kubernetes',
      details: { pod: os.hostname(), namespace: env.POD_NAMESPACE, node: env.NODE_NAME },
    };
  }
  return { name: CONTAINER.inContainer ? 'Docker' : 'Local process', details: {} };
}

// Container/platform facts don't change while the process runs.
const CONTAINER = detectContainer();
const PLATFORM = detectPlatform();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function healthPayload() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };
}

function infoPayload(req) {
  const mem = process.memoryUsage();
  return {
    ...healthPayload(),
    app: {
      name: 'KGF App Service',
      version: process.env.APP_VERSION || 'dev',
      commit: process.env.GIT_COMMIT || 'unknown',
      buildTime: process.env.BUILD_TIME || 'unknown',
      environment: process.env.NODE_ENV || 'development',
    },
    container: {
      ...CONTAINER,
      hostname: os.hostname(),
    },
    platform: PLATFORM,
    runtime: {
      node: process.version,
      os: `${os.type()} ${os.release()}`,
      arch: process.arch,
      pid: process.pid,
      cpus: os.cpus().length,
      loadAverage: os.loadavg().map((n) => Number(n.toFixed(2))),
      memory: {
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        systemTotalMb: Math.round(os.totalmem() / 1048576),
        systemFreeMb: Math.round(os.freemem() / 1048576),
      },
    },
    server: {
      port: PORT,
      startedAt: STARTED_AT.toISOString(),
      requestsServed: requestCount,
    },
    request: {
      method: req.method,
      host: req.headers.host,
      clientIp: clientIp(req),
      userAgent: req.headers['user-agent'],
    },
  };
}

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  let filePath = path.join(DIST_DIR, decoded);
  // Block path traversal outside the build directory.
  if (!filePath.startsWith(DIST_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html'); // SPA fallback
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Frontend not built. Run `npm run build` first.');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    // Vite fingerprints assets, so they can be cached forever; index.html must not be.
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  requestCount += 1;
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    if (pathname === '/api/health' || pathname === '/healthz') {
      sendJson(res, 200, healthPayload());
    } else if (pathname === '/api/info') {
      sendJson(res, 200, infoPayload(req));
    } else if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found' });
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`KGF App Service listening on ${HOST}:${PORT} (container: ${CONTAINER.inContainer})`);
});

// Node ignores SIGTERM as PID 1 unless handled, which would stall `docker stop`.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
