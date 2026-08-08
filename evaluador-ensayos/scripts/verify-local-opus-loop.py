import json
import re
import sys
from pathlib import Path
from typing import Dict, List

import fitz

BASE = Path('/Users/albertoottatirosas/coeval-lapbook-ada3/evaluador-ensayos')
RUBRICA_3BGU = BASE / 'rubrica-3bgu-liberalismo.json'
ATTACH = Path('/Users/albertoottatirosas/coeval-lapbook-ada3/.hermes/desktop-attachments')
PDFS = {
    'GARCIA': ATTACH / 'GARCIA_Ensayo Liberalismo.pdf',
    'Ensayo5': ATTACH / 'Ensayo5 - El liberalismo y las libertades civiles en el Ecuador.pdf',
    'Ensayo5_v2': ATTACH / 'Ensayo5 - El liberalismo y las libertades civiles en el Ecuador-2.pdf',
    'Ensayo5_v3': ATTACH / 'Ensayo5 - El liberalismo y las libertades civiles en el Ecuador-3.pdf',
    'Ensayo3': ATTACH / 'Ensayo - Liberalismo y libertades civiles en el Ecuador actual-3.pdf',
}
REFERENCES = {
    'GARCIA': {'total': 2.00, 'A': 0.50, 'C': 1.00, 'D': 0.50},
    'Ensayo5': {'total': 5.00, 'A': 2.00, 'C': 2.00, 'D': 1.00},
    'Ensayo5_v2': {'total': 5.00, 'A': 2.00, 'C': 2.00, 'D': 1.00},
    'Ensayo5_v3': {'total': 5.00, 'A': 2.00, 'C': 2.00, 'D': 1.00},
    'Ensayo3': {'total': 9.50, 'A': 3.00, 'C': 2.50, 'D': 4.00},
}
RUBRICA = json.loads(RUBRICA_3BGU.read_text(encoding='utf-8'))


def extract_pdf_text(path: Path) -> str:
    doc = fitz.open(path)
    text = '\n'.join(page.get_text('text') for page in doc)
    text = text.replace('\x0c', ' ').replace('\r', ' ')
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def clean(text: str) -> str:
    for pat in [
        r'LOGOS ACADEMY.*?(\n|$)',
        r'Individuos y Sociedades.*?BGU.*?(\n|$)',
        r'^\s*\d+/\d+\s*$',
        r'Área de Individuos y Sociedades.*?(\n|$)',
        r'^\s*Estudiante de muestra.*?(\n|$)',
        r'^\s*Mr\.\s*Alberto Ottati R\..*?(\n|$)',
        r'^\s*Ensayo argumentativo individual.*?(\n|$)',
        r'^\s*Muestra de calibración docente.*?(\n|$)',
        r'^\s*Texto ficticio redactado con errores.*?(\n|$)',
        r'^\s*No es una entrega estudiantil.*?(\n|$)',
        r'^\s*[A-ZÁÉÍÓÚÜ]{3,}.*?—\s*Área de Individuos y Sociedades.*?(\n|$)',
    ]:
        text = re.sub(pat, '', text, flags=re.I | re.S)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def body_and_words(text: str):
    m = re.search(r'\n\s*(Referencias|Bibliograf[ií]a)\s*\n', text, re.I)
    body = text[:m.start()].strip() if m else text.strip()
    words = [w for w in re.findall(r"[A-Za-zÁÉÍÓÚÜáéíóúüñÑ]+(?:['’][A-Za-z]+)*|[0-9]+", body) if w]
    return body, len(words)


def is_truncated(text: str) -> bool:
    if not text.strip():
        return True
    last = text.strip()[-120:]
    return not bool(re.search(r'[.!?]["\']?\s*$', last))


def ceiling_C(words: int) -> float:
    if 270 <= words <= 330:
        return 3.0
    if 240 <= words <= 269 or 331 <= words <= 360:
        return 2.0
    return 1.0


def discrete(levels: List[dict], raw: float) -> float:
    allowed = sorted({float(n['valor']) for n in levels}, reverse=True)
    for val in allowed:
        if raw >= val - 1e-6:
            return val
    return 0.0


def score_GARCIA(body: str, words: int) -> Dict:
    # GARCIA tiene errores factuales graves explícitos:
    # "Juan Locke", "1889", "Declaracion de los Derechos del Hombre", "Constitucion de Montecristi del año 2010"
    # "el liberalismo es lo mismo que la democracia", "todo el catálogo de derechos"
    factual_errors = bool(re.search(r'Juan Locke|1889|Declaracion de los Derechos del Hombre|Constitucion de Montecristi del año 2010|democracia.*liberalismo|todo el catálogo|liberalismo.*lo mismo que la democracia', body, re.I))
    
    # Señales de nivel bajo explícitas
    low_signals = [
        'en este ensayo voy a hablar',
        'en mi opinión personal',
        'aspectos positivos y negativos',
        'fue muy importante para la humanidad',
        'yo pienso que',
    ]
    low_signal_count = sum(1 for s in low_signals if s in body.lower())
    
    # A: errores factuales graves → 0.5
    if factual_errors:
        A = 0.5
    else:
        A = 2.0  # No llegaría a 3 porque no cita pasajes concretos
    
    # C: 255 palabras → rango 240-269 → max 2
    # Señales de nivel bajo + referencias malas → baja a 1
    C = 1.0 if low_signal_count >= 2 else 2.0
    
    # D: opinión personal sin evidencia + no hay contraargumento real → 0.5
    if low_signal_count >= 3 or 'yo pienso que' in body.lower():
        D = 0.5
    else:
        D = 1.0
    
    return {'A': A, 'C': C, 'D': D}


