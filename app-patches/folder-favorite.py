#!/usr/bin/env python3
"""BB "Add project" folder browser: star button that pins the current folder as
the start folder for that machine (localStorage). Click again to unpin.
Minified names are captured by regex so the patch survives most BB updates;
if an assertion fails, the bundle changed shape and the patterns need updating."""
import glob, os, re, shutil, subprocess, sys
D = '/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets'
F = [f for f in glob.glob(D + '/index-*.js') if 'Browse to the project folder' in open(f).read()]
assert len(F) == 1, F
F = F[0]
s = open(F).read()
if 'bb-folder-home:' in s:
    sys.exit('already patched')


def one(pattern, text):
    m = list(re.finditer(pattern, text))
    assert len(m) == 1, ('pattern not unique/missing', pattern[:70], len(m))
    return m[0]


# folder browser component: start in the pinned folder when no initial path is given
head = one(r'function \w+\(\{hostId:(\w+),initialPath:(\w+)=null,allowCreateFolder:\w+,'
           r'onDirectoryChange:\w+,disabled:\w+=!1\}\)\{let\[(\w+),(\w+)\]=\(0,(\w+)\.useState\)\(\2\),', s)
host, init, react = head.group(1), head.group(2), head.group(5)
start = head.start()
end = s.index('function ', head.end())
body = s[start:end]

dir_var = one(r',(\w+)=\w+\?\.directory\?\?null,', body).group(1)
cn = one(r'className:(\w+)\(`rounded px-1 py-0\.5', body).group(1)
edit = one(r'"aria-label":`Edit path`,disabled:(\w+),', body)
busy = edit.group(1)
newf = one(r'\w+\?\(0,(\w+)\.jsx\)\((\w+),\{type:`button`,variant:`ghost`,size:`icon`,'
           r'className:`size-7 shrink-0`,"aria-label":`New folder`', body)
jsx, btn = newf.group(1), newf.group(2)

T = dir_var
on = f'{T}&&{T}===hp'
star = (f'(0,{jsx}.jsx)({btn},{{type:`button`,variant:`ghost`,size:`icon`,className:`size-7 shrink-0`,'
        f'"aria-label":{on}?`Unpin start folder`:`Pin as start folder`,title:{on}?`Start folder (click to unpin)`:`Always start here`,'
        f'disabled:{busy}||!{T},onClick:()=>{{let v={T}===hp?null:{T};try{{v?localStorage.setItem(hk,v):localStorage.removeItem(hk)}}catch{{}}sh(v)}},'
        f'children:(0,{jsx}.jsx)(`svg`,{{viewBox:`0 0 24 24`,fill:{on}?`currentColor`:`none`,stroke:`currentColor`,strokeWidth:1.5,strokeLinejoin:`round`,'
        f'className:{cn}(`size-4`,{on}&&`text-attention`),"aria-hidden":!0,'
        f'children:(0,{jsx}.jsx)(`path`,{{d:`M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z`}})}})}}),')

new_head = head.group(0).replace(
    f'{{let[{head.group(3)},{head.group(4)}]=(0,{react}.useState)({init}),',
    f'{{let hk=`bb-folder-home:`+{host},[hp,sh]=(0,{react}.useState)(()=>{{try{{return localStorage.getItem(hk)}}catch{{return null}}}}),'
    f'[{head.group(3)},{head.group(4)}]=(0,{react}.useState)({init}??hp),')
assert new_head != head.group(0)
body = body.replace(head.group(0), new_head, 1)
body = body[:body.index(newf.group(0))] + star + body[body.index(newf.group(0)):]
s = s[:start] + body + s[end:]

bak = os.path.expanduser('~/.bb/' + os.path.basename(F) + '.pre-folder-favorite')
if not os.path.exists(bak):
    shutil.copy2(F, bak)
open(F, 'w').write(s)
subprocess.run(['gzip', '-9', '-k', '-f', F], check=True)
subprocess.run(['brotli', '-q', '11', '-f', '-k', F], check=True)
print('patched', F)
