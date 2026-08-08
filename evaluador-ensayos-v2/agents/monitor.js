const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3002',
  endpoints: ['/api/health', '/api/rubricas', '/api/evaluar'],
  checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS || 30000),
  maxConsecutiveFailures: Number(process.env.MAX_FAILURES || 3),
  logFile: path.join(__dirname, '..', 'logs', 'monitor.log'),
  escalationWebhook: process.env.ESCALATION_WEBHOOK || '',
};

const state = {
  consecutiveFailures: 0,
  healthy: true,
  lastStatus: {},
  startedAt: new Date().toISOString(),
};

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.mkdirSync(path.dirname(CONFIG.logFile), { recursive: true });
  fs.appendFileSync(CONFIG.logFile, line);
  console.log(line.trim());
}

function parseBaseUrl() {
  try {
    const url = new URL(CONFIG.baseUrl);
    return {
      hostname: url.hostname || 'localhost',
      port: url.port ? Number(url.port) : undefined,
      protocol: url.protocol,
    };
  } catch {
    return { hostname: 'localhost', port: 3002, protocol: 'http:' };
  }
}

function request(urlPath, options = {}) {
  return new Promise((resolve) => {
    const base = parseBaseUrl();
    const url = new URL(urlPath, CONFIG.baseUrl);
    const start = Date.now();
    const reqOptions = {
      hostname: url.hostname || base.hostname,
      port: url.port ? Number(url.port) : (base.port || (base.protocol === 'https:' ? 443 : 80)),
      path: url.pathname + (url.search || ''),
      method: options.method || 'GET',
      headers: options.headers || {},
      family: 4,
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        durationMs: Date.now() - start,
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
    });

    req.on('error', (error) => resolve({ ok: false, status: 0, durationMs: Date.now() - start, error: error.message }));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ ok: false, status: 0, durationMs: Date.now() - start, error: 'timeout' });
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function checkEndpoint(endpoint) {
  if (endpoint === '/api/evaluar') {
    const start = Date.now();
    const payload = JSON.stringify({ texto: 'Texto de prueba para monitoreo.', rubricaId: '3bgu-liberalismo' });
    const result = await request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    return { endpoint, ...result };
  }

  return { endpoint, ...(await request(endpoint)) };
}

async function runChecks() {
  const results = await Promise.all(CONFIG.endpoints.map(checkEndpoint));
  const failed = results.filter((r) => !r.ok);
  state.lastStatus = Object.fromEntries(results.map((r) => [r.endpoint, r]));

  if (failed.length > 0) {
    state.consecutiveFailures += 1;
    state.healthy = false;
    log(`FAIL ${failed.map((r) => `${r.endpoint}=${r.status}${r.error ? `(${r.error})` : ''}`).join(', ')} consecutive=${state.consecutiveFailures}`);
  } else {
    if (!state.healthy) {
      log(`RECOVERED all=${results.map((r) => r.endpoint).join(',')}`);
    }
    state.consecutiveFailures = 0;
    state.healthy = true;
  }

  return { healthy: state.healthy, consecutiveFailures: state.consecutiveFailures, results };
}

async function escalate(message) {
  log(`ESCALATION ${message}`);
  if (!CONFIG.escalationWebhook) {
    return;
  }
  try {
    await request(CONFIG.escalationWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // ignore escalation delivery errors
  }
}

function start() {
  log(`START monitor interval=${CONFIG.checkIntervalMs}ms target=${CONFIG.baseUrl}`);
  runChecks().then((status) => {
    log(`INIT status=${JSON.stringify({ healthy: status.healthy, consecutiveFailures: status.consecutiveFailures })}`);
  });

  const timer = setInterval(() => {
    runChecks().then((status) => {
      if (!status.healthy && status.consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
        escalate(`Service unhealthy after ${status.consecutiveFailures} checks: ${JSON.stringify(status.results)}`);
      }
    });
  }, CONFIG.checkIntervalMs);

  process.on('SIGINT', () => {
    clearInterval(timer);
    log('STOP monitor');
    process.exit(0);
  });
}

if (require.main === module) {
  start();
}

module.exports = { runChecks, state, CONFIG, escalate };
