const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json({ limit: '10mb' }));

// CORS: allow GitHub Pages + localhost origins to POST/GET grades
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (
    origin.includes('github.io') ||
    origin.includes('railway.app') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1')
  )) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  }
  next();
});

const quizStore = new Map();

function quizKey(examId) {
  return examId || 'default';
}

function getQuizStatus(examId) {
  const record = quizStore.get(quizKey(examId));
  return record ? record.status : { open: false };
}

function setQuizStatus(examId, status) {
  const key = quizKey(examId);
  const record = quizStore.get(key) || { grades: [] };
  record.status = status;
  quizStore.set(key, record);
}

function getQuizGrades(examId) {
  const record = quizStore.get(quizKey(examId));
  return record ? record.grades : [];
}

function addQuizGrade(examId, grade) {
  const key = quizKey(examId);
  const record = quizStore.get(key) || { grades: [], status: { open: false } };
  record.grades = record.grades || [];
  record.grades.push(grade);
  quizStore.set(key, record);
}

const RUBRICS = {
  '3bgu-liberalismo': path.join(__dirname, 'rubricas', 'rubrica-3bgu-liberalismo.json'),
  '1bgu-grecia-roma': path.join(__dirname, 'rubricas', 'rubrica-1bgu-grecia-roma.json'),
};

