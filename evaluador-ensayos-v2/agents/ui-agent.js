const fs = require('fs');
const path = require('path');

const CONFIG = {
  publicDir: path.join(__dirname, '..', 'public'),
  approvalLog: path.join(__dirname, '..', 'logs', 'approval.log'),
};

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.mkdirSync(path.dirname(CONFIG.approvalLog), { recursive: true });
  fs.appendFileSync(CONFIG.approvalLog, line);
}

function readFile(name) {
  const full = path.join(CONFIG.publicDir, name);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf8');
}

function auditHtml() {
  const html = readFile('index.html');
  const issues = [];

  if (!/<html\s+lang="es"/i.test(html)) issues.push('html-lang-missing');
  if (!/<meta\s+name="viewport"/i.test(html)) issues.push('viewport-missing');
  if (!/Evaluador de ensayos/i.test(html)) issues.push('title-missing');
  if (!/id="course"/i.test(html)) issues.push('course-selector-missing');
  if (!/id="rubric"/i.test(html)) issues.push('rubric-selector-missing');
  if (!/id="evalBtn"/i.test(html)) issues.push('eval-button-missing');
  if (!/id="results"/i.test(html)) issues.push('results-area-missing');
  if (!/id="toast"/i.test(html)) issues.push('toast-missing');

  return { file: 'index.html', issues, pass: issues.length === 0 };
}

function auditCss() {
  const css = readFile('css/styles.css');
  const issues = [];

  if (!/\.container/i.test(css)) issues.push('container-missing');
  if (!/\.panel/i.test(css)) issues.push('panel-missing');
  if (!/button/i.test(css)) issues.push('button-styles-missing');
  if (!/\.results/i.test(css)) issues.push('results-styles-missing');
  if (!/\.toast/i.test(css)) issues.push('toast-styles-missing');
  if (!/max-width/i.test(css)) issues.push('max-width-missing');

  return { file: 'css/styles.css', issues, pass: issues.length === 0 };
}

function auditJs() {
  const js = readFile('js/app.js');
  const issues = [];

  if (!/function\s+toast\b/i.test(js)) issues.push('toast-function-missing');
  if (!/function\s+renderResults\b/i.test(js)) issues.push('render-results-missing');
  if (!/function\s+evaluateSelected\b/i.test(js)) issues.push('evaluate-selected-missing');
  if (!/function\s+handleFiles\b/i.test(js)) issues.push('handle-files-missing');
  if (!/function\s+clearCache\b/i.test(js)) issues.push('clear-cache-missing');
  if (!/APP_VERSION/i.test(js)) issues.push('app-version-missing');
  if (!/migrateStorage\b/i.test(js)) issues.push('migrate-storage-missing');
  if (/confirm\(\)/.test(js)) issues.push('confirm-blocking-present');

  return { file: 'js/app.js', issues, pass: issues.length === 0 };
}

function auditDesign() {
  const htmlAudit = auditHtml();
  const cssAudit = auditCss();
  const jsAudit = auditJs();

  const allIssues = [
    ...htmlAudit.issues.map((i) => `HTML: ${i}`),
    ...cssAudit.issues.map((i) => `CSS: ${i}`),
    ...jsAudit.issues.map((i) => `JS: ${i}`),
  ];

  const usefulElements = [
    'course-selector',
    'rubric-selector',
    'eval-button',
    'file-input',
    'results-area',
    'toast',
    'clear-cache',
  ];

  return {
    audits: { html: htmlAudit, css: cssAudit, js: jsAudit },
    issues: allIssues,
    pass: allIssues.length === 0,
    usefulElements,
    conclusion: allIssues.length === 0 ? 'UI_ACCEPTABLE' : 'UI_NEEDS_IMPROVEMENTS',
  };
}

function approveDesignFix(fix) {
  const record = {
    at: new Date().toISOString(),
    decision: fix,
    approvedBy: 'ui-ux-agent',
    reason: 'design_improvement_loop',
  };
  log(`APPROVAL ${JSON.stringify(record)}`);
  return record;
}

function suggestFix(audit) {
  const audits = audit.audits || {};
  const fixes = [];

  if ((audits.html?.issues || []).includes('html-lang-missing')) {
    fixes.push({ file: 'index.html', change: 'add-lang-es', priority: 'high' });
  }
  if ((audits.html?.issues || []).includes('viewport-missing')) {
    fixes.push({ file: 'index.html', change: 'add-viewport', priority: 'high' });
  }
  if ((audits.css?.issues || []).includes('max-width-missing')) {
    fixes.push({ file: 'css/styles.css', change: 'add-container-width', priority: 'medium' });
  }
  if ((audits.js?.issues || []).includes('confirm-blocking-present')) {
    fixes.push({ file: 'js/app.js', change: 'remove-confirm-blocking', priority: 'high' });
  }
  if ((audits.js?.issues || []).includes('app-version-missing')) {
    fixes.push({ file: 'js/app.js', change: 'add-app-version', priority: 'medium' });
  }
  if ((audits.js?.issues || []).includes('migrate-storage-missing')) {
    fixes.push({ file: 'js/app.js', change: 'add-migrate-storage', priority: 'medium' });
  }

  return fixes;
}

function runDesignAudit() {
  const audit = auditDesign();
  const fixes = suggestFix(audit);

  for (const fix of fixes) {
    approveDesignFix(fix);
  }

  return { audit, fixes, conclusion: audit.conclusion };
}

if (require.main === module) {
  const result = runDesignAudit();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.audit.pass ? 0 : 1);
}

module.exports = { runDesignAudit, auditDesign, suggestFix, approveDesignFix, CONFIG };
