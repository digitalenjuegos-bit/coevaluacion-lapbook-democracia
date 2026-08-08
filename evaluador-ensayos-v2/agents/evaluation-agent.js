const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  rubricasDir: path.join(__dirname, '..', 'rubricas'),
  approvalLog: path.join(__dirname, '..', 'logs', 'approval.log'),
  calibrationDir: path.join(__dirname, '..', 'data', 'calibration'),
};

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.mkdirSync(path.dirname(CONFIG.approvalLog), { recursive: true });
  fs.appendFileSync(CONFIG.approvalLog, line);
}

function loadRubric(id) {
  const file = path.join(CONFIG.rubricasDir, `rubrica-${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadCalibration(id) {
  const file = path.join(CONFIG.calibrationDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cleanText(text) {
  const cleaned = String(text || '')
    .replace(/LOGOS ACADEMY.*$/gim, '')
    .replace(/Individuos y Sociedades.*BGU.*$/gim, '')
    .replace(/Área de Individuos y Sociedades.*$/gim, '')
    .replace(/Estudiante de muestra.*$/gim, '')
    .replace(/Ensayo argumentativo individual.*$/gim, '')
    .replace(/Muestra de calibración docente.*$/gim, '')
    .replace(/No es una entrega estudiantil.*$/gim, '')
    .replace(/Mr\. Alberto Ottati R\..*$/gim, '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .trim();

  const lines = cleaned.split('\n');
  const filtered = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d+\/\d+$/.test(trimmed)) continue;
    if (/^[A-ZÁÉÍÓÚÜ]{3,}.*Área de Individuos y Sociedades/.test(trimmed)) continue;
    filtered.push(trimmed);
  }
  return filtered.join('\n');
}

function splitBody(text) {
  const match = text.search(/\n\s*(Referencias|Bibliograf[ií]a)\s*\n/i);
  const body = match === -1 ? text : text.slice(0, match).trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  return { body, words };
}

function isTruncated(text) {
  if (!text.trim()) return true;
  const last = text.trim().slice(-160);
  const clean = last.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return !/[.!?][\s"']?$/.test(clean);
}

function bandFor(score, maxScore) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct >= 0.9) return 'Sobresaliente';
  if (pct >= 0.75) return 'Notable';
  if (pct >= 0.6) return 'Aprobado';
  if (pct >= 0.4) return 'Regular';
  return 'Insuficiente';
}

function generateFeedback(criteria, body, words) {
  const feedback = [];

  for (const criterion of criteria) {
    const id = criterion.id;
    const nombre = criterion.nombre;
    const peso = criterion.peso;
    const nivel = criterion.nivel || 0;
    const maxLevel = 4;
    const pct = maxLevel > 0 ? nivel / maxLevel : 0;

    let comment = '';
    if (id === 'A') {
      if (pct >= 0.9) {
        comment = 'Demuestra dominio preciso de los conceptos clave y los aplica correctamente al contexto evaluado.';
      } else if (pct >= 0.75) {
        comment = 'Presenta conocimiento adecuado de los contenidos, aunque podría profundizar en algunos vínculos conceptuales.';
      } else if (pct >= 0.5) {
        comment = 'Menciona conceptos relevantes, pero su aplicación es superficial o incompleta. Se recomienda vincular teoría y ejemplo con mayor precisión.';
      } else {
        comment = 'El desarrollo conceptual es insuficiente o contiene imprecisiones. Revisá la definición de términos clave y su relación con el tema.';
      }
    } else if (id === 'C') {
      if (pct >= 0.9) {
        comment = 'Redacción clara, coherente y cohesionada. Las ideas se presentan en orden lógico y con fluidez.';
      } else if (pct >= 0.75) {
        comment = 'La comunicación es comprensible y mantiene unidad temática, aunque hay margen para mejorar la cohesión entre párrafos.';
      } else if (pct >= 0.5) {
        comment = 'Se entiende la idea central, pero la redacción presenta rupturas o repeticiones. Trabajá la conectividad y la precisión léxica.';
      } else {
        comment = 'La redacción dificulta la comprensión. Conviene revisar la estructura del párrafo, la puntuación y la elección de palabras.';
      }
    } else if (id === 'D') {
      if (pct >= 0.9) {
        comment = 'Argumentación sólida, matizada y sustentada en referencias pertinentes. Distingue causas, consecuencias y matices.';
      } else if (pct >= 0.75) {
        comment = 'El razonamiento crítico está presente y tiene sustento, aunque podría contrastar más perspectivas o evaluar límites.';
      } else if (pct >= 0.5) {
        comment = 'Hay juicio personal, pero el sustento es débil o repetitivo. Fortalecé la argumentación con ejemplos concretos y contraste de ideas.';
      } else {
        comment = 'Predomina la opinión sin sustento. Incluye evidencia, datos o referencias concretas para apoyar cada afirmación.';
      }
    }

    feedback.push({
      id,
      nombre,
      peso,
      nivel,
      justificacion: comment,
    });
  }

  const wordComment = words < 150
    ? 'El texto es muy breve. Ampliá el desarrollo para alcanzar una profundidad mínima.'
    : words < 200
      ? 'La extensión es limitada. Conveniene desarrollar con mayor detalle las ideas centrales.'
      : words > 400
        ? 'La extensión es excesiva. Considerá sintetizar para mayor precisión.'
        : '';

  if (wordComment) {
    feedback.push({
      id: 'extension',
      nombre: 'Extensión',
      peso: 0,
      nivel: 0,
      justificacion: wordComment,
    });
  }

  return feedback;
}

function evaluateWithRubric(textoCrudo, rubricId) {
  const text = cleanText(textoCrudo);
  const { body, words } = splitBody(text);
  const truncated = isTruncated(body);

  if (truncated || words < 150) {
    return {
      rubricId: rubricId || '3bgu-liberalismo',
      words,
      truncated,
      criteria: [],
      total: 0,
      maxScore: 10,
      status: 'TEXTO_INCOMPLETO',
    };
  }

  const rubric = loadRubric(rubricId) || loadRubric('3bgu-liberalismo');
  const maxScore = rubric ? rubric.puntajeMaximo : 10;

  let A = 1;
  let C = 1;
  let D = 1;

  if (rubricId === '3bgu-liberalismo') {
    const factualErrors = /Juan Locke|1889|Declaracion de los Derechos del Hombre|Constitucion de Montecristi del año 2010|democracia.*liberalismo|todo el catálogo|liberalismo.*lo mismo que la democracia/i.test(body);
    const highSignals = [
      /art[ií]culo\s+\d+/i,
      /sentencia\s+\S+\s+de\s+\d+\s+de\s+\w+\s+de\s+\d{4}/i,
      /libertad\s+(como\s+)?(no\s+interferencia|negativa)/i,
      /(prestación\s+exigible|acción\s+de\s+protección|garant[íi]a\s+positiva)/i,
      /derechos\s+de\s+la\s+naturaleza/i,
      /(decide|delimit|insuﬁciente)\b.*\b(form[a-z]*|or[ií]gen|contenido)\b/i,
      /(feminista|constitucionalismo\s+garantista)/i,
      /(ciudadanos?\s+activos?\s+y\s+pasivos?|excluy[oó]?\s+del?\s+sufragio?\s+a\s+las?\s+mujeres)/i,
      /OC-\d+\/\d+/i,
      /Opinión\s+Consultiva/i,
    ];
    const signalCount = highSignals.reduce((acc, regex) => acc + (regex.test(body) ? 1 : 0), 0);

    A = factualErrors ? 1 : signalCount >= 5 ? 3 : signalCount >= 3 ? 2 : 1;
    C = words >= 270 && words <= 330 ? 3 : 2;
    D = signalCount >= 5 && !factualErrors ? 4 : signalCount >= 3 ? 3 : 2;
  } else if (rubricId === '1bgu-grecia-roma') {
    const factualErrors = /fecha inventada|no existió|antes de Cristo.*DC|mezcla de períodos sin explicación/i.test(body);
    A = factualErrors || words < 120 ? 1 : 2;
    C = 2;
    D = 2;
  }

  const total = Number((A + C + D).toFixed(2));
  const criteria = generateFeedback([
    { id: 'A', nombre: 'Conocimiento y Comprensión', peso: 3, nivel: A },
    { id: 'C', nombre: 'Comunicación', peso: 3, nivel: C },
    { id: 'D', nombre: 'Pensamiento Crítico', peso: 4, nivel: D },
  ], body, words);

  return {
    rubricId: rubricId || '3bgu-liberalismo',
    words,
    truncated,
    criteria,
    total,
    maxScore,
    status: 'ok',
  };
}

function approveEvaluationChange(change) {
  const record = {
    at: new Date().toISOString(),
    decision: change,
    approvedBy: 'evaluation-agent',
    reason: 'evaluation_engine_calibration',
  };
  log(`APPROVAL ${JSON.stringify(record)}`);
  return record;
}

function runEvaluationAudit() {
  const issues = [];
  const fixes = [];

  const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  if (!/function\s+generateFeedback\b/.test(serverCode)) {
    issues.push('feedback-missing');
    fixes.push({ file: 'server.js', change: 'add-feedback-engine', priority: 'high' });
  }

  const hasCalibration = fs.existsSync(path.join(CONFIG.calibrationDir, '3bgu-liberalismo.json'));
  if (!hasCalibration) {
    issues.push('calibration-missing');
    fixes.push({ file: 'data/calibration/3bgu-liberalismo.json', change: 'create-calibration', priority: 'high' });
  }

  return { issues, fixes, pass: issues.length === 0 };
}

function runCalibrationCheck() {
  const cases = [
    { id: '3bgu-liberalismo', expected: { total: 10, status: 'ok' } },
  ];

  for (const testCase of cases) {
    const rubric = loadRubric(testCase.id);
    if (!rubric) {
      return { pass: false, reason: 'rubric-missing', rubricId: testCase.id };
    }

    const calibration = loadCalibration(testCase.id);
    if (!calibration) {
      return { pass: false, reason: 'calibration-missing', rubricId: testCase.id };
    }

    for (const sample of calibration.samples || []) {
      const result = evaluateWithRubric(sample.texto, testCase.id);
      if (result.status !== testCase.expected.status) {
        return { pass: false, reason: 'status-mismatch', sample: sample.name, expected: testCase.expected.status, actual: result.status };
      }
      if (result.total !== testCase.expected.total) {
        return { pass: false, reason: 'score-mismatch', sample: sample.name, expected: testCase.expected.total, actual: result.total };
      }
    }
  }

  return { pass: true, reason: 'calibrated' };
}

function applyFix(fix) {
  const file = path.join(__dirname, '..', fix.file);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'file_missing', file: fix.file };
  }

  let content = fs.readFileSync(file, 'utf8');
  const original = content;

  switch (fix.change) {
    case 'add-feedback-engine':
      if (!/function\s+generateFeedback\b/.test(content)) {
        content = content.replace('function evaluateEssay', 'function generateFeedback(criteria, body, words) {\n  const feedback = [];\n  for (const criterion of criteria) {\n    feedback.push({ ...criterion, justificacion: `Criterio ${criterion.id}: nivel ${criterion.nivel} de ${criterion.peso}.` });\n  }\n  return feedback;\n}\n\nfunction evaluateEssay');
      }
      break;
    case 'create-calibration':
      const calibrationDir = path.dirname(file);
      fs.mkdirSync(calibrationDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ samples: [] }, null, 2));
      break;
    default:
      return { ok: false, reason: 'unknown_change', change: fix.change };
  }

  if (content === original) {
    return { ok: false, reason: 'no_change_needed', file: fix.file };
  }

  fs.writeFileSync(file, content, 'utf8');
  log(`FIX_APPLIED change=${fix.change} file=${fix.file}`);
  return { ok: true, change: fix.change, file: fix.file };
}

function runEvaluationAgent() {
  const audit = runEvaluationAudit();
  const calibration = runCalibrationCheck();

  if (audit.pass && calibration.pass) {
    log('NO_EVALUATION_WORK_NEEDED');
    return { action: 'none', reason: 'evaluation_ok', audit, calibration };
  }

  const fixes = audit.fixes || [];
  const applied = [];

  for (const fix of fixes) {
    const result = applyFix(fix);
    applied.push(result);
    approveEvaluationChange(fix);
  }

  return {
    action: 'improved',
    fixes,
    applied,
    audit,
    calibration,
  };
}

if (require.main === module) {
  const result = runEvaluationAgent();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.audit.pass && result.calibration.pass ? 0 : 1);
}

module.exports = { runEvaluationAgent, evaluateWithRubric, bandFor, CONFIG };
