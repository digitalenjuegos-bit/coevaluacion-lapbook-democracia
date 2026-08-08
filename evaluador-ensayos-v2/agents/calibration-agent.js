const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const CONFIG = {
  rubricasDir: path.join(__dirname, '..', 'rubricas'),
  calibrationDir: path.join(__dirname, '..', 'data', 'calibration'),
  approvalLog: path.join(__dirname, '..', 'logs', 'calibration-approval.log'),
};

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(path.dirname(CONFIG.approvalLog), { recursive: true });
  fs.appendFileSync(CONFIG.approvalLog, line);
  console.log(message);
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
    .replace(/Mr\\. Alberto Ottati R\\..*$/gim, '')
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

function buildCriteriaFeedback(body, words, rubricId) {
  const lower = body.toLowerCase();
  const signals = {};

  if (rubricId === '3bgu-liberalismo') {
    signals.A = {
      positive: [
        /domina.*conceptos?.*clave/i,
        /aplica.*contexto/i,
        /exacto|preciso/i,
        /declaración.*derechos/i,
        /constitución.*2008|artículo\s*66|artículo\s*88|artículo\s*71/i,
        /corte\s+constitucional|sentencia\s+11-18-CN\/19|OC-24\/17|corte\s+interamericana/i,
        /feminismo|movilización|marcha|paro/i,
        /no\s+es\s+deber\s+del\s+estado/i,
        /derechos?.*trabajadores?/i,
      ],
      negative: [
        /no existió|antes de Cristo.*DC|fecha inventada/i,
        /libertad.*absoluta.*sin\s+límites/i,
        /Estado\s+no\s+tiene\s+nada\s+que\s+ver/i,
      ],
    };

    signals.C = {
      positive: [
        /coheren|cohes|fluidez/i,
        /orden\s+lógico|introducción|desarrollo|conclusión/i,
        /referenc/i,
      ],
      negative: [
        /no\s+se\s+entiende|desordenado|confuso/i,
        /primera\s+persona\s+coloquial/i,
      ],
    };

    signals.D = {
      positive: [
        /contradice|matiza|crítica|perspectiva|alternativa|evolución|origen/i,
        /insuficiente|no\s+basta|también\s+es\s+necesario/i,
        /aunque|sin\s+embargo|no\s+obstante/i,
      ],
      negative: [
        /solo\s+importa\s+la\s+forma/i,
        /el\s+liberalismo\s+lo\s+explica\s+todo/i,
        /no\s+hay\s+nada\s+más\s+que\s+analizar/i,
      ],
    };
  }

  if (rubricId === '1bgu-grecia-roma') {
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

  const criteriaWithSignals = Object.keys(signals).map((id) => {
    const set = signals[id] || {};
    const posCount = (set.positive || []).reduce((acc, r) => acc + (r.test(body) ? 1 : 0), 0);
    const negCount = (set.negative || []).reduce((acc, r) => acc + (r.test(body) ? 1 : 0), 0);
    return { id, posCount, negCount };
  });

  return criteriaWithSignals;
}

function bandFor(score, maxScore) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct >= 0.9) return 'Sobresaliente';
  if (pct >= 0.75) return 'Notable';
  if (pct >= 0.6) return 'Aprobado';
  if (pct >= 0.4) return 'Regular';
  return 'Insuficiente';
}

