#!/usr/bin/env python3
"""BB host daemon: the "Add project" folder browser starts in START instead of
the home folder (falls back to home if START is missing). Needs a bb restart.
START is the first line of default-browse-path.txt next to this script; without
that file the patch does nothing.
Re-run after a BB update; if the assertion fails, the bundle changed shape."""
import os, re, shutil, sys
CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'default-browse-path.txt')
if not os.path.exists(CONFIG):
    print('skipped: no default-browse-path.txt')
    sys.exit(0)
START = os.path.expanduser(open(CONFIG).readline().strip())
F = '/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/daemon-bundle.mjs'
s = open(F).read()
if START in s:
    sys.exit('already patched')

m = list(re.finditer(r'(async function \w+\((\w+)\)\{let (\w+)=\2\.path\?\?)(\w+\.homedir\(\));'
                     r'(if\(!\w+\.isAbsolute\(\3\)\)throw new \w+\("invalid_path","Path must be absolute"\);'
                     r'if\(!\(await (\w+)\.stat\(\3\)\)\.isDirectory\(\)\))', s))
assert len(m) == 1, ('pattern not unique/missing', len(m))
m = m[0]
home, fsp = m.group(4), m.group(6)
repl = f'{m.group(1)}await {fsp}.stat({START!r}).then(()=>{START!r},()=>{home});{m.group(5)}'
s = s[:m.start()] + repl + s[m.end():]

bak = os.path.expanduser('~/.bb/daemon-bundle.mjs.pre-default-browse-path')
if not os.path.exists(bak):
    shutil.copy2(F, bak)
open(F, 'w').write(s)
print('patched', F)
