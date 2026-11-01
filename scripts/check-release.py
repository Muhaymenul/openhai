"""Check tracked release files without printing credential contents."""
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
forbidden = {'node_modules', '.next', '.venv', '__pycache__'}
patterns = [re.compile(r'\bsk-[A-Za-z0-9]{24,}\b'), re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}\b'), re.compile(r'\bgithub_pat_[A-Za-z0-9_]{40,}\b')]
errors = []
count = 0
for name in filter(None, names):
    path = root / name
    if not path.is_file():
        continue
    count += 1
    parts = Path(name).parts
    if (parts[0] in {'private', 'data', 'runtime', 'backups', 'tmp', 'reports'}
        or name.startswith('services/runtime/')
        or any(part in forbidden for part in parts) or path.name == 'provider.json'):
        errors.append(f'Private or generated path: {name}')
    if path.name.startswith('.env') and path.name != '.env.example':
        errors.append(f'Environment file: {name}')
    if path.stat().st_size > 25 * 1024 * 1024:
        errors.append(f'Oversized file: {name}')
    if path.suffix.lower() in {'.png', '.webp', '.jpg', '.jpeg', '.pdf', '.woff2', '.ico'}:
        continue
    text = path.read_text(encoding='utf-8', errors='ignore')
    if any(pattern.search(text) for pattern in patterns):
        errors.append(f'Credential-like value: {name}')
    if path.name == 'private.example.env':
        values = dict(line.split('=', 1) for line in text.splitlines() if '=' in line and not line.lstrip().startswith('#'))
        if values.get('PAPERFLOW_LLM_API_KEY', '').strip():
            errors.append('Model key template must be empty')

for required in ['README.md', 'docker-compose.yml', 'private.example.env', 'app/package-lock.json', 'app/Dockerfile.research', 'app/scripts/runtime/start-stack.sh', 'services/requirements.lock', 'services/paperflow/LICENSE', 'services/paperflow/src/paperflow/core/tools/base.py', 'docs/requirements/problem_definition.md', 'docs/algorithm/research.md']:
    if not (root / required).is_file():
        errors.append(f'Missing required file: {required}')
if errors:
    print('\n'.join(sorted(set(errors))))
    sys.exit(1)
print(f'Release check passed: {count} tracked files; no private/generated paths or credential patterns.')
