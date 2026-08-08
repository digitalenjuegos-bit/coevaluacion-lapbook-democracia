const { runChecks, state: monitorState, escalate } = require('./monitor');

async function runOnce() {
  const status = await runChecks();
  console.log(JSON.stringify({ healthy: status.healthy, consecutiveFailures: status.consecutiveFailures, results: status.results }, null, 2));
  if (!status.healthy && status.consecutiveFailures >= 3) {
    escalate(`Service unhealthy after ${status.consecutiveFailures} checks`);
  }
  process.exit(status.healthy ? 0 : 1);
}

if (require.main === module) {
  runOnce();
}

module.exports = { runOnce };