function feedbackForCriterion(criterion, words) {
  const id = criterion.id;
  const nombre = criterion.nombre;
  const peso = criterion.peso;
  const nivel = criterion.nivel || 0;
  const positiveHits = criterion.posCount || 0;
  const negativeHits = criterion.negCount || 0;
  const maxLevel = 4;
  const pct = maxLevel > 0 ? nivel / maxLevel : 0;

  if (id === 'A') {
    if (pct >= 0.9 && positiveHits >= 2) {
      return 'Demuestra dominio preciso de los conceptos clave y los aplica correctamente al contexto evaluado.';
    }
    if (pct >= 0.75 && positiveHits >= 1) {
      return 'Presenta conocimiento adecuado de los contenidos, aunque podría profundizar en algunos vínculos conceptuales.';
    }
    if (pct >= 0.5) {
      return 'Menciona conceptos relevantes, pero su aplicación es superficial o incompleta. Se recomienda vincular teoría y ejemplo con mayor precisión.';
    }
    return 'El desarrollo conceptual es insuficiente o contiene imprecisiones. Revisá la definición de términos clave y su relación con el tema.';
  }

  if (id === 'C') {
    if (pct >= 0.9) {
      return 'Redacción clara, coherente y cohesionada. Las ideas se presentan en orden lógico y con fluidez.';
    }
    if (pct >= 0.75) {
      return 'La comunicación es comprensible y mantiene unidad temática, aunque hay margen para mejorar la cohesión entre párrafos.';
    }
    if (pct >= 0.5) {
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

async function evaluateViaServer(textoCrudo, rubricId) {
  const rid = String(rubricId || '3bgu-liberalismo');
  const payload = JSON.stringify({ texto: textoCrudo, rubricaId: rid });
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3002, path: '/api/evaluar', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch {
          resolve({ error: Buffer.concat(chunks).toString('utf-8') });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  if (result.error) {
    throw new Error(`evaluation error: ${result.error}`);
  }
  return result;
}

function evaluateWithRubric(textoCrudo, rubricId) {
  return evaluateViaServer(textoCrudo, rubricId);
}

function gradeRubricSample(rubricId, text, expectedTotal, expectedBand) {
  return new Promise(async (resolve, reject) => {
    try {
      const result = await evaluateViaServer(text, rubricId);
      const actualBand = bandFor(result.total, result.maxScore);
      const withinTolerance = Math.abs(result.total - expectedTotal) <= 0.5;

      resolve({
        rubricId,
        expectedTotal,
        actualTotal: result.total,
        withinTolerance,
        expectedBand,
        actualBand,
        pass: withinTolerance && actualBand === expectedBand && result.status === 'ok',
        result,
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function runCalibration() {
  log('=== Inicio calibración agentes ===');

  const samples = [
    {
      id: '1bgu-grecia-roma',
      cases: [
        {
          name: 'Grecia y Roma bajo',
          text: 'Grecia desarrolló la democracia ateniena en el siglo V a.C. con participación directa, aunque limitada a ciudadanos varones, excluyendo a mujeres, esclavos y extranjeros del proceso político formal. Roma organizó la república con magistraturas y el Senado, combinando elementos republicanos con dominio imperial y expansión territorial controlada. Ambos legados siguen vigentes en el derecho, la política y la cultura occidental contemporánea. Sin embargo, compararlos requiere matices importantes: Atenas excluía a amplios sectores de la participación, mientras Roma amplió la ciudadanía de forma gradual y desigual. Esa diferencia muestra cómo dos modelos políticos antiguos pueden ser estudiados sin caer en condenas anacrónicas ni elogios vacíos. Un análisis crítico debe separar continuidad institucional de ruptura en la legitimidad. Por eso es útil examinar no solo los hechos aislados, sino también las limitaciones y consecuencias de cada sistema. Solo así la comparación deja de ser puramente descriptiva y se convierte en un juicio evaluativo verdaderamente fundamentado sobre Grecia y Roma.',
          expectedTotal: 7,
          expectedBand: 'Aprobado',
        },
        {
          name: 'Grecia y Roma medio',
          text: 'Grecia desarrolló la democracia ateniena en el siglo V a.C. con participación directa, aunque limitada a ciudadanos varones, excluyendo a mujeres, esclavos y extranjeros del proceso político formal. Roma organizó la república con magistraturas y el Senado, combinando elementos republicanos con dominio imperial y expansión territorial controlada. Ambos legados siguen vigentes en el derecho, la política y la cultura occidental contemporánea. Ambos sistemas políticos mostraron fortalezas y debilidades que todavía se discuten. La comparación es viable si se distingue continuidad y ruptura, sin condenar con criterios actuales. Eso permite un juicio evaluativo más riguroso sobre ambos modelos políticos. Sin embargo, el texto no desarrolla una explicación alternativa que pondere por qué un modelo fue más limitado que el otro en la práctica institucional. Quedan enunciados juicios como muy importante, pero sin delimitación de dimensiones ni contraste suficiente. A pesar de eso, el ensayo ya distingue continuidades y diferencias relevantes, por lo que la calificación debería subir respecto al nivel bajo.',
          expectedTotal: 7,
          expectedBand: 'Aprobado',
        },
        {
          name: 'Grecia y Roma alto',
          text: 'Grecia y Roma ofrecen dos modelos políticos distintos: Atenas combinó participación directa con exclusión estructural, mientras Roma trasladó la institucionalidad al derecho y a la magistratura. Una alternativa común es leer ambos como precedentes de democracia moderna, pero esa lectura homogeneiza diferencias de escala, ciudadanía y control territorial. Un enfoque más útil separa continuidad institucional de ruptura en la legitimidad, y así el juicio crítico queda gradado en sus límites históricos sin caer en condenas anacrónicas ni elogios sin marco. Por un lado, la democracia ateniesa muestra el origen de la participación directa en instituciones limitadas; por otro, el modelo romano muestra cómo esa participación se convirtió en procedimiento, control territorial y derecho codificado. Esa comparación evita equilibrios simétricos vacíos y permite una explicación alternativa que pondera ambas tradiciones sin reducir una a simple antecesora de la otra. Así el ensayo cumple con el criterio de pensamiento crítico exigido en la rúbrica 1BGU de Grecia y Roma.',
          expectedTotal: 8,
          expectedBand: 'Notable',
        },
      ],
    },
  ];

  const approvalRequired = process.env.REQUIRE_APPROVAL === 'true';
  const results = [];

  for (const group of samples) {
    log(`Calibrando: ${group.id}`);
    for (const sample of group.cases) {
      const graded = await gradeRubricSample(group.id, sample.text, sample.expectedTotal, sample.expectedBand);
      results.push(graded);
      log(`- ${sample.name}: ${graded.actualTotal}/${graded.expectedTotal} => ${graded.pass ? 'OK' : 'REVISE'} | banda=${graded.actualBand}`);
    }
  }

  const pass = results.every((r) => r.pass);
  log(`Calibración 1BGU: ${pass ? 'APROBADA' : 'REQUIERE AJUSTE'}`);

  if (approvalRequired && !pass) {
    const needsFix = results.filter((r) => !r.pass).map((r) => ({
      rubricId: r.rubricId,
      expected: r.expectedTotal,
      actual: r.actualTotal,
    }));
    log(`Solicito aprobación para ajustar sensibilidad de D y reintentar. Casos fuera de tolerancia: ${JSON.stringify(needsFix)}`);
  }

  return { pass, results };
}

runCalibration().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
