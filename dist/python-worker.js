let python;
const base = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
async function init() {
  try {
    const [{loadPyodide}, response] = await Promise.all([import(base+'pyodide.mjs'), fetch('./grader.py')]);
    if (!response.ok) throw Error('grader');
    python = await loadPyodide({indexURL:base});
    python.runPython(await response.text());
    self.postMessage({type:'ready'});
  } catch (error) { self.postMessage({type:'loading-error',message:String(error)}); }
}
self.onmessage = ({data}) => {
  if (data.type !== 'run' || !python) return;
  try {
    python.globals.set('_request_json',JSON.stringify({code:data.code,tests:data.tests,chapter:data.chapter}));
    const report=JSON.parse(python.runPython('_grade_json(_request_json)'));
    python.globals.delete('_request_json');
    self.postMessage({type:'result',variantId:data.variantId,report});
  } catch (error) {
    self.postMessage({type:'result',variantId:data.variantId,report:{status:'error',title:'Ошибка проверяющей среды',message:'Запусти проверку ещё раз. Если ошибка повторяется, обнови страницу.'}});
  }
};
init();
