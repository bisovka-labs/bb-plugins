#!/usr/bin/env python3
"""BB composer: add a photo button next to "+" that opens an image-only picker.
Since bb 0.47 the composer is the builtin `bb--composer` plugin, so this patches
its frontend bundle; `bb plugin reload bb--composer` (or a bb restart) serves it.
Minified names are discovered by regex, so renames between builds are fine; an
assertion failure means the code shape changed."""
import os, re, shutil, subprocess, sys
F = ('/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/'
     'server/dist/builtin-plugins/composer/dist/app.js')
s = open(F).read()
if 'data-bb-photos' in s:
    sys.exit('already patched')


def one(pattern, text):
    m = list(re.finditer(pattern, text))
    assert len(m) == 1, ('pattern not unique/missing', pattern[:70], len(m))
    return m[0]


# hidden image-only input in the prompt form, sharing the attach change handler
m = one(r'(\w+)\("input",\{ref:\w+,type:"file",multiple:!0,className:"hidden",onChange:(\w+)\}\)', s)
jsx, onChange = m.group(1), m.group(2)
s = s[:m.end()] + (f',{jsx}("input",{{"data-bb-photos":"",type:"file",accept:"image/*",'
                   f'multiple:!0,className:"hidden",onChange:{onChange}}})') + s[m.end():]

# the "+" menu: put the photo button right after its popover trigger, reusing its
# button component and classes (the popover root renders no DOM of its own)
m = one(r'(\w+)\((\w+),\{ref:\w+,type:"button",size:"icon",variant:"ghost","aria-label":"Prompt actions",'
        r'className:(\w+)\((\w+),(\w+),"-ml-1\.5"\),children:\w+\(\w+,\{name:"Plus",className:"size-4"\}\)\}\)\}\),', s)
jsx, button, cn, c1, c2 = m.groups()
# the popover root call takes a children array, so its creator is the jsxs function
root = one(r'(\w+)\(\w+,\{modal:!1,onOpenChange:', s[m.start() - 600:m.start()]).group(1)
photo = (f'{jsx}({button},{{type:"button",size:"icon",variant:"ghost","aria-label":"Attach photos",'
         f'title:"Attach photos",className:{cn}({c1},{c2},"select-none touch-manipulation ml-1 mr-3"),'
         'onClick:e=>e.currentTarget.closest("form")?.querySelector("input[data-bb-photos]")?.click(),'
         f'children:{root}("svg",{{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.5,'
         'strokeLinecap:"round",strokeLinejoin:"round",className:"size-4 pointer-events-none","aria-hidden":!0,children:['
         f'{jsx}("rect",{{x:3,y:3,width:18,height:18,rx:3}}),{jsx}("circle",{{cx:8.5,cy:8.5,r:1.5}}),'
         f'{jsx}("path",{{d:"M21 15l-5-5L5 21"}})]}})}}),')
s = s[:m.end()] + photo + s[m.end():]

shutil.copy2(F, os.path.expanduser('~/.bb/composer-app.orig.js'))
open(F, 'w').write(s)
subprocess.run(['node', '--check', F], check=True)
print('patched', F)
