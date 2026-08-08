const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  projectRoot: path.resolve(__dirname, '..'),
  approvalLog: path.join(__dirname, '..', 'logs', 'approval.log'),
  backupDir: path.join(__dirname, '..', 'logs', 'backups'),
};

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.mkdirSync(path.dirname(CONFIG.approvalLog), { recursive: true });
  fs.appendFileSync(CONFIG.approvalLog, line);
}

function backupFile(relativePath) {
  const full = path.join(CONFIG.projectRoot, relativePath);
  if (!fs.existsSync(full)) return null;
  const backupName = relativePath.replace(/[\\/]/g, '__') + '.' + Date.now() + '.bak';
  const backupPath = path.join(CONFIG.backupDir, backupName);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(full, backupPath);
  return backupPath;
}

function restoreBackup(backupPath, relativePath) {
  if (!backupPath || !fs.existsSync(backupPath)) return;
  const full = path.join(CONFIG.projectRoot, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.copyFileSync(backupPath, full);
}

function applyFix(fix) {
  const file = fix.file;
  const change = fix.change;
  const relativePath = path.join('public', file);
  const fullPath = path.join(CONFIG.projectRoot, relativePath);

  if (!fs.existsSync(fullPath)) {
    return { ok: false, reason: 'file_missing', file: relativePath };
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  const original = content;
  const backupPath = backupFile(relativePath);

  try {
    switch (change) {
      case 'remove-confirm-blocking':
        content = content.replace(/confirm\(/g, '/* confirm-blocking removed */');
        break;
      case 'add-lang-es':
        if (!/<html\s+lang=/i.test(content)) {
          content = content.replace(/<html\b/i, '<html lang="es"');
        }
        break;
      case 'add-viewport':
        if (!/<meta\s+name="viewport"/i.test(content)) {
          content = content.replace(/<head\b/i, '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />');
        }
        break;
      case 'add-container-width':
        if (!/max-width:/i.test(content)) {
          content += '\n.container { max-width: 920px; margin: 0 auto; padding: 24px 16px; }\n';
        }
        break;
      case 'add-app-version':
        if (!/APP_VERSION/i.test(content)) {
          content = content.replace(/const\s+state\s*=\s*\{/, 'const APP_VERSION = "2026-08-02v1";\nconst state = {');
        }
        break;
      case 'add-migrate-storage':
        if (!/migrateStorage\b/i.test(content)) {
          content = content.replace(/function\s+toast\b/i, 'function migrateStorage() {\n  try {\n    const stored = localStorage.getItem("evaluador_v2_app_version");\n    if (stored !== APP_VERSION) {\n      Object.keys(localStorage)\n        .filter((k) => k.startsWith("evaluador_results_") || k === "evaluador_v2_app_version")\n        .forEach((k) => localStorage.removeItem(k));\n      localStorage.setItem("evaluador_v2_app_version", APP_VERSION);\n    }\n  } catch {}\n}\n\nfunction toast');
        }
        break;
      default:
        return { ok: false, reason: 'unknown_change', change };
    }

    if (content === original) {
      return { ok: false, reason: 'no_change_needed', file: relativePath };
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    log(`FIX_APPLIED change=${change} file=${relativePath} backup=${backupPath || 'none'}`);
    return { ok: true, change, file: relativePath, backupPath };
  } catch (e) {
    if (backupPath) restoreBackup(backupPath, relativePath);
    return { ok: false, reason: e.message, file: relativePath };
  }
}

function runVerification() {
  const scriptPath = path.join(CONFIG.projectRoot, 'scripts', 'verify-loop.js');
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, reason: 'verify-loop.js missing' };
  }
  try {
    const output = execSync(`node ${scriptPath}`, {
      cwd: CONFIG.projectRoot,
      encoding: 'utf8',
      timeout: 120000,
      stdio: 'pipe',
    });
    return { ok: true, output: output.trim() };
  } catch (e) {
    return { ok: false, reason: e.message, output: e.stdout?.toString?.() || '' };
  }
}

async function runAutoImprovement() {
  const { runOnce } = require('./orchestrator');
  const snapshot = await runOnce();
  const monitor = snapshot.monitor || {};
  const recovery = snapshot.recovery || {};

  let design = { pass: false, fixes: [] };
  if (monitor.healthy && recovery.action === 'none') {
    try {
      const { runDesignAudit } = require('./ui-agent');
      design = runDesignAudit();
      const fixes = design.fixes || [];

      if (fixes.length === 0) {
        log('NO_IMPROVEMENT_NEEDED');
        return { action: 'none', reason: 'healthy_and_ui_ok', snapshot, design };
      }

      const applied = [];
      for (const fix of fixes) {
        const result = applyFix(fix);
        applied.push(result);
        log(`FIX_RESULT change=${fix.change} ok=${result.ok} reason=${result.reason || ''}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const verification = runVerification();
      log(`POST_FIX_VERIFICATION ok=${verification.ok} reason=${verification.reason || ''}`);

      return {
        action: 'improved',
        fixes,
        applied,
        verification,
        snapshot,
        design,
      };
    } catch (e) {
      log(`DESIGN_AUDIT_ERROR ${e.message}`);
      return { action: 'error', reason: e.message, snapshot, design };
    }
  }

  log(`RECOVERY_NEEDED incident=${recovery.incident || 'UNKNOWN'}`);
  return { action: 'recovery', snapshot, recovery, design };
}

if (require.main === module) {
  runAutoImprovement().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}

module.exports = { runAutoImprovement, applyFix, runVerification, CONFIG };
