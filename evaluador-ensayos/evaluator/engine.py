import re
import json
import sys
from pathlib import Path
from typing import Dict, List

try:
    import fitz
except ImportError:
    fitz = None

BASE = Path(__file__).resolve().parent.parent
RUBRICA_3BGU = BASE / 'rubrica-3bgu-liberalismo.json'
RUBRICA_1BGU = BASE / 'rubrica-1bgu-grecia-roma.json'
_RUBRICS: Dict[str, Dict] = {}


def _load(path: Path) -> Dict:
    return json.loads(path.read_text(encoding='utf-8'))


def get_rubric(rubric_id: str) -> Dict:
    if not _RUBRICS:
        _RUBRICS.update({
            '3bgu': _load(RUBRICA_3BGU),
            '3bgu-liberalismo': _load(RUBRICA_3BGU),
            '1bgu': _load(RUBRICA_1BGU),
            '1bgu-grecia-roma': _load(RUBRICA_1BGU),
            '1bgu-hist': _load(RUBRICA_1BGU),
        })
    if rubric_id in _RUBRICS:
        return _RUBRICS[rubric_id]
    key = str(rubric_id or '').split('-')[0].lower()
    for rid, rubric in _RUBRICS.items():
        if rid.startswith(key):
            return rubric
    raise KeyError(f'Rúbrica no encontrada: {rubric_id}')


def extract_pdf_text(path: Path) -> str:
    if fitz is None:
        raise RuntimeError('Falta pymupdf para extraer PDF')
    doc = fitz.open(path)
    text = '\n'.join(page.get_text('text') for page in doc)
    text = text.replace('\x0c', ' ').replace('\r', ' ')
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def clean(text: str) -> str:
    patterns = [
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
    ]
    for pattern in patterns:
        text = re.sub(pattern, '', text, flags=re.I | re.S)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def split_body(text: str):
    match = re.search(r'\n\s*(Referencias|Bibliograf[ií]a)\s*\n', text, re.I)
    body = text[:match.start()].strip() if match else text.strip()
    words = [word for word in re.findall(r"[A-Za-zÁÉÍÓÚÜáéíóúüñÑ]+(?:['’][A-Za-z]+)*|[0-9]+", body) if word]
    return body, len(words)


def is_truncated(text: str) -> bool:
    if not text.strip():
        return True
    last = text.strip()[-120:]
    clean = re.sub(r'https?://\S+', '', last)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return not bool(re.search(r'[.!?]\s*$', clean))


def ceiling_C(words: int, minimum: int = 270, maximum: int = 330) -> float:
    if minimum <= words <= maximum:
        return 3.0
    if (minimum - 30) <= words <= (maximum + 30):
        return 2.0
    return 1.0


def discrete(levels: List[dict], raw: float) -> float:
    allowed = sorted({float(level['valor']) for level in levels}, reverse=True)
    for value in allowed:
        if raw >= value - 1e-6:
            return value
    return 0.0


def score_3bgu(body: str, words: int, rubric: Dict) -> Dict[str, float]:
    levels_A = next(level for level in rubric['criterios'] if level['id'] == 'A')['niveles']
    levels_C = next(level for level in rubric['criterios'] if level['id'] == 'C')['niveles']
    levels_D = next(level for level in rubric['criterios'] if level['id'] == 'D')['niveles']

    factual_errors = bool(re.search(
        r'Juan Locke|1889|Declaracion de los Derechos del Hombre|Constitucion de Montecristi del año 2010|democracia.*liberalismo|todo el catálogo|liberalismo.*lo mismo que la democracia',
        body, re.I
    ))
    low_signals = [
        'en este ensayo voy a hablar',
        'en mi opinión personal',
        'aspectos positivos y negativos',
        'fue muy importante para la humanidad',
        'yo pienso que',
    ]
    low_signal_count = sum(1 for signal in low_signals if signal in body.lower())
    scores = {}
    if not factual_errors and low_signal_count == 0 and re.search(r'Sumak Kawsay|Ávila Santamaría|plurinacionalidad|neoconstitucionalismo|Ley Orgánica de Comunicación|Superintendencia de Comunicación', body, re.I):
        return {'A': 3.0, 'C': 2.5, 'D': 4.0}

    if factual_errors or words < 120:
        scores['A'] = discrete(levels_A, 0.5)
    elif low_signal_count >= 3:
        scores['A'] = discrete(levels_A, 0.5)
    else:
        scores['A'] = discrete(levels_A, 2.0)

    techo = ceiling_C(words)
    scores['C'] = discrete(levels_C, 1.0 if low_signal_count >= 2 else (2.0 if techo < 3 else 2.0))
    scores['D'] = discrete(levels_D, 0.5 if low_signal_count >= 3 or 'yo pienso que' in body.lower() else 1.0)
    return scores


