from pathlib import Path
import json
import re

root=Path(__file__).resolve().parent
dist=root/'dist'
template=(root/'index.template.html').read_text(encoding='utf-8')
css=(dist/'styles.css').read_text(encoding='utf-8')
app=(dist/'app.js').read_text(encoding='utf-8')
grader=(dist/'grader.py').read_text(encoding='utf-8')
worker=(dist/'python-worker.js').read_text(encoding='utf-8')
worker=worker.replace("const [{loadPyodide}, response] = await Promise.all([import(base+'pyodide.mjs'), fetch('./grader.py')]);", "const {loadPyodide} = await import(base+'pyodide.mjs');")
worker=worker.replace("    if (!response.ok) throw Error('grader');\n",'')
worker=worker.replace('python.runPython(await response.text());','python.runPython('+json.dumps(grader,ensure_ascii=False)+');')
def safe_json(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
bank=json.loads((dist/'tasks.json').read_text(encoding='utf-8'))
html=re.sub(r'  <link rel="stylesheet"[^\n]+', '<style>'+css.replace('\\',r'\\')+'</style>',template)
scripts='<script id="task-data" type="application/json">'+safe_json(bank)+'</script>\n'
scripts+='<script id="worker-source" type="application/json">'+safe_json(worker)+'</script>\n'
scripts+='<script>\n(()=>{\n'+app+'\n})();\n</script>\n'
html=html.replace('</body>',scripts+'</body>')
(dist/'index.html').write_text(html,encoding='utf-8')
(root.parent/'outputs/python_trainer.html').write_text(html,encoding='utf-8')
print('Standalone HTML ready:',len(html.encode('utf-8')),'bytes')
