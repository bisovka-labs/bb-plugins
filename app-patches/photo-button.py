#!/usr/bin/env python3
"""BB composer: add a photo button next to "+" that opens an image-only picker.
Re-run after a BB update. Minified names are discovered by regex, so renames
between builds are fine; an assertion failure means the code shape changed."""
import glob, os, re, shutil, subprocess, sys
D = '/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets'
F = [f for f in glob.glob(D + '/environment-workspace-display-*.js')]
assert len(F) == 1, F
F = F[0]
s = open(F).read()
if 'data-bb-photos' in s:
    sys.exit('already patched')


def one(pattern, text):
    m = list(re.finditer(pattern, text))
    assert len(m) == 1, ('pattern not unique/missing', pattern[:70], len(m))
    return m[0]


# hidden image-only input in the prompt form, sharing the attach change handler
m = one(r'\(0,(\w+)\.jsx\)\(`input`,\{ref:\w+,type:`file`,multiple:!0,className:`hidden`,onChange:(\w+)\}\)', s)
jsx, onChange = m.group(1), m.group(2)
s = s[:m.end()] + (f',(0,{jsx}.jsx)(`input`,{{"data-bb-photos":``,type:`file`,accept:`image/*`,'
                   f'multiple:!0,className:`hidden`,onChange:{onChange}}})') + s[m.end():]

# the "+" menu component: reuse its button component and classes
m = one(r'\(0,(\w+)\.jsx\)\((\w+),\{ref:\w+,type:`button`,size:`icon`,variant:`ghost`,'
        r'"aria-label":`Prompt actions`,className:(\w+)\((\w+),(\w+),`-ml-1\.5`\)', s)
jsx, button, cn, c1, c2 = m.groups()
start = s.rfind('function ', 0, m.start())
attach = one(r'onAttach:(\w+),onAction', s[start:m.start()]).group(1)
end = one(r't\[15\]=(\w+)\):\1=t\[15\],\1\}', s[m.end():m.end() + 3000])
node = end.group(1)
cut = m.end() + end.end() - len(node) - 1  # position of the final `T` before `}`
photo = (f'(0,{jsx}.jsx)({button},{{type:`button`,size:`icon`,variant:`ghost`,"aria-label":`Attach photos`,'
         f'title:`Attach photos`,className:{cn}({c1},{c2},`select-none touch-manipulation ml-1 mr-3`),'
         'onClick:e=>e.currentTarget.closest(`form`)?.querySelector(`input[data-bb-photos]`)?.click(),'
         f'children:(0,{jsx}.jsxs)(`svg`,{{viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:1.5,'
         'strokeLinecap:`round`,strokeLinejoin:`round`,className:`size-4 pointer-events-none`,"aria-hidden":!0,children:['
         f'(0,{jsx}.jsx)(`rect`,{{x:3,y:3,width:18,height:18,rx:3}}),(0,{jsx}.jsx)(`circle`,{{cx:8.5,cy:8.5,r:1.5}}),'
         f'(0,{jsx}.jsx)(`path`,{{d:`M21 15l-5-5L5 21`}})]}})}})')
assert s[cut:cut + len(node) + 1] == node + '}', s[cut - 20:cut + 20]
s = s[:cut] + f'{attach}?(0,{jsx}.jsxs)({jsx}.Fragment,{{children:[{node},{photo}]}}):{node}' + s[cut + len(node):]

bak = os.path.expanduser('~/.bb/' + os.path.basename(F) + '.orig')
if not os.path.exists(bak):
    shutil.copy2(F, bak)
open(F, 'w').write(s)
subprocess.run(['node', '--check', F], check=True)
subprocess.run(['gzip', '-9', '-k', '-f', F], check=True)
subprocess.run(['brotli', '-q', '11', '-f', '-k', F], check=True)
print('patched', F)
