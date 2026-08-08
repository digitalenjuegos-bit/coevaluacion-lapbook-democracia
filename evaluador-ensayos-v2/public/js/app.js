const $ = (id) => document.getElementById(id);
const state = {
  course: '',
  rubricId: '',
  files: [],
  evaluations: [],
  savedResults: {},
};

const COURSES = {
  '3bgu': '3BGU Historia y Ciudadanía',
  '3bgu-a': '3A Historia y Ciudadanía',
  '3bgu-b': '3B Historia y Ciudadanía',
  '3bgu-c': '3C Historia y Ciudadanía',
  '1bgu': '1BGU Historia y Ciudadanía',
  '1bgu-a': '1BGU Historia y Ciudadanía A',
  '1bgu-b': '1BGU Historia y Ciudadanía B',
  '1bgu-c': '1BGU Historia y Ciudadanía C',
};

const APP_VERSION = '2026-08-02v1';
const LS_KEY = 'evaluador_v2_app_version';

function migrateStorage() {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored !== APP_VERSION) {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('evaluador_results_') || k === LS_KEY)
        .forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(LS_KEY, APP_VERSION);
    }
  } catch {
    // ignore storage errors
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function normalizeStudentName(name) {
  return name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function matchStudent(fileName, students) {
  const base = fileName.replace(/\.(docx|doc|pdf|txt|md|csv)$/i, '');
  const normalized = normalizeStudentName(base);
  const tokens = normalized.split(' ').filter((token) => token.length > 2);
  let best = null;
  let bestScore = 0;

  for (const s of students) {
    const name = normalizeStudentName(s.nombre);
    const nameTokens = name.split(' ').filter((token) => token.length > 2);
    const overlap = tokens.filter((token) => nameTokens.includes(token)).length;
    const nameOverlap = nameTokens.filter((token) => tokens.includes(token)).length;
    const score = overlap + nameOverlap;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  if (!best && students.length) {
    const lowered = normalized.toLowerCase();
    best = students.find((s) => {
      const name = normalizeStudentName(s.nombre).toLowerCase();
      const apellidos = name.split(' ').slice(-2).join(' ');
      return apellidos.length > 3 && lowered.includes(apellidos);
    }) || null;
  }

  if (!best && students.length) {
    const lowered = normalized.toLowerCase();
    const aliases = ['estudiante de muestra', 'estudiante muestra', 'muestra'];
    const aliasHit = aliases.find((alias) => lowered.includes(alias));
    if (aliasHit) {
      best = students.find((s) => {
        const name = normalizeStudentName(s.nombre).toLowerCase();
        const tokens = name.split(' ').filter((token) => token.length > 2);
        return tokens.some((token) => ['estudiante', 'muestra', 'estudiante de muestra'].some((aliasToken) => aliasToken.includes(token)));
      }) || null;
    }
  }

  return bestScore > 0 || !!best ? best : null;
}

function bandFor(score, maxScore = 10) {
  if (maxScore <= 0) return 'Sin escala';
  const pct = (score / maxScore) * 100;
  if (pct >= 90) return 'Sobresaliente';
  if (pct >= 75) return 'Satisfactorio';
  if (pct >= 60) return 'Aceptable';
  if (pct >= 40) return 'Insuficiente';
  return 'Deficiente';
}

function updateButtons() {
  const hasFiles = state.files.length > 0;
  const hasResults = state.evaluations.length > 0;
  const hasCourse = !!state.course;
  $('evalBtn').disabled = !hasFiles;
  $('clearBtn').disabled = !hasFiles;
}

function renderFiles() {
  const container = $('fileList');
  container.innerHTML = state.files.map((f) => {
    const student = f._student ? `<div class="muted" style="font-size:12px">Estudiante: ${escapeHtml(f._student.nombre)}</div>` : '';
    return `
      <div class="file-row">
        <div>
          <div style="font-weight:600;font-size:13px">${escapeHtml(f.name)}</div>
          <div class="muted" style="font-size:12px">${(f.size / 1024).toFixed(1)} KB</div>
          ${student}
        </div>
      </div>
    `;
  }).join('');
}

function renderResults() {
  const container = $('results');
  if (!state.evaluations.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = state.evaluations.map((evaluation) => {
    const studentName = evaluation.student ? evaluation.student.nombre : 'sin identificar';
    const failedValidation = evaluation.validation && !evaluation.validation.pass;
    const scoreDisplay = Number(evaluation.score) === 0 && failedValidation ? '—' : evaluation.score;
    const bandDisplay = Number(evaluation.score) === 0 && failedValidation ? 'Evaluación no realizada' : evaluation.band;
    const maxScore = evaluation.maxScore || 10;
    const pct = maxScore > 0 ? Math.round((scoreDisplay / maxScore) * 100) : 0;

    const criteriaRows = evaluation.criteria.map((c) => `
      <tr>
        <td>${escapeHtml(c.id)}</td>
        <td>${escapeHtml(c.nombre)}</td>
        <td>${c.nivel}/${c.peso}</td>
        <td>${escapeHtml(c.justificacion || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="result-card">
        <div style="font-weight:700;font-size:14px">${escapeHtml(evaluation.name)}</div>
        <div class="muted">${escapeHtml(studentName)} · ${scoreDisplay}/${maxScore} · ${pct}% · ${escapeHtml(bandDisplay || '')}${evaluation.date ? ' · ' + new Date(evaluation.date).toLocaleString() : ''}</div>
        ${evaluation.validation && !evaluation.validation.pass ? `<div class="muted" style="margin-top:6px">Avisos estructura: ${evaluation.validation.issues.slice(0,3).map(i => escapeHtml(i)).join(' | ')}</div>` : ''}
        <table style="margin-top:10px">
          <thead><tr><th>Id</th><th>Criterio</th><th>Puntaje</th><th>Retroalimentación</th></tr></thead>
          <tbody>${criteriaRows}</tbody>
        </table>
      </div>
    `;
  }).join('');
}

async function loadRubrics() {
  try {
    const response = await fetch('/api/rubricas');
    if (!response.ok) return;
    const list = await response.json();
    const select = $('rubric');
    select.innerHTML = '<option value="">Seleccioná una rúbrica</option>' +
      list.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.nombre)}</option>`).join('');
  } catch {
    // ignore
  }
}

async function evaluateSelected() {
  if (!state.files.length) {
    toast('Selecciona un archivo para evaluar.');
    return;
  }
  if (!state.course) {
    toast('Seleccioná un curso antes de evaluar.');
    return;
  }

  const rubric = state.rubricId || '';
  const btn = $('evalBtn');
  btn.disabled = true;
  btn.textContent = 'Evaluando...';

  const evaluations = [];
  state.evaluations = [];

  for (const file of state.files) {
    let evaluation = null;
    try {
      const response = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: file._text || '', rubricaId: rubric }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Error evaluando el ensayo.' }));
        throw new Error(err.error || 'Error evaluando el ensayo.');
      }
      const data = await response.json();
      const serverFailed = data.status && data.status !== 'ok';
      evaluation = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name.replace(/\.(docx|doc|pdf|txt|md)$/i, ''),
        student: file._student || null,
        score: Number(data.total || 0),
        maxScore: data.maxScore || 10,
        band: bandFor(data.total || 0, data.maxScore || 10),
        criteria: (data.criteria || []).map((c) => ({
          id: c.id,
          nombre: c.nombre,
          peso: c.peso,
          nivel: c.nivel,
          justificacion: c.justificacion || '',
        })),
        date: new Date().toISOString(),
        text: file._text || '',
        validation: serverFailed
          ? { issues: [data.status || 'Evaluación no realizada'], pass: false }
          : (file._validation || { issues: [], pass: true }),
        feedback: serverFailed
          ? `Evaluación no realizada: ${data.status || 'Error'}`
          : `Evaluación automática. ${bandFor(data.total || 0, data.maxScore || 10)}.`,
      };
    } catch (e) {
      toast(`${file.name}: no se pudo evaluar. ${e.message}`);
    }

    if (evaluation) {
      evaluations.push(evaluation);
    }
  }

  state.evaluations = evaluations;
  renderResults();
  updateButtons();
  toast(`Evaluados: ${state.evaluations.length}`);
  btn.disabled = false;
  btn.textContent = 'Evaluar';
}

async function extractTextFromFile(file) {
  const buffer = await file.arrayBuffer();
  if (file.name.endsWith('.pdf')) {
    const pdfjsLib = window.pdfjsLib;
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(' ') + '\n';
    }
    return text;
  }
  if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
    const JSZip = window.JSZip;
    const zip = await JSZip.loadAsync(buffer);
    const doc = zip.file('word/document.xml');
    if (!doc) return '';
    const xml = await doc.async('text');
    const div = document.createElement('div');
    div.innerHTML = xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*>/g, '\n').replace(/<\/w:p>/g, '\n');
    return div.textContent || '';
  }
  return buffer.toString();
}

function validateEssayStructure(text) {
  const MIN_BODY_WORDS = 150;
  const trimmed = (text || '').trim();
  const issues = [];
  if (!trimmed) {
    issues.push('El ensayo parece vacío o no se pudo extraer texto.');
  } else {
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    if (words < MIN_BODY_WORDS) issues.push(`Texto incompleto: solo se extrajeron ${words} palabras.`);
  }
  return { issues, pass: issues.length === 0 };
}

async function handleFiles(fileList) {
  const students = [];
  await Promise.all(Array.from(fileList).map(async (file) => {
    try {
      file._text = await extractTextFromFile(file);
    } catch {
      file._text = '';
    }
    file._student = matchStudent(file.name, students);
    file._validation = validateEssayStructure(file._text || '');
    state.files.push(file);
  }));
  renderFiles();
  updateButtons();
}

function clearUpload() {
  state.files = [];
  state.evaluations = [];
  $('fileInput').value = '';
  renderFiles();
  $('results').innerHTML = '';
  updateButtons();
}

function clearCache() {
  if (!state.course) {
    toast('Selecciona un curso antes de limpiar la cache.');
    return;
  }
  const key = `evaluador_results_${state.course}`;
  localStorage.removeItem(key);
  state.savedResults[state.course] = [];
  state.evaluations = [];
  renderResults();
  updateButtons();
  toast('Cache de resultados limpiada para este curso.');
}

function init() {
  migrateStorage();
  loadRubrics();

  $('course').addEventListener('change', () => {
    state.course = $('course').value;
    state.rubricId = $('rubric').value || '';
    state.evaluations = [];
    renderResults();
    updateButtons();
  });

  $('rubric').addEventListener('change', () => {
    state.rubricId = $('rubric').value || '';
  });

  $('evalBtn').addEventListener('click', evaluateSelected);
  $('clearBtn').addEventListener('click', clearUpload);
  $('clearCacheBtn').addEventListener('click', clearCache);

  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  dropzone.addEventListener('click', (e) => {
    if (e.target !== fileInput) fileInput.click();
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });
}

init();
