#!/usr/bin/env python3
"""BB built-in Browser Automation: local headless sessions launch Chrome with
the Chromium sandbox on. Upstream passes --no-sandbox, so a renderer exploit
on any page an agent opens runs unconfined as the user. Rewrites host.js and
its artifactDigest in host.meta.json (the host daemon keys the artifact by
it). Needs a bb restart; open sessions keep their old browser.
Re-run after a BB update; if the assertion fails, the bundle changed shape."""
import hashlib, json, os, shutil, sys
D = '/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/server/dist/builtin-plugins/browser-automation/dist'
HOST, META = f'{D}/host.js', f'{D}/host.meta.json'
OLD, NEW = '"--headless=new","--no-sandbox",', '"--headless=new",'

s = open(HOST).read()
if OLD not in s:
    assert '"--headless=new","--remote-debugging-port=0"' in s, 'launch args changed shape'
    sys.exit('already patched')
assert s.count(OLD) == 1, ('pattern not unique', s.count(OLD))
s = s.replace(OLD, NEW)

bak = os.path.expanduser('~/.bb/browser-automation-host.js.pre-browser-sandbox')
if not os.path.exists(bak):
    shutil.copy2(HOST, bak)
    shutil.copy2(META, bak.replace('host.js', 'host.meta.json'))
open(HOST, 'w').write(s)
meta = json.load(open(META))
meta['artifactDigest'] = hashlib.sha256(s.encode()).hexdigest()
open(META, 'w').write(json.dumps(meta, indent=2) + '\n')
print('patched', HOST)
