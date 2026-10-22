#!/usr/bin/env python3
"""Install Command-click and the link context menu in the packaged BB renderer."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

assets = Path('/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets')
matches = list(assets.glob('index-*.js'))
assert len(matches) == 1, matches
target = matches[0]
source = target.read_text()
marker = '// BB system-browser-links:'
if marker in source:
    sys.exit('already patched')

external = re.findall(r'function (\w+|\$\w+)\(\w+\)\{let \w+=\w+\(\);if\(\w+!==null\)\{\w+\.openExternalUrl\(\w+\);return\}', source)
clipboard = re.findall(r'(\w+)\(\w+\(\w+\),\{successMessage:`Thread link copied`,errorMessage:`Failed to copy thread link`\}', source)
assert len(external) == 1, ('external opener changed', external)
assert len(set(clipboard)) == 1, ('clipboard helper changed', clipboard)
patch = (Path(__file__).parent / 'system-browser-links/links.js').read_text()
patch = patch.replace('$8(url)', external[0] + '(url)').replace('xH(url,', clipboard[0] + '(url,')
candidate = target.with_suffix('.candidate.mjs')
try:
    candidate.write_text(source + '\n' + patch)
    subprocess.run(['node', '--check', str(candidate)], check=True)
    backup = Path.home() / '.bb' / (target.name + '.pre-system-browser-links')
    if not backup.exists():
        shutil.copy2(target, backup)
    os.replace(candidate, target)
finally:
    candidate.unlink(missing_ok=True)
subprocess.run(['gzip', '-9', '-k', '-f', str(target)], check=True)
subprocess.run(['brotli', '-q', '11', '-f', '-k', str(target)], check=True)
print('patched', target)
