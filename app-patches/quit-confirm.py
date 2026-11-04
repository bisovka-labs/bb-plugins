#!/usr/bin/env python3
"""BB: ⌘Q (and bb → Quit bb) asks «Вы уверены, что хотите закрыть bb?» first.
Replaces the app menu's { role: "quit" } in dist/main.js inside app.asar with
an item that shows a sheet and then calls app.quit(). Quitting from the Dock,
logout/shutdown and update installs still quit without asking.
The new main.js is appended to the archive and the header repointed at it.
Needs a bb restart. Re-run after a BB update; if the assertion fails, the
bundle changed shape."""
import hashlib, json, os, shutil, struct, subprocess, sys, tempfile
ASAR = '/Applications/bb.app/Contents/Resources/app.asar'
MARKER = '/* BB quit-confirm */'
OLD = '{ role: "quit" }'
NEW = '''{
          label: `Quit ${import_electron8.app.name}`,
          accelerator: "CmdOrCtrl+Q",
          click(_item, focusedWindow) {
            %s
            if (globalThis.__bbQuitConfirmOpen) return;
            globalThis.__bbQuitConfirmOpen = true;
            const { app, dialog, BrowserWindow } = import_electron8;
            const options = {
              type: "question",
              buttons: ["Выйти", "Отмена"],
              defaultId: 0,
              cancelId: 1,
              message: `Вы уверены, что хотите закрыть ${app.name}?`
            };
            const win = focusedWindow ?? BrowserWindow.getFocusedWindow();
            (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)).then(({ response }) => {
              globalThis.__bbQuitConfirmOpen = false;
              if (response === 0) app.quit();
            });
          }
        }''' % MARKER

data = open(ASAR, 'rb').read()
_, pickle_size, _, json_len = struct.unpack_from('<4I', data)
base = 8 + pickle_size
header = json.loads(data[16:16 + json_len])
entry = header['files']['dist']['files']['main.js']
start = base + int(entry['offset'])
src = data[start:start + entry['size']].decode()
if MARKER in src:
    sys.exit('already patched')
assert src.count(OLD) == 1, ('quit menu item changed', src.count(OLD))
assert '// src/menu.ts\nvar import_electron8 = require("electron");' in src, 'menu module changed'
src = src.replace(OLD, NEW)

with tempfile.NamedTemporaryFile('w', suffix='.cjs', delete=False) as t:
    t.write(src)
try:
    subprocess.run(['node', '--check', t.name], check=True)
finally:
    os.unlink(t.name)

body = src.encode()
digest = hashlib.sha256(body).hexdigest()
entry['offset'] = str(len(data) - base)
entry['size'] = len(body)
entry['integrity'] = {'algorithm': 'SHA256', 'hash': digest, 'blockSize': 4194304,
                      'blocks': [hashlib.sha256(body[i:i + 4194304]).hexdigest()
                                 for i in range(0, len(body), 4194304)]}
hjson = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
padded = hjson + b'\0' * (-len(hjson) % 4)
new_header = struct.pack('<4I', 4, 8 + len(padded), 4 + len(padded), len(hjson)) + padded

bak = os.path.expanduser('~/.bb/app.asar.pre-quit-confirm')
if not os.path.exists(bak):
    shutil.copy2(ASAR, bak)
tmp = ASAR + '.quit-confirm.tmp'
with open(tmp, 'wb') as f:
    f.write(new_header + data[base:] + body)
os.replace(tmp, ASAR)  # a running bb keeps reading the old file
print('patched', ASAR)
