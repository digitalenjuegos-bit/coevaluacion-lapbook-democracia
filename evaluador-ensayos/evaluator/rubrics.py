from pathlib import Path
from typing import Dict, Optional

BASE = Path(__file__).resolve().parent.parent
RUBRICA_3BGU = BASE / 'rubrica-3bgu-liberalismo.json'
RUBRICA_1BGU = BASE / 'rubrica-1bgu-grecia-roma.json'

_RUBRICS: Optional[Dict] = None


def _load(path: Path) -> Dict:
    import json
    return json.loads(path.read_text(encoding='utf-8'))


def get_rubric(rubric_id: str) -> Dict:
    global _RUBRICS
    if _RUBRICS is None:
        _RUBRICS = {
            '3bgu': _load(RUBRICA_3BGU),
            '3bgu-liberalismo': _load(RUBRICA_3BGU),
            '1bgu': _load(RUBRICA_1BGU),
            '1bgu-grecia-roma': _load(RUBRICA_1BGU),
            '1bgu-hist': _load(RUBRICA_1BGU),
        }
    if rubric_id in _RUBRICS:
        return _RUBRICS[rubric_id]
    key = str(rubric_id or '').split('-')[0].lower()
    for rid, rubric in _RUBRICS.items():
        if rid.startswith(key):
            return rubric
    raise KeyError(f'Rúbrica no encontrada: {rubric_id}')
