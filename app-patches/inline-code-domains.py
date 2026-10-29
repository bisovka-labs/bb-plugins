#!/usr/bin/env python3
"""Inline code that is a bare domain (`beta.example.dev`, `docs.example.com/x`)
opens the site instead of a missing workspace file. BB links inline code as a
relative file when its last segment looks like an extension, and `.dev` does.
Re-run after a BB update; if the assertion fails, the bundle changed shape."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

assets = Path('/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets')
matches = list(assets.glob('markdown-preview-*.js'))
assert len(matches) == 1, matches
target = matches[0]
source = target.read_text()
marker = '/*bb-inline-code-domains*/'
if marker in source:
    sys.exit('already patched')

m = list(re.finditer(r'function [\w$]+\(\{codeText:(\w+),localFileRouting:(\w+)\}\)\{'
                     r'if\(\2===void 0\|\|\1\.length===0\|\|/\\s/u\.test\(\1\)\)return null;', source))
assert len(m) == 1, ('inline code linker changed', len(m))
m = m[0]
e = m.group(1)
# Lowercase host with a web TLD; `.cc` only with a subdomain, since `foo.cc` is
# usually C++. No `<>` so placeholders like `host/<token>` stay plain code.
label = r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.'
tlds = 'com|net|org|dev|app|io|ai|co|me|xyz|ru|kz|sg|uk|de|eu|us|info|biz|site|online|tech|cloud|page|gg|tv|ly'
domain = rf'/^(?:(?:{label})+(?:{tlds})|(?:{label}){{2,}}cc)(?::\d+)?(?:\/[^\s<>]*)?$/u'
insert = f'{marker}if({domain}.test({e}))return`https://${{{e}}}`;'
patched = source[:m.end()] + insert + source[m.end():]

candidate = target.with_suffix('.candidate.mjs')
try:
    candidate.write_text(patched)
    subprocess.run(['node', '--check', str(candidate)], check=True)
    backup = Path.home() / '.bb' / (target.name + '.pre-inline-code-domains')
    if not backup.exists():
        shutil.copy2(target, backup)
    os.replace(candidate, target)
finally:
    candidate.unlink(missing_ok=True)
subprocess.run(['gzip', '-9', '-k', '-f', str(target)], check=True)
subprocess.run(['brotli', '-q', '11', '-f', '-k', str(target)], check=True)
print('patched', target)
