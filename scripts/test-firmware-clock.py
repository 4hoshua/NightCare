"""Executa os handlers reais do sketch no host, com rede/NVS/tempo simulados.

Requer g++ e ArduinoJson instalado por pio run. Não executa Wokwi/hardware.
Não copia a lógica de comandos: extrai os trechos atuais do firmware para o build.
"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
source = (root / 'Wokwi/sketch.ino').read_text()
time_service = source[source.index('struct TimeService {'):source.index('TimeService clockService;') + len('TimeService clockService;')]
handlers = source[source.index('bool parseUtc('):source.index('void updateConnectivity(unsigned long now) {')]
library = root / '.pio/libdeps/esp32demo/ArduinoJson/src'
if not (library / 'ArduinoJson.h').exists():
    raise SystemExit('Prepare ArduinoJson executando pio run -e esp32demo.')
(root / '.validation').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='firmware-clock-', dir=root / '.validation') as tmp:
    work = Path(tmp)
    (work / 'time-service.inc').write_text(time_service)
    (work / 'command-handlers.inc').write_text(handlers)
    for demo in (1, 0):
        binary = work / f'clock-{demo}'
        subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                        f'-DNIGHTCARE_DEMO={demo}', '-I', str(library), '-I', str(work),
                        str(root / 'scripts/firmware-clock.test.cpp'), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