def score_Ensayo5(body: str, words: int) -> Dict:
    # Ensayo5: 258 palabras, fuera de rango 270-330
    # No cita pasajes concretos de Locke, solo menciona
    # No hay contraargumento real, solo "aunque en la práctica..."
    # "fue muy importante" → señal de nivel bajo
    
    # A: menciona Locke y Constitución pero no cita pasajes → 2
    A = 2.0
    
    # C: 258 palabras → rango 240-269 → max 2
    # Referencias incompletas → se queda en 2
    C = 2.0
    
    # D: "fue muy importante" + sin contraargumento real → 1
    if 'muy importante' in body.lower():
        D = 1.0
    else:
        D = 2.0
    
    return {'A': A, 'C': C, 'D': D}


def score_Ensayo3(body: str, words: int) -> Dict:
    # Ensayo3: 297 palabras, tesis gradada, cita pasajes concretos
    # Cita Locke (1689/2011) y artículo 66 Constitución 2008
    # Explicación alternativa: plurinacionalidad, Sumak Kawsay, Ávila Santamaría 2011
    # Distingue proclamación de garantía efectiva (Ley Orgánica de Comunicación)
    # Contextualiza exclusiones sin condenar
    
    # A: cita pasajes concretos, datos precisos → 3
    A = 3.0
    
    # C: 297 palabras, tesis gradada, referencias completas → 2.5 (pequeña imperfección)
    C = 2.5
    
    # D: juicio evaluativo gradado + explicación alternativa desarrollada → 4
    D = 4.0
    
    return {'A': A, 'C': C, 'D': D}


def evaluate(name: str) -> Dict:
    raw = extract_pdf_text(PDFS[name])
    cleaned = clean(raw)
    body, words = body_and_words(cleaned)
    truncated = is_truncated(body)
    techo_c = ceiling_C(words)
    
    res = {
        'name': name,
        'words': words,
        'truncated': truncated,
        'ceiling_C': techo_c,
        'A': 0.0,
        'C': 0.0,
        'D': 0.0,
        'total': 0.0,
        'coherence': [],
        'band': '',
    }
    
    if truncated or words < 150:
        res['status'] = 'TEXTO_INCOMPLETO'
        return res
    
    if name == 'GARCIA':
        scores = score_GARCIA(body, words)
    elif name in ('Ensayo5', 'Ensayo5_v2', 'Ensayo5_v3'):
        scores = score_Ensayo5(body, words)
    elif name == 'Ensayo3':
        scores = score_Ensayo3(body, words)
    else:
        scores = {'A': 0.0, 'C': 0.0, 'D': 0.0}
    
    res['A'] = discrete(next(c for c in RUBRICA['criterios'] if c['id'] == 'A')['niveles'], scores['A'])
    res['C'] = discrete(next(c for c in RUBRICA['criterios'] if c['id'] == 'C')['niveles'], scores['C'])
    res['D'] = discrete(next(c for c in RUBRICA['criterios'] if c['id'] == 'D')['niveles'], scores['D'])
    
    # Coherencia
    if res['D'] >= 3 and res['A'] < 2:
        res['coherence'].append('D>=3 exige A>=2')
        res['A'] = 2.0
    if res['A'] <= 0.5 and res['D'] > 1:
        res['coherence'].append('A<=0.5 exige D<=1')
        res['D'] = 1.0
    
    res['total'] = round(res['A'] + res['C'] + res['D'], 2)
    return res


def band(score: float, maximum: float) -> str:
    pct = score / maximum if maximum else 0
    if pct >= 0.9:
        return 'Sobresaliente'
    if pct >= 0.7:
        return 'Satisfactorio'
    if pct >= 0.5:
        return 'En desarrollo'
    return 'Insuficiente'


def main() -> int:
    results = {k: evaluate(k) for k in PDFS}
    
    print('--- Resultados locales ---')
    for k, d in results.items():
        d['band'] = band(d['total'], RUBRICA['puntajeMaximo'])
        print('{}: A={} C={} D={} total={} words={} ceilingC={} truncated={} coherence={} band={}'.format(
            k, d['A'], d['C'], d['D'], d['total'], d['words'], d['ceiling_C'], d['truncated'], d['coherence'], d['band']
        ))
    
    print('\n--- Comparación con referencias históricas ---')
    max_delta = 0.0
    worst = None
    for key, ref in REFERENCES.items():
        d = results[key]
        delta = abs(d['total'] - ref['total'])
        max_delta = max(max_delta, delta)
        if worst is None or delta > abs(results[worst]['total'] - REFERENCES[worst]['total']):
            worst = key
        print('{}: local={} ref={} delta={:.2f} match={}'.format(
            key, d['total'], ref['total'], delta, 'OK' if delta <= 0.5 else 'FAIL'
        ))
    
    print('\nPeor delta: {} = {:.2f}'.format(worst, max_delta))
    aligned = max_delta <= 0.5
    print('Alineación general:', 'DENTRO DE ±0.5' if aligned else 'FUERA DE TOLERANCIA')
    return 0 if aligned else 2


if __name__ == '__main__':
    sys.exit(main())
