const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  logFile: path.join(__dirname, '..', 'logs', 'monitor.log'),
  baseUrl: process.env.BASE_URL || 'http://localhost:3002',
  autoRestartCommand: process.env.AUTO_RESTART_COMMAND || '',
  maxAutoRestarts: Number(process.env.MAX_AUTO_RESTARTS || 2),
};

const state = {
  autoRestarts: 0,
  lastAction: null,
};

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.mkdirSync(path.dirname(CONFIG.logFile), { recursive: true });
  fs.appendFileSync(CONFIG.logFile, line);
  console.log(line.trim());
}

function readRecentLogs(maxLines = 200) {
  if (!fs.existsSync(CONFIG.logFile)) return [];
  const content = fs.readFileSync(CONFIG.logFile, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  return lines.slice(-maxLines);
}

function classifyIncident(logs) {
  const recent = logs.join('\n');
  if (/EADDRINUSE/.test(recent)) return 'PORT_IN_USE';
  if (/spawn python3 ENOENT/.test(recent)) return 'PYTHON_MISSING';
  if (/TEXTO_INCOMPLETO/.test(recent) && /0\//.test(recent)) return 'TEXT_INCOMPLETE_ZERO';
  if (/timeout/.test(recent)) return 'TIMEOUT';
  if (/502|503|504/.test(recent)) return 'UPSTREAM_ERROR';
  if (/0\/10/.test(recent) && /sin identificar/.test(recent)) return 'ZERO_IDENTITY_BUG';
  return 'UNKNOWN';
}

function suggestFix(incident) {
  switch (incident) {
    case 'PORT_IN_USE':
      return 'Liberar puerto con `lsof -ti:3001 | xargs kill -9` o cambiar puerto.';
    case 'PYTHON_MISSING':
      return 'Instalar Python en el servidor o activar evaluador JS fallback.';
    case 'TEXT_INCOMPLETE_ZERO':
      return 'Revisar detector de truncado y permitir textos terminados en referencias/URLs.';
    case 'TIMEOUT':
      return 'Aumentar timeout de request o revisar latencia de red/servidor.';
    case 'UPSTREAM_ERROR':
      return 'Revisar logs del servidor y dependencias caídas.';
    case 'ZERO_IDENTITY_BUG':
      return 'Limpiar localStorage, recargar con cache desactivado o usar botón Limpiar cache.';
    default:
      return 'Revisar logs recientes y errores de servidor.';
  }
}

async function attemptAutoRestart() {
  if (!CONFIG.autoRestartCommand) {
    return { ok: false, reason: 'NO_AUTO_RESTART_COMMAND' };
  }
  if (state.autoRestarts >= CONFIG.maxAutoRestarts) {
    return { ok: false, reason: 'MAX_RESTARTS_REACHED' };
  }
  try {
    log(`AUTO_RESTART attempt=${state.autoRestarts + 1} command=${CONFIG.autoRestartCommand}`);
    const { execSync } = require('child_process');
    execSync(CONFIG.autoRestartCommand, { stdio: 'inherit', timeout: 120000 });
    state.autoRestarts += 1;
    state.lastAction = 'AUTO_RESTART';
    return { ok: true, attempts: state.autoRestarts };
  } catch (error) {
    log(`AUTO_RESTART_FAILED ${error.message}`);
    return { ok: false, reason: error.message };
  }
}

function resolvePortInUse() {
  let port = 3002;
  try {
    const url = new URL(CONFIG.baseUrl);
    port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  } catch {
    // keep default port
  }

  log(`PORT_IN_USE_REMEDIATION_START port=${port}`);
  let safePids = [];
  try {
    const raw = execSync(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 10000 }).trim();
    const pids = raw.split('\n').filter(Boolean);
    for (const pid of pids) {
      try {
        const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8', timeout: 5000 }).trim();
        if (!cmd.includes('node server.js')) {
          safePids.push(pid);
        } else {
          log(`PORT_IN_USE_SKIP_SERVER pid=${pid} cmd=${cmd}`);
        }
      } catch {
        safePids.push(pid);
      }
    }
    if (safePids.length > 0) {
      execSync(`kill -9 ${safePids.join(' ')}`, { stdio: 'pipe', timeout: 10000 });
      log(`PORT_IN_USE_KILLED pids=${safePids.join(',')}`);
    } else {
      log('PORT_IN_USE_NO_SAFE_PIDS');
    }
  } catch (error) {
    log(`PORT_IN_USE_KILL_FAILED ${error.message}`);
  }

  state.lastAction = 'PORT_IN_USE_REMEDIATION';
  return { port, action: 'kill_port', safePids: safePids.length };
}

async function handleIncident(logs) {
  const incident = classifyIncident(logs);
  const fix = suggestFix(incident);
  log(`INCIDENT=${incident} fix=${fix}`);

  let remediation = { incident, fix, autoRestart: null };
  if (incident === 'PORT_IN_USE') {
    remediation.portRemediation = resolvePortInUse();
    remediation.autoRestart = await attemptAutoRestart();
  } else if (incident === 'UPSTREAM_ERROR') {
    remediation.autoRestart = await attemptAutoRestart();
  }

  state.lastAction = `HANDLED:${incident}`;
  return remediation;
}

function getStatus() {
  const logs = readRecentLogs();
  return {
    logs: logs.length,
    lastAction: state.lastAction,
    autoRestarts: state.autoRestarts,
    recentError: logs.filter((line) => /FAIL|ERROR|timeout|EADDRINUSE|ENOENT/.test(line)).slice(-5),
  };
}

if (require.main === module) {
  const logs = readRecentLogs();
  const incident = classifyIncident(logs);
  const fix = suggestFix(incident);
  console.log(JSON.stringify({ incident, fix, recentLogs: logs.slice(-20) }, null, 2));
}

module.exports = { classifyIncident, suggestFix, handleIncident, readRecentLogs, getStatus, CONFIG, state };
