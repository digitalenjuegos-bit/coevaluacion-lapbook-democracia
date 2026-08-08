const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3002',
  productionUrl: process.env.PRODUCTION_URL || 'https://evaluador-ensayos-production.up.railway.app',
  serviceId: process.env.RAILWAY_SERVICE_ID || '',
  healthEndpoint: '/api/health',
  evaluateEndpoint: '/api/evaluar',
  deployCommand: process.env.DEPLOY_COMMAND || 'railway redeploy -s ' + (process.env.RAILWAY_SERVICE_ID || '') + ' -y',
  maxDeployAttempts: Number(process.env.MAX_DEPLOY_ATTEMPTS || 2),
  localServerPath: path.join(__dirname, '..'),
};

const state = {
  lastDeploy: null,
  lastRollback: null,
  attempts: 0,
};

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  const logFile = path.join(__dirname, '..', 'logs', 'deploy-agent.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, line);
  console.log(line.trim());
}

function request(url, options = {}) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const start = Date.now();
    const req = transport.request(parsedUrl, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          durationMs: Date.now() - start,
          body,
        });
      });
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

async function checkHealth(baseUrl) {
  const healthUrl = `${baseUrl}${CONFIG.healthEndpoint}`;
  const result = await request(healthUrl);
  if (result.ok) {
    const evaluateUrl = `${baseUrl}${CONFIG.evaluateEndpoint}`;
    const evalResult = await request(evaluateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: 'Health check', rubricaId: '3bgu-liberalismo' }),
    });
    return evalResult.ok ? evalResult : result;
  }
  return result;
}

async function checkProductionEvaluate() {
  const result = await request(`${CONFIG.productionUrl}${CONFIG.evaluateEndpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      texto: 'Grecia desarrolló la democracia ateniena en el siglo V a.C. con participación directa, aunque limitada a ciudadanos varones, excluyendo a mujeres, esclavos y extranjeros del proceso político formal. Roma organizó la república con magistraturas y el Senado, combinando elementos republicanos con dominio imperial y expansión territorial controlada. Ambos legados siguen vigentes en el derecho, la política y la cultura occidental contemporánea.',
      rubricaId: '1bgu-grecia-roma',
    }),
  });

  let parseError = false;
  let data = {};
  try {
    data = JSON.parse(result.body || '{}');
  } catch {
    parseError = true;
  }

  return {
    ok: result.ok && !parseError && !data.error,
    status: result.status,
    durationMs: result.durationMs,
    error: data.error || result.error,
    hasSignalMapError: String(data.error || '').includes('signalMap is not defined'),
    raw: data,
  };
}

function getLocalServerHash() {
  try {
    const serverPath = path.join(CONFIG.localServerPath, 'server.js');
    const content = fs.readFileSync(serverPath, 'utf8');
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  } catch {
    return null;
  }
}

async function deploy() {
  if (!CONFIG.deployCommand || CONFIG.deployCommand.includes('undefined')) {
    return { ok: false, reason: 'NO_DEPLOY_COMMAND' };
  }
  if (state.attempts >= CONFIG.maxDeployAttempts) {
    return { ok: false, reason: 'MAX_DEPLOY_ATTEMPTS_REACHED' };
  }

  try {
    log(`DEPLOY_START command=${CONFIG.deployCommand}`);
    const output = execSync(CONFIG.deployCommand, { encoding: 'utf8', timeout: 300000 });
    state.attempts += 1;
    state.lastDeploy = { at: new Date().toISOString(), output: output.slice(-500) };
    log(`DEPLOY_OK output=${state.lastDeploy.output}`);
    return { ok: true, output: state.lastDeploy.output };
  } catch (error) {
    const message = error.message || 'deploy_failed';
    log(`DEPLOY_FAILED ${message}`);
    state.lastDeploy = { at: new Date().toISOString(), error: message };
    return { ok: false, error: message };
  }
}

function getStatus() {
  return {
    lastDeploy: state.lastDeploy,
    lastRollback: state.lastRollback,
    attempts: state.attempts,
    maxDeployAttempts: CONFIG.maxDeployAttempts,
  };
}

async function runRecovery() {
  log('=== DEPLOY AGENT RECOVERY START ===');
  const localHash = getLocalServerHash();
  const localHealth = await checkHealth(CONFIG.baseUrl);
  const prodHealth = await checkHealth(CONFIG.productionUrl);
  const prodEvaluate = await checkProductionEvaluate();

  log(`Local health=${localHealth.ok ? 'OK' : 'FAIL'} Production health=${prodHealth.ok ? 'OK' : 'FAIL'} Production evaluate=${prodEvaluate.ok ? 'OK' : 'FAIL'}`);

  if (localHealth.ok && prodHealth.ok && prodEvaluate.ok) {
    state.attempts = 0;
    return { action: 'none', reason: 'healthy_and_evaluate_ok', localHealth, prodHealth, prodEvaluate };
  }

  log(`RECOVERY_NEEDED productionEvaluate=${prodEvaluate.ok ? 'OK' : 'FAIL'} error=${prodEvaluate.error || ''}`);
  const deployResult = await deploy();
  if (deployResult.ok) {
    await new Promise((resolve) => setTimeout(resolve, 20000));
    const postProdEvaluate = await checkProductionEvaluate();
    const postProdHealth = await checkHealth(CONFIG.productionUrl);
    return { action: 'deploy', result: deployResult, postProdHealth, postProdEvaluate };
  }

  return { action: 'failed', reason: 'DEPLOY_FAILED', localHealth, prodHealth, prodEvaluate, deployResult };
}

if (require.main === module) {
  runRecovery().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}

module.exports = { checkHealth, deploy, runRecovery, getStatus, CONFIG, state };
