#!/usr/bin/env python3
"""
Analizador de IA de Economía IB usando Hugging Face Inference API
Modelo: llava-hf/llava-v1.6-mistral-7b-hf (vision-language)

Uso:
    export HF_TOKEN=***  # o crear .env con HF_TOKEN=***
    python3 analyze_ia.py /ruta/a/imagen.png
"""

import os
import sys
import base64
import json
import re
import requests
from pathlib import Path

# Verificar argumentos primero (antes de validar token)
if len(sys.argv) < 2:
    print("Uso: python3 analyze_ia.py <imagen.png|jpg>")
    print("Ejemplo: python3 analyze_ia.py /Users/albertoottatirosas/Downloads/IMG_7153.PNG")
    sys.exit(1)

# Cargar token desde variable de entorno
HF_TOKEN = os.getenv("HF_TOKEN")
if not HF_TOKEN:
    print("❌ Error: HF_TOKEN no encontrado.")
    print("   Crea uno en https://huggingface.co/settings/tokens")
    print("   Exporta: export HF_TOKEN=***")
    print("   O crea archivo .env: echo 'HF_TOKEN=***' > .env")
    sys.exit(1)

API_URL = "https://api-inference.huggingface.co/models/llava-hf/llava-v1.6-mistral-7b-hf"
HEADERS = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}

# Prompt especializado para IA de Economía IB (NM)
PROMPT = """Eres un examinador experto de IB Economics (Nivel Medio). Analiza esta imagen de un trabajo de Internal Assessment.

EXTRAE y EVALÚA según la rúbrica oficial NM (/14 puntos):

**Criterio A (0-3): Diagramas**
- ¿Hay diagramas relevantes (OADA, OALP, mercado, políticas, etc.)?
- ¿Están correctamente etiquetados (ejes, curvas, desplazamientos, equilibrio)?
- ¿Se usan para apoyar el análisis?

**Criterio B (0-2): Terminología**
- ¿Uso preciso de términos económicos (brecha deflacionaria, multiplicador, política fiscal, etc.)?
- ¿Definiciones claras cuando se introducen conceptos?

**Criterio C (0-3): Análisis / Cadena causal**
- ¿Reconstruye la cadena causal completa paso a paso?
- ¿Explica los mecanismos de transmisión (tasas → inversión → DA, etc.)?
- ¿Conecta la teoría con el artículo/extracto?

**Criterio D (0-3): Concepto clave**
- ¿Identifica UN concepto clave explícito (intervención gubernamental, equidad, eficiencia, sostenibilidad, etc.)?
- ¿Lo aplica consistentemente al caso?
- ¿Tabla del concepto clave coincide con el texto?

**Criterio E (0-3): Evaluación / Juicio**
- ¿Hay juicio fundamentado (no solo pros/contras genéricos)?
- ¿Considera magnitudes, plazos, stakeholders, limitaciones?
- ¿Conclusión clara y respaldada?

**Criterio F (0-3): Presentación / Tabla**
- ¿Tabla del concepto clave presente y completa?
- ¿Referencias/fuentes del artículo?
- ¿Conteo de palabras ≤ 800 (NM)?
- ¿Estructura clara?

DEVUELVE JSON ESTRUCTURADO:
{
  "extraccion": {
    "pregunta_investigacion": "",
    "fuente_articulo": {"medio": "", "fecha": "", "titulo": ""},
    "concepto_clave_declarado": "",
    "diagramas": [],
    "palabras_estimadas": 0
  },
  "evaluacion": {
    "A_diagramas": {"puntuacion": 0, "justificacion": "", "feedback": ""},
    "B_terminologia": {"puntuacion": 0, "justificacion": "", "feedback": ""},
    "C_analisis": {"puntuacion": 0, "justificacion": "", "feedback": ""},
    "D_concepto_clave": {"puntuacion": 0, "justificacion": "", "feedback": ""},
    "E_evaluacion": {"puntuacion": 0, "justificacion": "", "feedback": ""},
    "F_presentacion": {"puntuacion": 0, "justificacion": "", "feedback": ""}
  },
  "total": 0,
  "banda": "",
  "mejoras_prioritarias": []
}"""

