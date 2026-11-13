"""Gera pacotes públicos estáveis por dispositivo; não gera credenciais."""
import argparse
import pathlib
import re
import secrets
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('--devices')
parser.add_argument('--new-session', action='store_true')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
env = root / '.env.demo'
values = {}
if env.exists():
    values = dict(line.split('=', 1) for line in env.read_text(encoding='utf-8').splitlines() if line and not line.startswith('#'))
    match = re.fullmatch(r'nightcare/demo/([a-f0-9]{16})/(?:nightcare-001/)?', values.get('MQTT_PREFIX', ''))
    if not match or values.get('MQTT_URL') != 'mqtt://broker.emqx.io:1883':
        raise SystemExit('Configuração demo incompatível; preserve .env.demo antes de preparar outra instalação.')
    ident = match[1]
    if values.get('MQTT_CLIENT_ID') != f'nightcare-{ident}-backend':
        raise SystemExit('MQTT_CLIENT_ID não corresponde à instalação.')
else:
    ident = secrets.token_hex(8)
previous = values.get('DEMO_DEVICES', 'nightcare-001').split(',')
requested = args.devices.split(',') if args.devices else previous
if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', d) or d in ('nightcare-backend', 'nightcare-health') for d in previous + requested) or len(set(requested)) != len(requested) or len(set(previous)) != len(previous):
    raise SystemExit('IDs devem ser distintos, com 1–32 letras ASCII, números, _ ou -; IDs de serviço são reservados.')
# Adicionar pacotes não apaga identidades nem pacotes anteriores.
devices = list(dict.fromkeys(['nightcare-001'] + ([] if args.new_session and args.devices else previous) + requested))
prefix = f'nightcare/demo/{ident}/'
def header(device):
    return f'''#pragma once
// Configuração pública de demonstração; não contém segredos.
#define NIGHTCARE_DEVICE_ID "{device}"
#define MQTT_HOST "broker.emqx.io"
#define MQTT_PORT 1883
#define MQTT_USE_TLS 0
#define MQTT_USER ""
#define MQTT_PASSWORD ""
#define MQTT_TOPIC_PREFIX "{prefix}{device}/"
#define MQTT_CLIENT_ID "nightcare-{ident}-{device}"
static const char MQTT_CA[] = "";
'''
# Recusar arquivos de outra instalação antes de qualquer gravação.
for target, device in [(root/'Wokwi/mqtt_demo.h', 'nightcare-001'), *[(root/f'Wokwi/demo/{d}/mqtt_demo.h', d) for d in set(devices + previous)]]:
    if target.exists() and (f'#define MQTT_TOPIC_PREFIX "{prefix}{device}/"' not in target.read_text(encoding='utf-8') or ('#define NIGHTCARE_DEVICE_ID' in target.read_text(encoding='utf-8') and f'#define NIGHTCARE_DEVICE_ID "{device}"' not in target.read_text(encoding='utf-8'))):
        raise SystemExit(f'Arquivo {target.relative_to(root)} pertence a outra instalação; nada foi sobrescrito.')
if args.new_session:
    # Arquiva os pacotes públicos; o volume SQLite anterior não é removido.
    if env.exists():
        archive = root/'.validation/demo-sessions'/ident
        archive.mkdir(parents=True, exist_ok=False)
        shutil.copyfile(env, archive/'.env.demo')
        if (root/'Wokwi/demo').exists():
            shutil.move(str(root/'Wokwi/demo'), str(archive/'Wokwi-demo'))
    ident = secrets.token_hex(8)
    prefix = f'nightcare/demo/{ident}/'
    print('Nova sessão vazia. Copie o mqtt_demo.h gerado para cada projeto Wokwi antes de iniciar a simulação.')
# O alias mantém a preparação simples e a compilação padrão em nightcare-001.
(root/'Wokwi/mqtt_demo.h').write_text(header('nightcare-001'), encoding='utf-8')
for device in devices:
    bundle = root/'Wokwi/demo'/device
    bundle.mkdir(parents=True, exist_ok=True)
    (bundle/'sketch.ino').write_text('#define NIGHTCARE_DEMO 1\n'+(root/'Wokwi/sketch.ino').read_text(encoding='utf-8'), encoding='utf-8')
    (bundle/'mqtt_demo.h').write_text(header(device), encoding='utf-8')
    for name in ['diagram.json', 'libraries.txt']:
        shutil.copyfile(root/'Wokwi'/name, bundle/name)
# Compatibilidade: os quatro arquivos diretos representam apenas nightcare-001.
base=root/'Wokwi/demo'
for name in ['sketch.ino','diagram.json','libraries.txt','mqtt_demo.h']:
    shutil.copyfile(base/'nightcare-001'/name,base/name)
(base/'wokwi.toml').write_text("[wokwi]\nversion = 1\nfirmware = '../../.pio/build/esp32demo/firmware.bin'\nelf = '../../.pio/build/esp32demo/firmware.elf'\n", encoding='utf-8')
volume = f'nightcare-demo-{ident}-sqlite' if args.new_session else values.get('DEMO_DATA_VOLUME', 'nightcare-demo_demo_sqlite')
env.write_text(f'MQTT_URL=mqtt://broker.emqx.io:1883\nMQTT_PREFIX={prefix}\nMQTT_CLIENT_ID=nightcare-{ident}-backend\nDEMO_DEVICES={",".join(devices)}\nDEMO_DATA_VOLUME={volume}\n', encoding='utf-8')
print('Pacotes prontos: '+', '.join(f'Wokwi/demo/{d}/' for d in devices))
