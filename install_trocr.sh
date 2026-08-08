#!/bin/bash
# Script de instalación y configuración del modelo TrOCR Small para reconocimiento de texto manuscrito

# Directorio del proyecto
PROJECT_DIR="/Users/albertoottatirosas/coeval-lapbook-ada3"

echo "Iniciando instalación del modelo TrOCR Small..."

# Instalar dependencias usando uv (con ruta completa)
/Users/albertoottatirosas/.hermes/bin/uv pip install \
    "transformers>=4.30.0,<4.40.0" \
    torch \
    sentencepiece \
    pillow \
    --python /Users/albbertoottatirosas/.hermes/hermes-agent/venv/bin/python3

# Descargar modelo si no existe
if [ ! -d "$PROJECT_DIR/models/trocr-small" ]; then
    echo "Descargando modelo TrOCR Small..."
    mkdir -p $PROJECT_DIR/models/trocr-small
    huggingface-cli download microsoft/trocr-small-handwritten --local-dir $PROJECT_DIR/models/trocr-small
fi

# Crear script de prueba
cat > $PROJECT_DIR/test_model.py << 'EOF'
#!/usr/bin/env python3
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from PIL import Image
import sys

try:
    processor = TrOCRProcessor.from_pretrained("./models/trocr-small")
    model = VisionEncoderDecoderModel.from_pretrained("./models/trocr-small")
    print("✓ Modelo TrOCR Small cargado exitosamente!")
    print("✓ Listo para realizar tareas de OCR en imágenes manuscritas.")
except Exception as e:
    print(f"Error al cargar el modelo: {e}")
    sys.exit(1)
EOF

echo ""
echo "✓ Instalación completada."
echo "Para probar el modelo ejecuta: python3 test_model.py"