def image_to_base64(image_path):
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def analyze_image(image_path):
    img_b64 = image_to_base64(image_path)
    
    payload = {
        "inputs": f"<image>{img_b64}</image>{PROMPT}",
        "parameters": {
            "max_new_tokens": 2048,
            "temperature": 0.1,
            "top_p": 0.9,
            "do_sample": True
        }
    }
    
    print("🔄 Enviando a HF Inference API (LLaVA-Mistral-7B)...")
    response = requests.post(API_URL, headers=HEADERS, json=payload, timeout=180)
    
    if response.status_code == 401:
        raise Exception("Token HF inválido o sin permisos. Verifica HF_TOKEN.")
    if response.status_code == 404:
        raise Exception("Modelo no disponible en Inference API. Prueba otro modelo.")
    if response.status_code == 503:
        raise Exception("Modelo cargándose (cold start). Espera 30-60s y reintenta.")
    if response.status_code != 200:
        raise Exception(f"Error API: {response.status_code} - {response.text}")
    
    result = response.json()
    if isinstance(result, list) and result:
        generated = result[0].get("generated_text", "")
    else:
        generated = str(result)
    
    return generated

def extract_json(text):
    """Extrae el primer JSON válido del texto."""
    matches = re.findall(r'\{.*\}', text, re.DOTALL)
    for m in matches:
        try:
            return json.loads(m)
        except:
            continue
    try:
        return json.loads(text)
    except:
        return None

def format_banda(total):
    """Convierte total /14 a banda IB NM."""
    if total >= 13:
        return "13-15 (Excelente)"
    elif total >= 10:
        return "10-12 (Bueno)"
    elif total >= 7:
        return "7-9 (Satisfactorio)"
    elif total >= 4:
        return "4-6 (Mejorable)"
    else:
        return "1-3 (Insuficiente)"

def main():
    image_path = sys.argv[1]
    if not Path(image_path).exists():
        print(f"❌ Archivo no encontrado: {image_path}")
        sys.exit(1)
    
    print(f"📸 Analizando: {image_path}")
    
    try:
        raw_output = analyze_image(image_path)
        parsed = extract_json(raw_output)
        
        if parsed:
            # Completar banda si falta
            if "banda" not in parsed or not parsed["banda"]:
                parsed["banda"] = format_banda(parsed.get("total", 0))
            
            # Guardar resultado completo
            output_file = Path(image_path).with_suffix(".ia_eval.json")
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(parsed, f, ensure_ascii=False, indent=2)
            
            # Mostrar resumen bonito
            print("\n" + "="*65)
            print("📊 EVALUACIÓN IA ECONOMÍA IB (NM) - RESUMEN")
            print("="*65)
            
            ev = parsed.get("evaluacion", {})
            criterios = [
                ("A", "diagramas", 3, "Diagramas"),
                ("B", "terminologia", 2, "Terminología"),
                ("C", "analisis", 3, "Análisis"),
                ("D", "concepto_clave", 3, "Concepto clave"),
                ("E", "evaluacion", 3, "Evaluación"),
                ("F", "presentacion", 3, "Presentación")
            ]
            
            total = 0
            for key, field, max_p, nombre in criterios:
                data = ev.get(f"{key.lower()}_{field}", {})
                score = data.get("puntuacion", 0)
                total += score
                bar = "█" * score + "░" * (max_p - score)
                fb = data.get('feedback', '')[:70]
                print(f"  {key} | {nombre:<18} {score}/{max_p}  [{bar}]  {fb}")
            
            print("-"*65)
            print(f"  TOTAL: {total}/14  (Banda: {parsed.get('banda', format_banda(total))})")
            print("="*65)
            
            print("\n🎯 MEJORAS PRIORITARIAS:")
            for i, m in enumerate(parsed.get("mejoras_prioritarias", []), 1):
                print(f"  {i}. {m}")
            
            # Extracción clave
            ext = parsed.get("extraccion", {})
            if ext.get("pregunta_investigacion"):
                print(f"\n📝 Pregunta: {ext['pregunta_investigacion']}")
            if ext.get("concepto_clave_declarado"):
                print(f"🔑 Concepto clave: {ext['concepto_clave_declarado']}")
            
            print(f"\n💾 Resultado completo guardado en: {output_file}")
        else:
            print("⚠️ No se pudo parsear JSON. Salida cruda (primeros 3000 chars):")
            print(raw_output[:3000])
            
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()