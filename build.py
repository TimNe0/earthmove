#!/usr/bin/env python3
"""Concatenate src/ into one self-contained dist/earthmove.html (no external references)."""
import pathlib, re, sys
root = pathlib.Path(__file__).parent
src = root / 'src'
rd = lambda n: (src / n).read_text(encoding='utf-8')

def utf16_units(c):
    b = c.encode('utf-16-be')
    return [int.from_bytes(b[i:i+2], 'big') for i in range(0, len(b), 2)]
def js_ascii(s):   # non-ASCII -> \uXXXX (valid in JS strings, regex literals and comments)
    return ''.join(c if ord(c) < 128 else ''.join('\\u%04x' % u for u in utf16_units(c)) for c in s)
def html_ascii(s): # non-ASCII -> numeric character references
    return ''.join(c if ord(c) < 128 else '&#%d;' % ord(c) for c in s)
html = html_ascii(rd('index.html'))
parts = {'CSS': rd('style.css'), 'ENGINE': rd('engine.js'), 'MODULES': rd('modules.js'),
         'MODEL': rd('model.js'), 'OPTIM': rd('optimiser.js'), 'RISK': rd('risk.js'), 'WORKER': rd('worker.js'), 'UI': rd('ui.js'),
         'TUTDATA': rd('tutorials.js'), 'TUTORIAL': rd('tutorial.js')}
parts = {k: (v if k == 'CSS' else js_ascii(v)) for k, v in parts.items()}
# model.js uses require() under Node only; the browser branch needs no change.
for k, v in parts.items():
    v = v.replace('</script', '<\\/script')
    html = re.sub(r'/\*@%s@\*/' % k, lambda m: v, html)
out = root / 'dist' / 'earthmove.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
bad = [c for c in html if ord(c) > 127]
if bad:
    sys.exit('ERROR: non-ASCII characters left in output: %r' % bad[:5])
if re.search(r'(src|href)\s*=\s*["\']https?:', html):
    sys.exit('ERROR: external reference found')
print('wrote', out, len(html), 'bytes')

# Artifact variant: the Artifact host adds its own <!doctype>/<head>/<body>, so strip ours.
m = re.search(r'<title>.*?</style>', html, re.S)
b = re.search(r'<body>(.*)</body>', html, re.S)
art = m.group(0).replace('Earthmove: earth movement simulator', 'Earthmove Simulator') + '\n' + b.group(1)
(root / 'dist' / 'earthmove-artifact.html').write_text(art, encoding='utf-8')
print('wrote artifact variant', len(art), 'bytes')
