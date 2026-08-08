const { runOnce } = require('./orchestrator');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  maxCycles: Number(process.env.MAX_CYCLES || 8),
  cycleDelayMs: Number(process.env.CYCLE_DELAY_MS || 8000),
  projectRoot: path.resolve(__dirname, '..'),
  approvalLog: path.join(__dirname, '..', 'logs', 'approval.log'),
};

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.mkdirSync(path.dirname(CONFIG.approvalLog), { recursive: true });
  fs.appendFileSync(CONFIG.approvalLog, line);
}

async function runVerification() {
  const scriptPath = path.join(CONFIG.projectRoot, 'scripts', 'verify-loop.js');
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, reason: 'verify-loop.js missing' };
  }
  try {
    const output = execSync(`node ${scriptPath}`, {
      cwd: CONFIG.projectRoot,
      encoding: 'utf8',
      timeout: 300000,
      stdio: 'pipe',
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    return { ok: false, reason: error.message, output: error.stdout?.toString?.() || '' };
  }
}

async function runAgentCycle(cycle) {
  log(`CYCLE_START cycle=${cycle}`);
  const snapshot = await runOnce();
  const monitor = snapshot.monitor || {};
  const recovery = snapshot.recovery || {};

  if (!monitor.healthy || recovery.action !== 'none') {
    log(`CYCLE_${cycle}_NEEDS_WORK incident=${recovery.incident || 'UNKNOWN'}`);
    await new Promise((resolve) => setTimeout(resolve, CONFIG.cycleDelayMs));
    return { cycle, status: 'needs_work', snapshot };
  }

  const { runDesignAudit } = require('./ui-agent');
  const design = runDesignAudit();
  if (!design.audit.pass) {
    log(`CYCLE_${cycle}_UI_NEEDS_WORK fixes=${design.fixes.length}`);
    await new Promise((resolve) => setTimeout(resolve, CONFIG.cycleDelayMs));
    return { cycle, status: 'ui_needs_work', snapshot, design };
  }

  const { runEvaluationAgent } = require('./evaluation-agent');
  const evaluation = runEvaluationAgent();
  if (!evaluation.audit.pass || !evaluation.calibration.pass) {
    log(`CYCLE_${cycle}_EVALUATION_NEEDS_WORK fixes=${evaluation.fixes.length} calibration=${evaluation.calibration.pass}`);
    await new Promise((resolve) => setTimeout(resolve, CONFIG.cycleDelayMs));
    return { cycle, status: 'evaluation_needs_work', snapshot, design, evaluation };
  }

  const verification = await runVerification();
  log(`POST_FIX_VERIFICATION ok=${verification.ok} reason=${verification.reason || ''}`);

  if (!verification.ok) {
    log(`CYCLE_${cycle}_VERIFICATION_FAILED`);
    await new Promise((resolve) => setTimeout(resolve, CONFIG.cycleDelayMs));
    return { cycle, status: 'verification_failed', snapshot, design, evaluation };
  }

  log(`APP_READY_FOR_TESTING cycle=${cycle} verification=${verification.output || 'ok'}`);
  console.log(`APP_READY_FOR_TESTING cycle=${cycle}`);
  console.log(`Verification: ${verification.output || 'ok'}`);
  return { cycle, status: 'ready', snapshot, design, evaluation };
}

async function runLoop() {
  log(`START self-improvement-loop maxCycles=${CONFIG.maxCycles}`);

  for (let cycle = 1; cycle <= CONFIG.maxCycles; cycle++) {
    const result = await runAgentCycle(cycle);
    if (result.status === 'ready') {
      return { ready: true, cycle, result };
    }
  }

  log(`LOOP_END not_ready after=${CONFIG.maxCycles} cycles`);
  return { ready: false, cycles: CONFIG.maxCycles };
}

if (require.main === module) {
  runLoop().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ready ? 0 : 1);
  });
}

module.exports = { runLoop, CONFIG };
