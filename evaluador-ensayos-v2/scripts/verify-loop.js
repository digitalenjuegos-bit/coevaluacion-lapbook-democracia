const http = require('http');

const BASE = 'http://localhost:3002';

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const health = await request('GET', '/api/health');
  console.log('HEALTH', health.status, health.body);
  if (health.status !== 200 || health.body.trim() !== 'ok') {
    console.log('FAIL - health check');
    process.exit(1);
  }

  const rubricas = await request('GET', '/api/rubricas');
  console.log('RUBRICAS', rubricas.status, rubricas.body);
  const rubricasData = JSON.parse(rubricas.body);
  if (rubricas.status !== 200 || !Array.isArray(rubricasData) || !rubricasData.some(r => r.id === '3bgu-liberalismo') || !rubricasData.some(r => r.id === '1bgu-grecia-roma')) {
    console.log('FAIL - rubricas');
    process.exit(1);
  }

  const liberalText = 'La libertad como no interferencia negativa exige que el Estado se abstenga de limitar al individuo, mientras que la prestación exigible implica una garantía positiva que demanda acción estatal. Ambos artículos de la Constitución ecuatoriana y decisiones como la OC-24/17 de la Corte Interamericana muestran cómo el constitucionalismo garantista no reduce el derecho a una mera abstención. Un análisis crítico debe decidir el origen del conflicto, delimitar el contenido de cada libertad y evitar insuficiencias en la argumentación. La doctrina feminista y la movilización social amplían el debate sobre derechos laborales y protección efectiva. Eso permite evaluar límites y alternativas dentro del marco constitucional vigente sin caer en simplificaciones. La argumentación debe matizar cuándo una libertad negativa se convierte en una omisión inconstitucional del Estado. El análisis debe evitar equívocos comunes entre liberalismo y democracia, porque no son sinónimos. La sentencia 11-18-CN/19 y otros precedentes ayudan a delimitar el contenido de cada libertad.';
  const greciaText = 'Grecia desarrolló la democracia ateniena en el siglo V a.C. con participación directa, aunque limitada a ciudadanos varones, excluyendo a mujeres, esclavos y extranjeros del proceso político formal. Roma organizó la república con magistraturas y el Senado, combinando elementos republicanos con dominio imperial y expansión territorial controlada. Ambos legados siguen vigentes en el derecho, la política y la cultura occidental contemporánea. Ambos sistemas políticos mostraron fortalezas y debilidades que todavía se discuten. La comparación es viable si se distingue continuidad y ruptura, sin condenar con criterios actuales. Eso permite un juicio evaluativo más riguroso sobre ambos modelos políticos. Sin embargo, el texto no desarrolla una explicación alternativa que pondere por qué un modelo fue más limitado que el otro en la práctica institucional. Quedan enunciados juicios como muy importante, pero sin delimitación de dimensiones ni contraste suficiente. A pesar de eso, el ensayo ya distingue continuidades y diferencias relevantes. La democracia ateniense y la república romana muestran dos maneras distintas de organizar la participación política. Atenas limitó la participación a varones libres, mientras Roma amplió la ciudadanía de forma gradual. Esa diferencia permite evaluar ambos modelos sin caer en comparaciones anacrónicas.';
  const shortText = 'Liberalismo y democracia.';

  const eval1 = await request('POST', '/api/evaluar', JSON.stringify({ texto: liberalText, rubricaId: '3bgu-liberalismo' }));
  console.log('EVAL_3BGU', eval1.status, eval1.body);
  const eval2 = await request('POST', '/api/evaluar', JSON.stringify({ texto: greciaText, rubricaId: '1bgu-grecia-roma' }));
  console.log('EVAL_1BGU', eval2.status, eval2.body);
  const eval3 = await request('POST', '/api/evaluar', JSON.stringify({ texto: shortText, rubricaId: '3bgu-liberalismo' }));
  console.log('EVAL_SHORT', eval3.status, eval3.body);

  const data1 = JSON.parse(eval1.body);
  const data2 = JSON.parse(eval2.body);
  const data3 = JSON.parse(eval3.body);

  const liberalOk = data1.status === 'ok' && Array.isArray(data1.criteria) && data1.criteria.length === 3 && !data1.criteria.some(c => c.justificacion === `Criterio ${c.id}: nivel ${c.nivel} de ${c.peso}.`);
  const greciaOk = data2.status === 'ok' && Array.isArray(data2.criteria) && data2.criteria.length === 3 && !data2.criteria.every(c => c.nivel === 1);
  const shortOk = data3.status === 'TEXTO_INCOMPLETO' && data3.total === 0 && Array.isArray(data3.criteria) && data3.criteria.length === 0;

  if (liberalOk && greciaOk && shortOk) {
    console.log('PASS - v2 verification loop');
    process.exit(0);
  } else {
    console.log('FAIL - v2 verification loop');
    process.exit(1);
  }
})();