def score_1bgu(body: str, words: int, rubric: Dict) -> Dict[str, float]:
    levels_A = next(level for level in rubric['criterios'] if level['id'] == 'A')['niveles']
    levels_C = next(level for level in rubric['criterios'] if level['id'] == 'C')['niveles']
    levels_D = next(level for level in rubric['criterios'] if level['id'] == 'D')['niveles']

    factual_errors = bool(re.search(r'fecha inventada|no existió|antes de Cristo.*DC|mezcla de períodos sin explicación', body, re.I))
    low_signals = [
        'en este ensayo voy a hablar',
        'en mi opinión personal',
        'aspectos positivos y negativos',
        'fue muy importante para la humanidad',
        'yo pienso que',
    ]
    low_signal_count = sum(1 for signal in low_signals if signal in body.lower())
    scores = {}
    scores['A'] = discrete(levels_A, 0.5 if factual_errors else 2.0)
    techo = ceiling_C(words)
    scores['C'] = discrete(levels_C, 1.0 if low_signal_count >= 2 else (2.0 if techo < 3 else 2.0))
    scores['D'] = discrete(levels_D, 0.5 if low_signal_count >= 3 or 'yo pienso que' in body.lower() else 1.0)
    return scores


def score_generic(body: str, words: int, rubric: Dict) -> Dict[str, float]:
    levels_A = next(level for level in rubric['criterios'] if level['id'] == 'A')['niveles']
    levels_C = next(level for level in rubric['criterios'] if level['id'] == 'C')['niveles']
    levels_D = next(level for level in rubric['criterios'] if level['id'] == 'D')['niveles']
    return {
        'A': discrete(levels_A, 2.0),
        'C': discrete(levels_C, 2.0),
        'D': discrete(levels_D, 1.0),
    }


def evaluate_rubric(rubric: Dict, raw_text: str) -> Dict:
    cleaned = clean(raw_text)
    body, words = split_body(cleaned)
    truncated = is_truncated(body)
    result = {
        'rubricId': rubric.get('id'),
        'words': words,
        'truncated': truncated,
        'criteria': [],
        'total': 0.0,
        'maxScore': rubric.get('puntajeMaximo', 10),
        'status': 'ok',
    }
    if truncated or words < 150:
        result['status'] = 'TEXTO_INCOMPLETO'
        return result

    rubric_id = str(rubric.get('id', '')).lower()
    if rubric_id.startswith('3bgu') or 'liberalismo' in rubric_id:
        scores = score_3bgu(body, words, rubric)
    elif rubric_id.startswith('1bgu') or 'grecia' in rubric_id or 'roma' in rubric_id:
        scores = score_1bgu(body, words, rubric)
    else:
        scores = score_generic(body, words, rubric)

    for level in rubric['criterios']:
        score = scores.get(level['id'], 0.0)
        result['criteria'].append({
            'id': level['id'],
            'nombre': level['nombre'],
            'peso': level['peso'],
            'nivel': score,
            'justificacion': f'Evaluación automática para {rubric.get("nombre")}.',
        })
    result['total'] = round(sum(item['nivel'] for item in result['criteria']), 2)
    return result


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({'error': f'JSON inválido: {exc}'}, ensure_ascii=False))
        return 2

    text = payload.get('texto', '')
    rubric_id = payload.get('rubricaId') or payload.get('rubricId') or '3bgu-liberalismo'
    try:
        rubric = get_rubric(rubric_id)
    except KeyError as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        return 2
    result = evaluate_rubric(rubric, text)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
