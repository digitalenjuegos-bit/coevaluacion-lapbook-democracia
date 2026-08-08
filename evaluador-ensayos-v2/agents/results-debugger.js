const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  clientJs: path.join(__dirname, '..', 'public', 'js', 'app.js'),
  serverJs: path.join(__dirname, '..', 'server.js'),
};

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function request(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: 3002,
      path: '/api/evaluar',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
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
    req.write(body);
    req.end();
  });
}

async function diagnoseZeroResults() {
  log('=== Diagnóstico: resultados 0/10 en sección de resultados ===');
  
  // Test server with minimal text to see behavior
  log('1. Probando /api/evaluar con texto corto (menos de 150 palabras)...');
  const shortText = 'Esto es un texto corto de prueba.';
  const shortResult = await request({ texto: shortText, rubricaId: '3bgu-liberalismo' });
  log(`   Resultado: status=${shortResult.status}, total=${shortResult.total}, words=${shortResult.words}`);
  
  // Test with exactly 150 words
  log('2. Probando /api/evaluar con texto de 150 palabras...');
  const words150 = Array(150).fill('palabra').join(' ');
  const result150 = await request({ texto: words150, rubricaId: '3bgu-liberalismo' });
  log(`   Resultado: status=${result150.status}, total=${result150.total}, words=${result150.words}`);
  
  // Test with good text
  log('3. Probando /api/evaluar con texto bueno...');
  const goodText = 'El liberalismo explica la forma jurídica del Ecuador. La Declaración de 1789 define la libertad como no interferencia. La Constitución de 2008 amplía derechos. El caso matrimonio igualitario muestra evolución. El feminismo impulsó cambios. Crítica: insuficiente en origen.';
  const goodResult = await request({ texto: goodText, rubricaId: '3bgu-liberalismo' });
  log(`   Resultado: status=${goodResult.status}, total=${goodResult.total}, words=${goodResult.words}`);
  
  // Check client-side rendering logic
  log('4. Verificando lógica de renderizado cliente...');
  const clientJs = fs.readFileSync(CONFIG.clientJs, 'utf-8');
  
  // Check if renderResults handles zero scores correctly
  const hasFailedValidation = clientJs.includes('failedValidation');
  const hasZeroHandling = clientJs.includes("Number(evaluation.score) === 0 && failedValidation");
  log(`   Maneja failedValidation: ${hasFailedValidation}`);
  log(`   Maneja 0/10 con validación fallida: ${hasZeroHandling}`);
  
  // Check server logic for zero scores
  log('5. Verificando lógica servidor...');
  const serverJs = fs.readFileSync(CONFIG.serverJs, 'utf-8');
  const hasTextoIncompleto = serverJs.includes("status: 'TEXTO_INCOMPLETO'");
  const hasCriteriaEmpty = serverJs.includes('criteria: []');
  log(`   Devuelve TEXTO_INCOMPLETO: ${hasTextoIncompleto}`);
  log(`   Devuelve criteria vacío: ${hasCriteriaEmpty}`);
  
  log('=== Diagnóstico completado ===');
  log('=== Problema probable: servidor devuelve 0/10 sin TEXTO_INCOMPLETO ===');
}

diagnoseZeroResults().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
