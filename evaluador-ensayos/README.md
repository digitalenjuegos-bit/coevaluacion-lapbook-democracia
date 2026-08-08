# Evaluador de Ensayos - Deploy en Railway

## Requisitos
- Tener una cuenta en https://railway.app
- Tener el repo local listo: `/Users/albertoottatirosas/coeval-lapbook-ada3/evaluador-ensayos`
- Tener `railway` CLI instalado: `npm install -g @railway/cli`

## Pasos exactos (2 minutos)

1. **Autenticar Railway**
```bash
cd /Users/albertoottatirosas/coeval-lapbook-ada3/evaluador-ensayos
railway login
```

2. **Inicializar proyecto**
```bash
railway init
# Cuando pregunte:
# - Select workspace: tu workspace personal
# - Select project: crear nuevo proyecto
# - Nombre del proyecto: evaluador-ensayos
```

3. **Deploy**
```bash
railway up
```

4. **Obtener URL pública**
```bash
railway domain
# Te devuelve algo como: https://evaluador-ensayos-production.up.railway.app
```

Esa URL es fija, HTTPS automático y funciona 24/7 sin tu PC prendida.

## Compartir con docentes
- Link para Gunther: `https://<tu-url>/app`
- Link para Alberto: `https://<tu-url>/app`

Ambos seleccionan su docente y curso, evalúan y guardan resultados.

## Notas técnicas
- `server.js` detecta automáticamente el puerto desde `PORT` de Railway
- `package.json` tiene `start: node server.js`
- Las listas de estudiantes están embebidas en `public/app.html`
- Resultados se guardan en memoria del servidor (sobreviven al deploy)
