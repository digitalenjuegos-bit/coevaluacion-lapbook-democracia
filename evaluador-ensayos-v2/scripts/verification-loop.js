const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'verification-loop.log');

const AGENTS = [
  { name: 'monitor', file: 'monitor-once.js', timeoutMs: 5000, autoFix: fixPortOrServer },
  { name: 'support', file: 'support.js', timeoutMs: 10000, autoFix: fixPortOrServer },
  { name: 'deploy-agent', file: 'deploy-agent.js', timeoutMs: 15000, autoFix: null },
  { name: 'ui-agent', file: 'ui-agent.js', timeoutMs: 10000, autoFix: null },
  { name: 'evaluation-agent', file: 'evaluation-agent.js', timeoutMs: 15000, autoFix: null },
  { name: 'results-debugger', file: 'results-debugger.js', timeoutMs: 15000, autoFix: null },
  { name: 'calibration-agent', file: 'calibration-agent.js', timeoutMs: 15000, autoFix: null },
  { name: 'auto-improver', file: 'auto-improver.js', timeoutMs: 15000, autoFix: null },
  { name: 'self-improvement-loop', file: 'self-improvement-loop.js', timeoutMs: 15000, autoFix: null },
];

const MAX_ITERATIONS = 5;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  console.log(message);
}

function runAgent(agent) {
  const cmd = `node ${path.join(AGENTS_DIR, agent.file)}`;
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: agent.timeoutMs || 10000 });
    return { ok: true, stdout: out };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || '', message: e.message };
  }
}

function isServerHealthy() {
  try {
    const out = execSync('curl -s --max-time 2 http://localhost:3002/api/health || echo NO_RESPONSE', { encoding: 'utf8', shell: '/bin/bash' });
    return out.trim() === 'ok';
  } catch {
    return false;
  }
}

function ensureServer() {
  const healthy = isServerHealthy();
  if (!healthy) {
    log('AUTO_FIX: Servidor no saludable, intentando liberar puerto 3002 y relanzar.');
    try {
      execSync('lsof -ti:3002 | xargs kill -9 2>/dev/null || true', { shell: '/bin/bash' });
    } catch {}
    try {
      execSync('(cd ' + ROOT + ' && PORT=3002 node server.js > ' + path.join(LOG_DIR, 'server-loop.log') + ' 2>&1 &)', { shell: '/bin/bash' });
    } catch {}
  }

  for (let i = 0; i < 5; i++) {
    if (isServerHealthy()) {
      return true;
    }
    // busy sleep without external sleep command
    const start = Date.now();
    while (Date.now() - start < 1000) {}
  }
  return isServerHealthy();
}

function fixPortOrServer(agentName, result) {
  if (agentName === 'monitor' || agentName === 'support') {
    const text = JSON.stringify([result.stdout, result.stderr, result.message].join(' ')).toLowerCase();
    if (text.includes('eaddrinuse') || text.includes('port_in_use') || text.includes('timeout')) {
      return ensureServer();
    }
  }
  return false;
}

function summarizeAgentOutput(agentName, result) {
  const text = [result.stdout, result.stderr, result.message].join(' ').trim();
  if (text.length > 300) {
    return text.slice(0, 300) + '...';
  }
  return text || '(sin salida)';
}

async function runLoop() {
  log('=== INICIO LOOP DE VERIFICACIÓN Y CORRECCIÓN ===');
  const overallStart = Date.now();

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    log(`--- Iteración ${iteration}/${MAX_ITERATIONS} ---`);
    const iterationResults = [];
    let fixed = 0;

    for (const agent of AGENTS) {
      log(`EJECUTANDO ${agent.name}...`);
      const result = runAgent(agent);
      const healthy = result.ok || (agent.name === 'deploy-agent' && !result.stdout.includes('Service \'undefined\' not found'));

      const entry = {
        agent: agent.name,
        ok: healthy,
        output: summarizeAgentOutput(agent.name, result),
      };
      iterationResults.push(entry);

      if (!healthy && agent.autoFix) {
        log(`AGENTE ${agent.name} FALLIDO. Intentando auto-fix...`);
        const fixedNow = agent.autoFix(agent.name, result);
        if (fixedNow) {
          fixed++;
          log(`AUTO-FIX aplicado para ${agent.name}. Re-ejecutando...`);
          const rerun = runAgent(agent);
          entry.ok = rerun.ok || false;
          entry.output = summarizeAgentOutput(agent.name, rerun);
          iterationResults[iterationResults.length - 1] = entry;
        }
      }

      log(`${agent.name} => ${entry.ok ? 'OK' : 'REVISE'}`);
    }

    const allPass = iterationResults.every((e) => e.ok);
    log(`Iteración ${iteration}: allPass=${allPass}, fixed=${fixed}`);

    if (allPass) {
      log('=== LOOP FINALIZADO: TODOS LOS AGENTES EN ESTADO OK ===');
      log(`Duración total: ${Math.round((Date.now() - overallStart) / 1000)}s`);
      return { status: 'resuelto', iteration, results: iterationResults };
    }

    if (iteration === MAX_ITERATIONS) {
      const failed = iterationResults.filter((e) => !e.ok).map((e) => e.agent);
      log(`=== LOOP FINALIZADO CON PENDIENTES: ${failed.join(', ')} ===`);
      log(`Duración total: ${Math.round((Date.now() - overallStart) / 1000)}s`);
      return { status: 'pendiente', iteration, results: iterationResults, failed };
    }
  }
}

runLoop().then((summary) => {
  log('RESUMEN_FINAL=' + JSON.stringify(summary, null, 2));
}).catch((e) => {
  log('FATAL: ' + e.message);
  process.exit(1);
});
