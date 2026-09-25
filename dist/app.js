const $ = (id) => document.getElementById(id);
const editor = $('editor');
let bank, tasks = [], taskIndex = 0, variantIndex = 0, worker, ready = false, running = false, generation = 0, timer, selectionReady=false;
const drafts = new Map(), reports = new Map();
const jokes = JSON.parse(document.getElementById('joke-data')?.textContent || '[]');
let fireTimer, fireTicket=0;
const fireVideo=$('fire-video');
fireVideo.src=document.getElementById('fire-data')?.textContent.trim() || './assets/fire-ring.mp4';
fireVideo.muted=true;
const current = () => tasks[taskIndex]?.variants[variantIndex];
const starter = '# Входные переменные уже подготовлены.\n# Запиши ответ в result.\n\n';
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function runtime(text, state = '') { $('runtime').className = `runtime ${state}`; $('runtime').replaceChildren(node('i'),document.createTextNode(text)); }
function updateEditor() {
  $('line-numbers').textContent = Array.from({length:editor.value.split('\n').length},(_,i)=>i+1).join('\n');
  $('line-numbers').scrollTop = editor.scrollTop;
  const prefix = editor.value.slice(0,editor.selectionStart).split('\n');
  $('cursor').textContent = `Строка ${prefix.length}, столбец ${prefix.at(-1).length+1}`;
}
function saveDraft() { if (selectionReady && current()) drafts.set(current().id, editor.value); }
function renderNav() {
  $('task-nav').replaceChildren();
  tasks.forEach((task,i)=>{
    if (task.difficulty === 'complex' && tasks[i-1]?.difficulty !== 'complex') $('task-nav').append(node('div','КОМПЛЕКСНЫЕ','nav-divider'));
    const button=node('button',undefined,'nav-item'+(i===taskIndex?' active':''));
    if(i===taskIndex) button.setAttribute('aria-current','true');
    button.append(node('span',String(i+1).padStart(2,'0'),'nav-num'),node('span',task.title));
    if(task.variants.every(v=>reports.get(v.id)?.status==='passed')) button.append(node('span','✓','nav-check'));
    button.addEventListener('click',()=>selectTask(i,0)); $('task-nav').append(button);
  });
}
function selectTask(ti,vi=0) {
  if(!tasks[ti]?.variants[vi]) return;
  stopFire();
  saveDraft(); if(running) cancelRun(false);
  taskIndex=ti; variantIndex=vi;
  const task=tasks[ti], v=current();
  history.replaceState(null,'',`#${v.id}`);
  $('task-number').textContent=`ЗАДАЧА ${String(ti+1).padStart(2,'0')} / ${tasks.length}`;
  $('task-title').textContent=task.title; $('context').textContent=task.context;
  $('difficulty').textContent=task.difficulty==='complex'?'Комплексная':'Отработка';
  $('difficulty').className='badge'+(task.difficulty==='complex'?' complex':'');
  $('prev').disabled=false; $('next').disabled=false;
  const position=ti;
  const total=tasks.length;
  $('prev').title=position===0?'К последней задаче':'Предыдущая задача';
  $('next').title=position===total-1?'К первой задаче':'Следующая задача';
  $('prev').setAttribute('aria-label',$('prev').title);
  $('next').setAttribute('aria-label',$('next').title);
  $('position').textContent=`${position+1} / ${total}`;
  $('variants').replaceChildren();
  task.variants.forEach((variant,i)=>{
    const button=node('button',`${i+1}. ${variant.title}`,'variant-tab');
    button.setAttribute('role','tab'); button.setAttribute('aria-selected',String(i===vi));
    button.addEventListener('click',()=>selectTask(ti,i));
    button.addEventListener('keydown',(event)=>{
      if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?task.variants.length-1:(i+(event.key==='ArrowLeft'?-1:1)+task.variants.length)%task.variants.length;
        selectTask(ti,next); $('variants').children[next].focus();
      }
    });
    $('variants').append(button);
  });
  $('variant-title').textContent=v.title; $('statement').textContent=v.statement;
  $('test-count').textContent=`${v.tests.length} тестов`;
  $('inputs').replaceChildren();
  Object.entries(v.inputs).forEach(([name,description])=>$('inputs').append(node('dt',name),node('dd',description)));
  $('example-input').textContent=v.tests[0].setup_code;
  $('example-output').textContent=v.tests[0].expected_python;
  $('focus').replaceChildren(...v.focus.map(x=>node('span',x,'chip')));
  editor.value=drafts.get(v.id)??starter; selectionReady=true;
  updateEditor(); renderNav(); renderReport(reports.get(v.id));
}
function field(label,value) { const el=node('div',undefined,'test-field');el.append(node('span',label),node('pre',value));return el; }
function jumpToLine(line) {
  const lines=editor.value.split('\n'), start=lines.slice(0,line-1).reduce((s,x)=>s+x.length+1,0);
  editor.focus();editor.setSelectionRange(start,start+(lines[line-1]?.length??0));editor.scrollTop=Math.max(0,(line-4)*23);updateEditor();
}
function renderReport(report) {
  const joke=jokes.find(item=>item.taskId===tasks[taskIndex]?.id);
  $('joke-panel').hidden=report?.status!=='passed'||!joke;
  if(report?.status==='passed'&&joke){
    $('joke-title').textContent=joke.character;
    $('joke-number').textContent=`НАГРАДА ЗА ЗАДАЧУ ${taskIndex+1}`;
    $('joke-text').textContent=joke.text;
    $('joke-source').href=joke.source;
  }
  const box=$('results'); box.replaceChildren(); $('result-count').textContent='';
  if(!report){const empty=node('div',undefined,'empty-result');empty.append(node('span','>_','terminal-symbol'),node('p','Здесь появится результат'),node('span','Запусти код, чтобы проверить его на всех тестах.'));box.append(empty);return;}
  const passed=report.tests?.filter(t=>t.status==='passed').length??0;
  const banner=node('div',undefined,'result-banner'+(report.status==='passed'?'':report.status==='running'?' pending':' fail'));
  banner.append(node('strong',report.title??(report.status==='passed'?'✓ Всё правильно — все тесты пройдены':'Есть ошибки в решении')));
  if(report.message) banner.append(node('p',report.message));
  box.append(banner);
  if(report.tests?.length) $('result-count').textContent=`${passed} / ${report.tests.length}`;
  if(report.error) {
    const errorBox=node('div',undefined,'test-result');renderError(errorBox,report.error);box.append(errorBox);
  }
  report.tests?.forEach((test,i)=>{
    const detail=node('details',undefined,'test-result'); detail.open=test.status!=='passed';
    const summary=node('summary'); summary.append(node('span',`Тест ${i+1} · ${test.purpose}`),node('span',test.status==='passed'?'✓ Пройден':test.status==='error'?'Ошибка':'Не пройден','test-state'+(test.status==='passed'?'':' fail')));detail.append(summary);
    detail.append(field('Входные данные',test.input),field('Ожидаемый result',test.expected));
    if(test.error) renderError(detail,test.error); else detail.append(field('Полученный result',test.actual??'result не определён'));
    if(test.stdout || test.stdoutMismatch) {detail.append(field('Вывод print()',test.stdout||'(пусто)'));if(test.stdoutMismatch)detail.append(node('p','По условию печатать ничего не нужно. Убери print() и запиши ответ в result.','error-hint'));}
    box.append(detail);
  });
}
function renderError(parent,error) {
  parent.append(node('div',`${error.type}: ${error.message}`,'error-title'));
  if(error.line){const button=node('button',`Строка ${error.line}${error.column?`, столбец ${error.column}`:''} ↗`,'error-line');button.addEventListener('click',()=>jumpToLine(error.line));parent.append(button);}
  if(error.hint)parent.append(node('p',error.hint,'error-hint'));
}
function controls() { $('run').disabled=!bank||running; $('run').textContent=running?'Проверяем…':ready?'▷ Проверить решение':'↻ Подключить Python';$('stop').hidden=!running;editor.readOnly=running; }
function initWorker() {
  clearTimeout(timer); worker?.terminate(); ready=false; const epoch=++generation;
  runtime('Python загружается');
  const bundled=document.getElementById('worker-source');
  const workerURL=bundled?URL.createObjectURL(new Blob([JSON.parse(bundled.textContent)],{type:'text/javascript'})):'./python-worker.js';
  worker=new Worker(workerURL,{type:'module'});
  if(bundled)URL.revokeObjectURL(workerURL);
  timer=setTimeout(()=>engineFailure('Загрузка Python заняла слишком много времени. Проверь интернет и нажми «Подключить Python».'),90000);
  worker.onmessage=({data})=>{
    if(epoch!==generation)return;
    if(data.type==='ready'){clearTimeout(timer);ready=true;runtime('Python готов','ready');controls();}
    if(data.type==='loading-error')engineFailure('Не удалось загрузить Python. Проверь интернет и нажми «Подключить Python».');
    if(data.type==='result'){
      clearTimeout(timer);running=false;
      reports.set(data.variantId,data.report);if(current()?.id===data.variantId){renderReport(data.report);if(data.report.status==='failed'||data.report.status==='error')playFire();}
      runtime('Python готов','ready');controls();renderNav();
    }
  };
  worker.onerror=()=>{if(epoch===generation)engineFailure('Среда Python остановилась. Нажми «Подключить Python» и попробуй снова.');};
  controls();
}
function engineFailure(message) { clearTimeout(timer);worker?.terminate();generation++;ready=false;running=false;runtime('Python недоступен','failed');controls();renderReport({status:'error',title:'Не удалось запустить проверку',message}); }
function cancelRun(show=true) {
  clearTimeout(timer);running=false;worker?.terminate();generation++;
  if(show)renderReport({status:'error',title:'Проверка остановлена',message:'Код сохранён в редакторе. Можно исправить его и запустить снова.'});
  initWorker();
}
function runCode() {
  if(!bank||running)return;
  if(!ready){initWorker();return;}
  stopFire();saveDraft();running=true;controls();runtime('Проверяем тесты');
  renderReport({status:'running',title:'Проверяем решение…',message:`Подставляем входные данные: ${current().tests.length} тестов.`});
  const id=current().id;
  timer=setTimeout(()=>{
    const report={status:'error',title:'Превышено время выполнения',message:'Проверка заняла больше 5 секунд. Проверь размеры создаваемых строк и списков.'};
    reports.set(id,report);cancelRun(false);renderReport(report);playFire();
  },5000);
  worker.postMessage({type:'run',variantId:id,code:editor.value,tests:current().tests});
}
function stopFire(){
  fireTicket++;clearTimeout(fireTimer);$('fire-overlay').classList.remove('is-playing','reduced-motion');fireVideo.pause();
}
function playFire(){
  stopFire();const ticket=fireTicket;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    $('fire-overlay').classList.add('reduced-motion');fireTimer=setTimeout(stopFire,350);return;
  }
  fireVideo.currentTime=0;
  fireVideo.playbackRate=1/3;
  // Slow both the footage and its fade envelope by the same factor.
  const playback=fireVideo.play();
  Promise.resolve(playback).then(()=>{
    if(ticket!==fireTicket)return;
    $('fire-overlay').classList.add('is-playing');fireTimer=setTimeout(stopFire,3000);
  }).catch(()=>{if(ticket===fireTicket)stopFire();});
}
fireVideo.addEventListener('ended',stopFire);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFire();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')stopFire();});
editor.addEventListener('input',()=>{saveDraft();updateEditor();if(current()&&reports.has(current().id)){reports.delete(current().id);renderReport();renderNav();}});
editor.addEventListener('scroll',()=>$('line-numbers').scrollTop=editor.scrollTop);
editor.addEventListener('click',updateEditor);editor.addEventListener('keyup',updateEditor);
let escapeTab=false;
editor.addEventListener('keydown',(event)=>{
  if(event.key==='Escape'){escapeTab=true;return;}
  if(event.key==='Tab'&&!escapeTab){event.preventDefault();if(!editor.readOnly){editor.setRangeText('    ',editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input'));}}
  if(event.key!=='Escape')escapeTab=false;
  if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey&&!editor.readOnly){event.preventDefault();const start=editor.selectionStart;const last=editor.value.slice(0,start).split('\n').at(-1);const indent=last.match(/^\s*/)[0]+(last.trimEnd().endsWith(':')?'    ':'');editor.setRangeText('\n'+indent,start,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input'));}
});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();runCode();}});
$('run').addEventListener('click',runCode);$('stop').addEventListener('click',()=>cancelRun());
function moveExercise(delta) {
  if(tasks.length)selectTask((taskIndex+delta+tasks.length)%tasks.length,0);
}
$('prev').addEventListener('click',()=>moveExercise(-1));$('next').addEventListener('click',()=>moveExercise(1));
$('chapter').addEventListener('change',()=>selectTask(0));
window.addEventListener('beforeunload',event=>{if([...drafts.values()].some(x=>x.trim()&&x!==starter)){event.preventDefault();event.returnValue='';}});
async function start() {
  try{
    const bundled=document.getElementById('task-data');
    if(bundled)bank=JSON.parse(bundled.textContent);
    else{const response=await fetch('./tasks.json');if(!response.ok)throw Error('tasks');bank=await response.json();}
    tasks=bank.chapters[0].tasks;
    $('chapter').replaceChildren(node('option',bank.chapters[0].title));$('task-count').textContent=tasks.length;
    let ti=0,vi=0;tasks.forEach((t,i)=>t.variants.forEach((v,j)=>{if('#'+v.id===location.hash){ti=i;vi=j;}}));
    selectTask(ti,vi);initWorker();registerTools();
  }catch(error){$('statement').textContent='Не удалось загрузить задачи. Обнови страницу и проверь соединение.';runtime('Ошибка загрузки','failed');}
}
function registerTools(){
  const context=document.modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const definitions=[
    {name:'list_python_exercises',description:'Прочитать список доступных задач и вариантов.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>tasks.map(t=>({title:t.title,variants:t.variants.map(v=>({id:v.id,title:v.title}))}))},
    {name:'select_python_exercise',description:'Открыть вариант задачи в тренажёре. Текущий черновик остаётся в памяти вкладки.',inputSchema:{type:'object',properties:{variantId:{type:'string'}},required:['variantId'],additionalProperties:false},annotations:{readOnlyHint:false},execute:({variantId})=>{for(let i=0;i<tasks.length;i++){const j=tasks[i].variants.findIndex(v=>v.id===variantId);if(j!==-1){selectTask(i,j);return {id:current().id,title:current().title};}}throw Error('Неизвестный вариант');}}
  ];
  for(const definition of definitions){try{Promise.resolve(context.registerTool(definition,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
}
start();
