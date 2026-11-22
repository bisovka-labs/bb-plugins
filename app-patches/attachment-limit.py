#!/usr/bin/env python3
"""BB: raise the prompt attachment limit from 35 MB to 2 GiB so videos attach.
The limit is one constant (PROMPT_ATTACHMENT_MAX_BYTES, minified to 36700160)
compiled into the web client, the server, the CLI and the host daemon; every copy
must agree or the upload passes one check and fails the next. The server keeps
the whole upload in memory while storing it, hence a ceiling rather than none.
Needs a bb restart (server, daemon) and ⌘R (client)."""
import glob, os, re, shutil, subprocess, sys
APP = '/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app'
OLD_BYTES = 35 * 1024 * 1024
NEW_BYTES = 2 * 1024 * 1024 * 1024
SOURCE = re.compile(r'PROMPT_ATTACHMENT_MAX_BYTES = 35 \* 1024 \* 1024;')
MINIFIED = re.compile(rf'(?<![\w.]){OLD_BYTES}(?![\w.])')
MARK = f'PROMPT_ATTACHMENT_MAX_BYTES = {NEW_BYTES};'

targets = [APP + '/server/dist/start-server.js', APP + '/dist/index.js',
           APP + '/host-daemon/dist/start-host-daemon.js', APP + '/host-daemon/dist/daemon-bundle.mjs']
assets = [f for f in glob.glob(APP + '/app/dist/assets/*.js') if str(OLD_BYTES) in open(f).read()
          or str(NEW_BYTES) in open(f).read() and 'attachment limit' in open(f).read()]
assert len(assets) == 1, ('client bundle with the limit not found/unique', assets)

patched = []
for f in targets + assets:
    s = open(f).read()
    if f.endswith('.mjs') or f in assets:
        n = len(MINIFIED.findall(s))
        if n == 0:
            assert str(NEW_BYTES) in s, ('limit missing', f)
            continue
        s = MINIFIED.sub(str(NEW_BYTES), s)
        s = s.replace('exceeds 35 MB', 'exceeds 2 GB')
    else:
        if MARK in s:
            continue
        s, n = SOURCE.subn(MARK, s)
        assert n == 1, ('constant missing', f, n)
    bak = os.path.expanduser('~/.bb/' + os.path.basename(f) + '.pre-attachment-limit')
    if not os.path.exists(bak):
        shutil.copy2(f, bak)
    open(f, 'w').write(s)
    subprocess.run(['node', '--check', f], check=True)
    if f in assets:
        subprocess.run(['gzip', '-9', '-k', '-f', f], check=True)
        subprocess.run(['brotli', '-q', '11', '-f', '-k', f], check=True)
    patched.append(f)

if not patched:
    sys.exit('already patched')
for f in patched:
    print('patched', f)
