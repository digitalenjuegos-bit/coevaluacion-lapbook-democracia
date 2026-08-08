const { runChecks, state: monitorState, escalate } = require('./monitor');
const { classifyIncident, suggestFix, handleIncident, getStatus: getSupportStatus } = require('./support');
const { checkHealth, deploy, rollback, getStatus: getDeployStatus } = require('./deploy-agent');

const CONFIG = {
  runIntervalMs: Number(process.env.RUN_INTERVAL_MS || 60000),
  autoDeploy: process.env.AUTO_DEPLOY === 'true',
  autoRollback: process.env.AUTO_ROLLBACK === 'true',
};

function summarizeMonitor() {
  return {
    healthy: monitorState.healthy,
    consecutiveFailures: monitorState.consecutiveFailures,
    lastStatus: monitorState.lastStatus,
  };
}

function summarizeSupport() {
  return getSupportStatus();
}

function summarizeDeploy() {
  return getDeployStatus();
}

async function runRecovery() {
  const monitorStatus = summarizeMonitor();
  if (monitorStatus.healthy) {
    return { action: 'none', reason: 'healthy', monitor: monitorStatus };
  }

  const lastStatus = monitorStatus.lastStatus || {};
  const failedEndpoints = Object.entries(lastStatus)
    .filter(([, status]) => status && !status.ok)
    .map(([endpoint]) => endpoint);

  const incident = failedEndpoints.includes('/api/evaluar') && failedEndpoints.length >= 2
    ? 'UPSTREAM_ERROR'
    : failedEndpoints.length > 0
      ? 'ENDPOINT_FAILURE'
      : 'UNKNOWN';

  const fix = incident === 'UPSTREAM_ERROR'
    ? 'Revisar logs del servidor y dependencias caídas.'
    : 'Verificar conectividad y estado de endpoints.';

  let remediation = { incident, fix, monitor: monitorStatus, support: summarizeSupport(), deploy: summarizeDeploy() };

  if (incident === 'PORT_IN_USE') {
    const { handleIncident } = require('./support');
    const logs = require('./support').readRecentLogs();
    const supportRemediation = await handleIncident(logs);
    remediation = { ...remediation, ...supportRemediation };
    await new Promise((resolve) => setTimeout(resolve, 2000));
    remediation.postHealth = await checkHealth();
  }

  if (incident === 'UPSTREAM_ERROR') {
    if (CONFIG.autoDeploy) {
      remediation.deployAttempt = await deploy();
      await new Promise((resolve) => setTimeout(resolve, 15000));
      remediation.postHealth = await checkHealth();
    } else if (CONFIG.autoRollback) {
      remediation.rollbackAttempt = await rollback();
      await new Promise((resolve) => setTimeout(resolve, 15000));
      remediation.postHealth = await checkHealth();
    }
  }

  if (monitorStatus.consecutiveFailures >= 5) {
    escalate(`Orchestrator escalation after ${monitorStatus.consecutiveFailures} failures: ${JSON.stringify(monitorStatus.lastStatus)}`);
    remediation.escalated = true;
  }

  return remediation;
}

async function runOnce() {
  await runChecks();
  const recovery = await runRecovery();
  return {
    at: new Date().toISOString(),
    monitor: summarizeMonitor(),
    support: summarizeSupport(),
    deploy: summarizeDeploy(),
    recovery,
  };
}

function start() {
  console.log('START orchestrator');
  runOnce().then((snapshot) => {
    console.log(JSON.stringify(snapshot, null, 2));
  });

  const timer = setInterval(() => {
    runOnce().then((snapshot) => {
      console.log(JSON.stringify(snapshot, null, 2));
    });
  }, CONFIG.runIntervalMs);

  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('STOP orchestrator');
    process.exit(0);
  });
}

if (require.main === module) {
  start();
}

module.exports = { runOnce, summarizeMonitor, summarizeSupport, summarizeDeploy };