function loadRubric(id) {
  const file = RUBRICS[id];
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cleanText(text) {
  return String(text || '')
    .replace(/LOGOS ACADEMY.*$/gim, '')
    .replace(/Individuos y Sociedades.*BGU.*$/gim, '')
    .replace(/^\s*\d+\/\d+\s*$/gm, '')
    .replace(/Área de Individuos y Sociedades.*$/gim, '')
    .replace(/^\s*Estudiante de muestra.*$/gim, '')
    .replace(/^\s*Ensayo argumentativo individual.*$/gim, '')
    .replace(/^\s*Muestra de calibración docente.*$/gim, '')
    .replace(/^\s*No es una entrega estudiantil.*$/gim, '')
    .replace(/^\s*[A-ZÁÉÍÓÚÜ]{3,}.*?—\s*Área de Individuos y Sociedades.*$/gim, '')
    .replace(/^\s*Mr\.\s*Alberto Ottati R\..*$/gim, '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .trim();
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

function generateFeedback(criteria, body, words) {
  const feedback = [];
  for (const criterion of criteria) {
    feedback.push({ ...criterion, justificacion: `Criterio ${criterion.id}: nivel ${criterion.nivel} de ${criterion.peso}.` });
  }
  return feedback;
}

function buildCriteriaFeedback(body, words, rubricId) {
  const lower = body.toLowerCase();
  const signals = {};

  if (rubricId === '3bgu-liberalismo') {
    signals.A = {
      positive: [
        /art[ií]culo\s+\d+/i,
        /sentencia\s+\S+\s+de\s+\d+\s+de\s+\w+\s+de\s+\d{4}/i,
        /libertad\s+(como\s+)?(no\s+interferencia|negativa)/i,
        /(prestación\s+exigible|acción\s+de\s+protección|garant[íi]a\s+positiva)/i,
        /derechos\s+de\s+la\s+naturaleza/i,
        /OC-\d+\/\d+/i,
        /Opinión\s+Consultiva/i,
      ],
      negative: [
        /Juan Locke/i,
        /1889/i,
        /Declaracion de los Derechos del Hombre/i,
        /Constitucion de Montecristi del año 2010/i,
        /democracia.*liberalismo/i,
        /liberalismo.*lo mismo que la democracia/i,
      ],
    };

    signals.C = {
      positive: [],
      negative: [
        /en este ensayo voy a hablar/i,
        /en mi opinión personal/i,
        /aspectos positivos y negativos/i,
        /fue muy importante para la humanidad/i,
        /yo pienso que/i,
      ],
    };

    signals.D = {
      positive: [
        /(decide|delimit|insuﬁciente)\b.*\b(form[a-z]*|or[ií]gen|contenido)\b/i,
        /(feminista|constitucionalismo\s+garantista)/i,
        /(ciudadanos?\s+activos?\s+y\s+pasivos?|excluy[oó]?\s+del?\s+sufragio?\s+a\s+las?\s+mujeres)/i,
      ],
      negative: [
        /en este ensayo voy a hablar/i,
        /en mi opinión personal/i,
        /yo pienso que/i,
      ],
    };
  } else if (rubricId === '1bgu-grecia-roma') {
    signals.A = {
      positive: [
        /atenas|esparta|romano|roma|república|imperio|democracia|senado|cónsul/i,
        /grecia|griego|griegos/i,
        /fecha|a\.?c\.?|d\.?c\.?|siglo\s+[IVXLCDM]+/i,
        /guerra\s+del\s+peloponeso|guerras\s+púnicas|emperador|ciudadanía|derecho\s+natural/i,
        /democracia\s+ateniena|democracia\s+directa|democracia\s+indirecta|democracia\s+representativa/i,
        /exclusión\s+estructural|limitada\s+a\s+ciudadanos?\s+varones|solo\s+varones/i,
      ],
      negative: [
        /fecha inventada|no existió|antes de Cristo.*DC|mezcla de períodos sin explicación/i,
        /igualdad\s+absoluta\s+en\s+atenas/i,
        /roma\s+siempre\s+fue\s+democrática/i,
      ],
    };

    signals.C = {
      positive: [
        /tesis|introducción|desarrollo|conclusión|párrafos?/i,
        /referenc/i,
        /cita|bibliograf/i,
      ],
      negative: [
        /sin\s+separación\s+en\s+párrafos|párrafos?\s+de\s+una\s+sola\s+oración/i,
        /google|wikipedia/i,
      ],
    };

    signals.D = {
      positive: [
        /compar|contraste|continuidad|ruptura|evalu|juicio|perspectiva|alternativa/i,
        /no\s+solo\s+...\s+sino\s+también/i,
        /por\s+un\s+lado.*por\s+otro/i,
        /matices|anacrónica|marco\s+histórico|delimitando\s+dimensiones|gradada/i,
        /explicación\s+alternativa|ponder[ae]|perspectivas?\s+alternativas?|juicio\s+evaluativo/i,
      ],
      negative: [
        /muy\s+importante\s+sin\s+más|fue\s+mejor|fue\s+peor/i,
        /condena\s+anacrónica|elogio\s+sin\s+marco\s+histórico/i,
        /influyó\s+en|influyeron\s+en/i,
        /sigue\s+vigente|legado\s+importante/i,
        /tuvo\s+lugar\s+en/i,
        /se\s+desarrolló\s+en/i,
      ],
    };
  }

  const criteria = [
    { id: 'A', nombre: 'Conocimiento y Comprensión', peso: 3 },
    { id: 'C', nombre: 'Comunicación', peso: 3 },
    { id: 'D', nombre: 'Pensamiento Crítico', peso: 4 },
  ];

  for (const criterion of criteria) {
    const cfg = signals[criterion.id] || { positive: [], negative: [] };
    const positiveHits = cfg.positive.filter((r) => r.test(body)).length;
    const negativeHits = cfg.negative.filter((r) => r.test(body)).length;
    criterion.positiveHits = positiveHits;
    criterion.negativeHits = negativeHits;
  }

  return criteria;
}

function feedbackForCriterion(criterion, words) {
  const id = criterion.id;
  const nivel = criterion.nivel || 0;
  const positiveHits = criterion.positiveHits || 0;
  const negativeHits = criterion.negativeHits || 0;

  if (id === 'A') {
    if (nivel >= 3 && positiveHits >= 3 && negativeHits === 0) {
      return 'Demuestra dominio preciso de los conceptos clave y los aplica correctamente al contexto evaluado.';
    }
    if (nivel >= 2 && positiveHits >= 1 && negativeHits === 0) {
      return 'Presenta conocimiento adecuado de los contenidos, aunque podría profundizar en algunos vínculos conceptuales.';
    }
    if (nivel >= 1) {
      return negativeHits > 0
        ? 'Menciona conceptos relevantes, pero hay imprecisiones conceptuales. Revisá la definición de términos clave antes de volver a escribir.'
        : 'Menciona conceptos relevantes, pero su aplicación es superficial o incompleta. Se recomienda vincular teoría y ejemplo con mayor precisión.';
    }
    return 'El desarrollo conceptual es insuficiente. Revisá la definición de términos clave y su relación con el tema.';
  }

  if (id === 'C') {
    if (nivel >= 3 && negativeHits === 0) {
      return 'Redacción clara, coherente y cohesionada. Las ideas se presentan en orden lógico y con fluidez.';
    }
    if (nivel >= 2) {
      return 'La comunicación es comprensible y mantiene unidad temática, aunque hay margen para mejorar la cohesión entre párrafos.';
    }
    if (nivel >= 1) {
      return 'Se entiende la idea central, pero la redacción presenta rupturas o repeticiones. Trabajá la conectividad y la precisión léxica.';
    }
    return 'La redacción dificulta la comprensión. Conviene revisar la estructura del párrafo, la puntuación y la elección de palabras.';
  }

  if (id === 'D') {
    if (nivel >= 3 && positiveHits >= 1 && negativeHits === 0) {
      return 'Argumentación sólida, matizada y sustentada en referencias pertinentes. Distingue causas, consecuencias y matices.';
    }
    if (nivel >= 2) {
      return 'El razonamiento crítico está presente y tiene sustento, aunque podría contrastar más perspectivas o evaluar límites.';
    }
    if (nivel >= 1) {
      return 'Hay juicio personal, pero el sustento es débil o repetitivo. Fortalecé la argumentación con ejemplos concretos y contraste de ideas.';
    }
    return 'Predomina la opinión sin sustento. Incluye evidencia, datos o referencias concretas para apoyar cada afirmación.';
  }

  return 'Revisá este criterio para profundizar la respuesta.';
}

function evaluateEssay(textoCrudo, rubricId) {
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

  if (rubricId === '3bgu-liberalismo' || rubricId === '1bgu-grecia-roma') {
    const signals = buildCriteriaFeedback(body, words, rubricId);
    const signalMap = {};
    for (const s of signals) signalMap[s.id] = s;

    if (rubricId === '3bgu-liberalismo') {
      const factualErrors = /Juan Locke|1889|Declaracion de los Derechos del Hombre|Constitucion de Montecristi del año 2010|democracia.*liberalismo|todo el catálogo|liberalismo.*lo mismo que la democracia/i.test(body);
      const highSignals = [
        /domina.*conceptos?.*clave/i,
        /exacto|preciso/i,
        /declaración.*derechos/i,
        /constitución.*2008|artículo\s*66|artículo\s*88|artículo\s*71/i,
        /corte\s+constitucional|sentencia\s+11-18-CN\/19|OC-24\/17|corte\s+interamericana/i,
        /feminismo|movilización|marcha|paro/i,
        /no\s+es\s+deber\s+del\s+estado/i,
        /derechos?.*trabajadores?/i,
      ];
      const signalCount = highSignals.reduce((acc, regex) => acc + (regex.test(body) ? 1 : 0), 0);

      A = factualErrors ? 1 : signalCount >= 5 ? 3 : signalCount >= 3 ? 2 : 1;
      C = words >= 270 && words <= 330 ? 3 : 2;
      D = signalCount >= 5 && !factualErrors ? 4 : signalCount >= 3 ? 3 : 2;
    }

    if (rubricId === '1bgu-grecia-roma') {
      const factualErrors = /fecha inventada|no existió|antes de Cristo.*DC|mezcla de períodos sin explicación/i.test(body);
      const aPosCount = signalMap.A?.positiveHits || 0;
      const aNegCount = signalMap.A?.negativeHits || 0;
      const dPosCount = signalMap.D?.positiveHits || 0;
      const dNegCount = signalMap.D?.negativeHits || 0;

      A = factualErrors || words < 120 ? 1 : aPosCount >= 5 ? 3 : aPosCount >= 3 ? 2 : 1;
      C = words >= 270 && words <= 330 ? 3 : 2;
      D = dPosCount >= 6 && dNegCount === 0 ? 4 : dPosCount >= 4 && dNegCount <= 1 ? 3 : 2;
    }
  }

  const criteriaBase = [
    { id: 'A', nombre: 'Conocimiento y Comprensión', peso: 3, nivel: A },
    { id: 'C', nombre: 'Comunicación', peso: 3, nivel: C },
    { id: 'D', nombre: 'Pensamiento Crítico', peso: 4, nivel: D },
  ];

  const criteriaWithSignals = buildCriteriaFeedback(body, words, rubricId);
  const criteria = criteriaBase.map((c) => {
    const matched = criteriaWithSignals.find((m) => m.id === c.id) || {};
    return {
      ...c,
      justificacion: feedbackForCriterion({ ...c, ...matched }, words),
    };
  });

  const total = Number((A + C + D).toFixed(2));
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

app.get('/api/health', (req, res) => {
  res.end('ok');
});

app.get('/api/rubricas', (req, res) => {
  const list = Object.keys(RUBRICS).map((id) => {
    const rubric = loadRubric(id);
    return rubric ? { id, nombre: rubric.nombre, puntajeMaximo: rubric.puntajeMaximo } : null;
  }).filter(Boolean);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.end(JSON.stringify(list));
});

app.post('/api/evaluar', (req, res) => {
  try {
    const texto = String(req.body?.texto || '');
    const rubricId = String(req.body?.rubricaId || '3bgu-liberalismo');
    const result = evaluateEssay(texto, rubricId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.end(JSON.stringify(result));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: e.message }));
  }
});

const EXAM_SCOPE_RE = /^[A-Za-z0-9_-]+$/;

function resolveExamId(raw) {
  const value = String(raw || '').trim();
  if (!value || !EXAM_SCOPE_RE.test(value)) return null;
  return value;
}

app.get('/api/quiz/:examId/status', (req, res) => {
  const examId = resolveExamId(req.params.examId);
  if (!examId) return res.status(400).json({ error: 'invalid_exam_id' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.end(JSON.stringify(getQuizStatus(examId)));
});

app.post('/api/quiz/:examId/status', (req, res) => {
  const examId = resolveExamId(req.params.examId);
  if (!examId) return res.status(400).json({ error: 'invalid_exam_id' });
  try {
    const open = Boolean(req.body?.open);
    const status = { open, updatedAt: new Date().toISOString() };
    setQuizStatus(examId, status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.end(JSON.stringify(status));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: e.message }));
  }
});

app.get('/api/quiz/:examId/grades/csv', (req, res) => {
  const examId = resolveExamId(req.params.examId);
  if (!examId) return res.status(400).json({ error: 'invalid_exam_id' });
  const grades = getQuizGrades(examId).slice(-500);
  
  // Enhanced CSV with pedagogical columns including quiz duration
  const headers = ['Timestamp','StudentID','ExamID','Topic','Unit','Syllabus','QuestionID',
    'QuestionText','SelectedOption','CorrectOption','IsCorrect','ResponseTimeSeconds',
    'Score','DistractorAnalysis','StartTimestamp','EndTimestamp','TotalDurationSeconds'];
  
  const rows = [headers.join(',')];
  
  grades.forEach((grade, idx) => {
    const studentName = grade.studentName || `ANON_${idx}`;
    const timestamp = grade.savedAt || new Date().toISOString();
    const startT = grade.startTimestamp || timestamp;
    const endT = grade.endTimestamp || timestamp;
    const durationSec = grade.totalDurationSeconds ||
      Math.round((new Date(endT) - new Date(startT)) / 1000) || '0';
    
    if (grade.details && Array.isArray(grade.details)) {
      grade.details.forEach((detail, qIdx) => {
        const selectedChar = String.fromCharCode(65 + detail.selected);
        const correctChar = String.fromCharCode(65 + detail.correct);
        const isCorrect = detail.selected === detail.correct;
        const distractorAnalysis = isCorrect ? 'CorrectAnswer' : 
          (detail.options && detail.options[detail.selected]?.length > 
           (detail.options[detail.correct]?.length || 0) * 1.2 ? 
           'LongestDistractorSelected' : 'PlausibleDistractorSelected');
        
        rows.push([
          timestamp,
          studentName,
          examId,
          (detail.topic || '').replace(/,/g, ';'),
          (detail.unit || '').replace(/,/g, ';'),
          (detail.syllabus || '').replace(/,/g, ';'),
          qIdx + 1,
          '"'+((detail.question||'').replace(/"/g, '""'))+'"',
          selectedChar,
          correctChar,
          isCorrect ? 'TRUE' : 'FALSE',
          detail.timeSpent || '0',
          grade.score || 0,
          distractorAnalysis,
          startT,
          endT,
          durationSec
        ].join(','));
      });
    } else {
      // Fallback for simple format
      const percentage = grade.pct || Math.round((grade.score / 20) * 100);
      rows.push([
        timestamp, studentName, examId, '', '', '', '',
        '','','','','', percentage, '', startT, endT, durationSec
      ].join(','));
    }
  });
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${examId}-enhanced-report.csv"`);
  res.end(rows.join('\n'));
});

app.get('/api/quiz/:examId/grades', (req, res) => {
  const examId = resolveExamId(req.params.examId);
  if (!examId) return res.status(400).json({ error: 'invalid_exam_id' });
  const grades = getQuizGrades(examId).slice(-500);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.end(JSON.stringify(grades));
});

app.post('/api/quiz/:examId/grades', (req, res) => {
  const examId = resolveExamId(req.params.examId);
  if (!examId) return res.status(400).json({ error: 'invalid_exam_id' });
  try {
    const grade = Object.assign({}, req.body || {}, {
      savedAt: new Date().toISOString(),
      examId
    });
    addQuizGrade(examId, grade);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.status(201).end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: e.message }));
  }
});

function clearQuizGrades(examId) {
  const key = quizKey(examId);
  const record = quizStore.get(key);
  if (record) {
    record.grades = [];
    quizStore.set(key, record);
  }
}

// POST /api/quiz/:examId/clear — clear all grades for an exam
app.post('/api/quiz/:examId/clear', (req, res) => {
  const examId = resolveExamId(req.params.examId);
  if (!examId) return res.status(400).json({ error: 'invalid_exam_id' });
  if (req.body && req.body.action === 'clear_all') {
    clearQuizGrades(examId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return res.end(JSON.stringify({ ok: true, cleared: examId }));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, message: 'no action taken' }));
});

app.use(express.static(PUBLIC_DIR, {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

app.listen(PORT, () => {
  console.log(`Evaluador v2 listo en http://localhost:${PORT}`);
});
