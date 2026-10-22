#!/usr/bin/env python3
"""Make clients load patched BB chunks instead of stale cached copies.
Assets are served `immutable` and pass through Cloudflare on getbb.app, so a
chunk fetched before patching stays cached under its URL. index.html is
no-cache, so an import map there redirects each patched chunk (one with a
~/.bb/<name>.orig or <name>.pre-* backup) to a ?v=<content hash> URL; the entry
<script src> is rewritten too, since import maps don't apply to it."""
import glob, hashlib, json, os, re, subprocess
DIST = '/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist'
HTML = DIST + '/index.html'
backups = [os.path.basename(b) for b in glob.glob(os.path.expanduser('~/.bb/*.js.*'))]
imports = {}
for f in sorted(glob.glob(DIST + '/assets/*.js')):
    name = os.path.basename(f)
    if any(b == name + '.orig' or b.startswith(name + '.pre-') for b in backups):
        v = hashlib.sha1(open(f, 'rb').read()).hexdigest()[:10]
        imports['/assets/' + name] = '/assets/' + name + '?v=' + v
s0 = open(HTML).read()
s = re.sub(r'\s*<script type="importmap" id="bb-importmap">.*?</script>', '', s0, flags=re.S)
s = re.sub(r'(<script type="module" crossorigin src="/assets/[^"?]+\.js)\?v=\w+"', r'\1"', s)
if imports:
    for k, v in imports.items():
        s = s.replace(f'<script type="module" crossorigin src="{k}"', f'<script type="module" crossorigin src="{v}"')
    tag = '<script type="importmap" id="bb-importmap">' + json.dumps({'imports': imports}) + '</script>\n    '
    i = s.index('<script type="module"')
    s = s[:i] + tag + s[i:]
if s != s0:
    bak = os.path.expanduser('~/.bb/index.html.orig')
    if not os.path.exists(bak) and 'bb-importmap' not in s0:
        open(bak, 'w').write(s0)
    open(HTML, 'w').write(s)
    subprocess.run(['gzip', '-9', '-k', '-f', HTML], check=True)
    subprocess.run(['brotli', '-q', '11', '-f', '-k', HTML], check=True)
    print('index.html updated:', json.dumps(imports))
