# -*- coding: utf-8 -*-
import io
import os
import traceback

BASE = os.path.dirname(os.path.abspath(__file__))
src_path = os.path.join(BASE, 'merge_workbench.py')
src = io.open(src_path, encoding='utf-8').read()

g = {'__name__': '__main__', '__file__': src_path}
try:
    exec(compile(src, src_path, 'exec'), g)
    log = 'SUCCESS\n'
    log += 'size=%d\nlines=%d\n' % (len(g.get('new_html', '')), g.get('new_html', '').count('\n') + 1)
except Exception:
    log = 'FAILED\n' + traceback.format_exc()

io.open(os.path.join(BASE, 'merge_log.txt'), 'w', encoding='utf-8').write(log)
