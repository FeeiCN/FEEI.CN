#!/usr/bin/env python3
"""Exercise the exact runtime permission profile without calling a model."""
import os
from pathlib import Path
import subprocess
import tempfile

PROBE = '''import errno
from pathlib import Path
from urllib.request import urlopen
try:
    Path('protected.txt').write_text('changed')
except OSError as error:
    if error.errno not in {errno.EACCES, errno.EPERM, errno.EROFS}:
        raise
    print('repository_write=denied')
else:
    raise SystemExit('ERROR: protected write permitted')
Path('output/probe.txt').write_text('ok')
print('output_write=allowed')
with urlopen('https://example.com', timeout=30) as response:
    if response.status != 200:
        raise SystemExit('ERROR: HTTPS source unavailable')
print('https_access=available')
'''

with tempfile.TemporaryDirectory(prefix='automation-permission-probe-') as folder:
    root = Path(folder)
    (root / 'output').mkdir()
    (root / 'protected.txt').write_text('keep')
    subprocess.run([
        'codex', 'sandbox', '--cd', folder, '--permission-profile', 'automation',
        '--config', 'permissions.automation=' + os.environ['AUTOMATION_PERMISSION_CONFIG'],
        '--', 'python3', '-c', PROBE,
    ], check=True, timeout=60)
    if (root / 'protected.txt').read_text() != 'keep':
        raise SystemExit('ERROR: readonly file changed')
