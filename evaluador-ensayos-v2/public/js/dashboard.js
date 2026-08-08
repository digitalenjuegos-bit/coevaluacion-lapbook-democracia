const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  error: null,
};

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const delta = Date.now() - date.getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} días`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function endpointLabel(endpoint) {
  const map = {
    '/api/health': 'Health',
    '/api/rubricas': 'Rúbricas',
    '/api/evaluar': 'Evaluar',
  };
  return map[endpoint] || endpoint;
}

function renderHealth(data) {
  const card = $('healthCard');
  const value = $('healthValue');
  const meta = $('healthMeta');
  const healthy = data.health?.ok;
  card.classList.toggle('healthy', healthy);
  card.classList.toggle('unhealthy', !healthy);
  value.textContent = healthy ? 'Saludable' : 'Inestable';
  meta.textContent = healthy
    ? `Uptime: ${formatUptime(data.uptime)}`
    : 'Revisá los endpoints y logs.';
}

function renderRubrics(data) {
  const count = Array.isArray(data.rubricas) ? data.rubricas.length : 0;
  $('rubricsValue').textContent = count;
  $('rubricsMeta').textContent = count ? 'Rúbricas activas' : 'Sin rúbricas cargadas';
  const container = $('rubrics');
  if (!count) {
    container.innerHTML = '<div class="muted">No se encontró ninguna rúbrica cargada.</div>';
    return;
  }
  container.innerHTML = data.rubricas
    .map(
      (rubric) => `
        <div class="rubric">
          <div class="rubric-title">${escapeHtml(rubric.nombre)}</div>
          <div class="rubric-meta">
            ID: ${escapeHtml(rubric.id)} · puntaje máximo: ${rubric.puntajeMaximo ?? '—'}
          </div>
        </div>
      `
    )
    .join('');
}

function renderEndpoints(data) {
  const container = $('endpoints');
  const endpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
  if (!endpoints.length) {
    container.innerHTML = '<div class="muted">No hay datos de endpoints.</div>';
    return;
  }
  container.innerHTML = endpoints
    .map((endpoint) => {
      const badgeClass = endpoint.ok ? 'endpoint-badge ok' : 'endpoint-badge';
      const status = endpoint.status ?? '—';
      const duration = endpoint.durationMs != null ? `${endpoint.durationMs} ms` : '';
      const error = endpoint.error ? `<div class="endpoint-detail">Error: ${escapeHtml(endpoint.error)}</div>` : '';
      return `
        <div class="endpoint">
          <div>
            <div class="endpoint-name">${escapeHtml(endpointLabel(endpoint.endpoint))}</div>
            <div class="endpoint-detail">Estado: ${status} ${duration ? '· ' + duration : ''}${endpoint.mode ? ' · ' + escapeHtml(endpoint.mode) : ''}</div>
            ${error}
          </div>
          <div class="${badgeClass}">${endpoint.ok ? 'OK' : 'FAIL'}</div>
        </div>
      `;
    })
    .join('');
}

function renderLogs(data) {
  const logs = Array.isArray(data.recentLogs) ? data.recentLogs : [];
  $('logsCountValue').textContent = logs.length;
  $('logsCountMeta').textContent = 'Últimos eventos';
  const container = $('logs');
  if (!logs.length) {
    container.innerHTML = '<div class="muted">Sin eventos recientes.</div>';
    return;
  }
  container.innerHTML = logs
    .map((log) => {
      return `
        <div class="log">
          <div class="log-time">${escapeHtml(log.at)}</div>
          <div class="log-event">${escapeHtml(log.event)}</div>
          <div class="log-message">${escapeHtml(log.message)}</div>
        </div>
      `;
    })
    .join('');
}

function renderUpdated(data) {
  const updated = $('updatedValue');
  const meta = $('updatedMeta');
  updated.textContent = relativeTime(data.generatedAt);
  meta.textContent = new Date(data.generatedAt).toLocaleString();
}

function renderError() {
  $('healthValue').textContent = 'Error';
  $('healthMeta').textContent = state.error || 'No se pudo cargar el dashboard.';
}

async function loadDashboard() {
  state.error = null;
  try {
    const response = await fetch('/api/dashboard', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Error ${response.status} al cargar /api/dashboard`);
    }
    const data = await response.json();
    state.data = data;
    renderHealth(data);
    renderRubrics(data);
    renderEndpoints(data);
    renderLogs(data);
    renderUpdated(data);
  } catch (error) {
    state.error = error.message;
    renderError();
  }
}

$('refreshBtn').addEventListener('click', () => {
  loadDashboard();
});

loadDashboard();
