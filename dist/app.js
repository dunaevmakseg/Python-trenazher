const $ = (id) => document.getElementById(id);
const editor = $('editor');
let bank, tasks = [], chapterIndex = 0, taskIndex = 0, variantIndex = 0, worker, ready = false, running = false, generation = 0, timer, selectionReady=false;
const drafts = new Map(), reports = new Map();
const jokes = JSON.parse(document.getElementById('joke-data')?.textContent || '[]');
let fireTimer, fireTicket=0;
const fireVideo=$('fire-video');
fireVideo.src=document.getElementById('fire-data')?.textContent.trim() || './assets/fire-ring.mp4';
fireVideo.muted=true;
const current = () => tasks[taskIndex]?.variants[variantIndex];
const starter = '# Входные переменные уже подготовлены.\n# Запиши ответ в result.\n\n';
function initialCode(v) {
  if(v.contract?.submission==='function_definitions')return '# Определи функции из условия.\n# Проверка сама вызовет их с тестовыми данными.\n\n';
  if(v.contract?.submission==='module_source')return '# Напиши код модуля из условия.\n# Имя модуля и sample подставит проверка.\n\n';
  if(v.tests[0].setup_code.includes('input ='))return '# Читай данные через input(), как указано в условии.\n# Тесты сами подставят ответы.\n\n';
  if(v.contract?.output_variables)return '# Используй подготовленные переменные.\n# Сохрани ответ в переменные из условия.\n\n';
  return starter;
}
function visibleInputs(test, v) {
  const names=new Set(Object.keys(v.inputs));
  const lines=test.setup_code.split('\n').filter(line=>names.has(line.match(/^([A-Za-z_]\w*)\s*=/)?.[1]));
  return lines.join('\n')||test.setup_code;
}
function selectChapter(index, ti=0, vi=0) {
  if(!auth)return;
  if(!bank.chapters[index]?.tasks[ti]?.variants[vi])return;
  saveDraft(); selectionReady=false;
  chapterIndex=index; tasks=bank.chapters[index].tasks;
  $('chapter').value=String(index);
  $('chapter-name').textContent=bank.chapters[index].title;
  $('task-count').textContent=tasks.length;
  $('task-nav').setAttribute('aria-label',`Задачи главы ${index+1}`);
  selectTask(ti,vi);
}
function selectById(id) {
  for(let ci=0;ci<bank.chapters.length;ci++){
    const chapter=bank.chapters[ci];
    for(let ti=0;ti<chapter.tasks.length;ti++){
      const vi=chapter.tasks[ti].variants.findIndex(v=>v.id===id);
      if(vi!==-1){selectChapter(ci,ti,vi);return true;}
    }
  }
  return false;
}
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
    if(task.variants.every(v=>progress[v.id]?.solved)) button.append(node('span','✓','nav-check'));
    button.addEventListener('click',()=>selectTask(i,0)); $('task-nav').append(button);
  });
}
function selectTask(ti,vi=0) {
  if(!auth)return;
  showScreen('practice');
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
    const button=node('button',`${i+1}. ${variant.title}`,'variant-tab'+(progress[variant.id]?.solved?' is-solved':''));
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
  $('example-input').textContent=visibleInputs(v.tests[0],v);
  $('example-output').textContent=v.tests[0].expected_python;
  const functionMode=v.contract?.submission==='function_definitions';
  const moduleMode=v.contract?.submission==='module_source';
  const inputMode=v.tests[0].setup_code.includes('input =');
  $('contract-title').textContent=functionMode?'Как отправить решение':moduleMode?'Код модуля':'Куда записать ответ';
  $('contract-text').textContent=functionMode?'Определи функции с именами и параметрами из условия. Проверка сама вызовет их. Печатай только если этого требует задача.':moduleMode?'Напиши код модуля из условия. Проверка выполнит его как отдельный запуск и как импорт.':inputMode?'Ответы для input() подставляются автоматически. Запиши результат в переменную result по условию.':v.contract?.output_variables?`Подготовленные переменные уже доступны. Сохрани ответ в: ${v.contract.output_variables.join(', ')}.`:'Присвой ответ переменной result. Входные переменные уже подготовлены. Печатать ничего не нужно.';
  const probe=v.tests[0].probe_code||'actual = result';
  if(v.contract?.checker_note)$('contract-text').textContent+=' '+v.contract.checker_note;
  $('probe-details').hidden=probe==='actual = result';
  $('probe-code').textContent=probe;
  $('example-stdout').textContent=JSON.stringify(v.tests[0].expected_stdout);
  $('stdout-example').hidden=!v.tests.some(t=>t.expected_stdout);
  $('example-label').textContent=probe==='actual = result'?'Ожидаемый result':'Ожидаемый результат проверки';
  $('review-list').replaceChildren(...(v.manual_review||[]).map(text=>node('li',text)));
  const future=bank.chapters.slice(chapterIndex+1).map(ch=>ch.title);
  $('chapter-rule').textContent=`Можно использовать материал главы «${bank.chapters[chapterIndex].title}» и предыдущих глав.`+(future.length?' Следующие главы пока не нужны.':' Все темы учебника уже доступны.');
  $('focus').replaceChildren(...v.focus.map(x=>node('span',x,'chip')));
  editor.value=drafts.get(v.id)??initialCode(v); selectionReady=true;
  updateEditor(); renderNav(); renderReport(reports.get(v.id));
}
function field(label,value) { const el=node('div',undefined,'test-field');el.append(node('span',label),node('pre',value));return el; }
function jumpToLine(line) {
  const lines=editor.value.split('\n'), start=lines.slice(0,line-1).reduce((s,x)=>s+x.length+1,0);
  editor.focus();editor.setSelectionRange(start,start+(lines[line-1]?.length??0));editor.scrollTop=Math.max(0,(line-4)*23);updateEditor();
}
function renderReport(report) {
  renderSolution();
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
    detail.append(field('Входные данные',test.input),field('Ожидаемый результат',test.expected));
    if(test.error) renderError(detail,test.error); else detail.append(field('Полученный результат',test.actual??'не определён'));
    if(test.stdout || test.expectedStdout || test.stdoutMismatch) {
      detail.append(field('Ожидаемый вывод print()',test.expectedStdout||'(пусто)'),field('Полученный вывод print()',test.stdout||'(пусто)'));
      if(test.stdoutMismatch)detail.append(node('p','Вывод отличается от ожидаемого. Проверь текст, пробелы и переводы строк.','error-hint'));
    }
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
      finishAttempt(data.report.status);
      reports.set(data.variantId,data.report);if(current()?.id===data.variantId){renderReport(data.report);if(data.report.status==='failed'||data.report.status==='error')playFire();}
      runtime('Python готов','ready');controls();renderNav();
    }
  };
  worker.onerror=()=>{if(epoch===generation)engineFailure('Среда Python остановилась. Нажми «Подключить Python» и попробуй снова.');};
  controls();
}
function engineFailure(message) { finishAttempt('error'); clearTimeout(timer);worker?.terminate();generation++;ready=false;running=false;runtime('Python недоступен','failed');controls();renderReport({status:'error',title:'Не удалось запустить проверку',message}); }
function cancelRun(show=true) {
  finishAttempt('cancelled');
  clearTimeout(timer);running=false;worker?.terminate();generation++;
  if(show)renderReport({status:'error',title:'Проверка остановлена',message:'Код сохранён в редакторе. Можно исправить его и запустить снова.'});
  initWorker();
}
async function runCode() {
  if(!auth||!bank||running||$('practice-screen').hidden)return;
  if(!ready){initWorker();return;}
  stopFire();saveDraft();running=true;controls();
  const v=current(), id=v.id, code=editor.value, token=auth.token;
  const attempt={variantId:id,code,attemptId:crypto.randomUUID(),courseId:config.courseId,token};
  activeAttempt=attempt;
  renderReport({status:'running',title:'Сохраняем отправленный код…'});
  notice('Сохраняем код в таблице…');
  try {
    const response=await api('begin',attempt,token);
    if(auth?.token!==token)return;
    applyEntry(response.entry);
    if(activeAttempt!==attempt)return;
    notice('Код сохранён. Проверяем тесты…');
    runtime('Проверяем тесты');
    renderReport({status:'running',title:'Проверяем решение…',message:`Подставляем входные данные: ${v.tests.length} тестов.`});
    timer=setTimeout(()=>{
      const report={status:'error',title:'Превышено время выполнения',message:'Проверка заняла больше 5 секунд. Проверь завершение циклов, рекурсии и размеры создаваемых объектов.'};
      reports.set(id,report);finishAttempt('error');cancelRun(false);renderReport(report);playFire();
    },5000);
    worker.postMessage({type:'run',variantId:id,chapter:bank.chapters[chapterIndex].number,code,tests:v.tests.map(t=>({...t,display_input_code:visibleInputs(t,v)}))});
  } catch(error) {
    if(activeAttempt!==attempt)return;
    activeAttempt=null;running=false;controls();
    notice('Не удалось подтвердить сохранение кода. Нажми «Проверить решение» ещё раз.');
    renderReport({status:'error',title:'Проверка не началась',message:error.message});
  }
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
$('chapter').addEventListener('change',()=>selectChapter(Number($('chapter').value)));
window.addEventListener('hashchange',route);
window.addEventListener('beforeunload',event=>{if(running||outbox.length||[...drafts].some(([id,code])=>code!==(progress[id]?.code??initialCode(allVariants().find(v=>v.id===id))))){event.preventDefault();event.returnValue='';}});
async function start() {
  try{
    const bundled=document.getElementById('task-data');
    if(bundled)bank=JSON.parse(bundled.textContent);
    else{const response=await fetch('./tasks.json');if(!response.ok)throw Error('tasks');bank=await response.json();}
    $('chapter').replaceChildren(...bank.chapters.map((ch,i)=>{const option=node('option',`${ch.number}. ${ch.title}`);option.value=String(i);return option;}));
    registerTools();await restoreSession();
  }catch(error){$('auth-error').hidden=false;$('auth-error').textContent='Не удалось загрузить тренажёр. Обнови страницу.';}
}
function registerTools(){
  const context=document.modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const definitions=[
    {name:'list_python_exercises',description:'Прочитать все главы, задачи и варианты.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>bank.chapters.map(ch=>({chapter:ch.title,tasks:ch.tasks.map(t=>({title:t.title,variants:t.variants.map(v=>({id:v.id,title:v.title}))}))}))},
    {name:'select_python_exercise',description:'Открыть вариант любой главы. Черновик остаётся в памяти вкладки.',inputSchema:{type:'object',properties:{variantId:{type:'string'}},required:['variantId'],additionalProperties:false},annotations:{readOnlyHint:false},execute:({variantId})=>{if(!auth)throw Error('Сначала войди в профиль');if(selectById(variantId))return {id:current().id,title:current().title};throw Error('Неизвестный вариант');}}
  ];
  for(const definition of definitions){try{Promise.resolve(context.registerTool(definition,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
}
const config=JSON.parse($('config-data').textContent);
const solutions=JSON.parse($('solution-data').textContent);
let auth=null,progress={},activeAttempt=null,outbox=[],flushing=false;
const allVariants=()=>bank.chapters.flatMap(ch=>ch.tasks.flatMap(t=>t.variants));
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function notice(message,retry=false){$('save-notice').hidden=!message;$('save-message').textContent=message;$('retry-save').hidden=!retry;}
async function api(action,payload={},token=auth?.token){
  if(!config.apiUrl)throw Error('Сохранение ещё не подключено.');
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),25000);
  try{
    const response=await fetch(config.apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,action,token}),signal:abort.signal,redirect:'follow'});
    if(!response.ok)throw Error('Сервис сохранения недоступен. Попробуй ещё раз.');
    const result=await response.json();
    if(!result.ok){const e=Error(result.error.message);e.code=result.error.code;throw e;}
    return result.data;
  }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('Нет ответа от таблицы. Проверь интернет и повтори.');throw e;}
  finally{clearTimeout(timeout);}
}
function showScreen(screen){
  for(const name of ['auth','courses','theory','practice'])$(name+'-screen').hidden=name!==screen;
  $('account-name').hidden=$('logout').hidden=!auth;
  $('account-name').textContent=auth?.user.name||'';
  $('runtime').hidden=screen!=='practice';
  if(screen==='practice'&&!worker)initWorker();
  if(screen==='courses')renderCourse();
}
function route(){
  if(!bank)return;
  if(!auth){showScreen('auth');return;}
  const hash=location.hash.slice(1);
  if(hash==='theory'){saveDraft();showScreen('theory');return;}
  if(hash==='courses'||!hash){saveDraft();showScreen('courses');return;}
  if(!selectById(hash))showScreen('courses');
}
function renderCourse(){
  const variants=allVariants(),n=variants.filter(v=>progress[v.id]?.solved).length,m=variants.length;
  $('course-count').textContent=`${n} / ${m}`;$('course-progress').max=m;$('course-progress').value=n;
  $('course-percent').textContent=`${Math.round(n/m*1000)/10}%`;
  const next=variants.find(v=>!progress[v.id]?.solved);
  $('course-next').textContent=next?'Дальше: '+next.title:'Все задания решены. Можно повторить любую тему.';
  $('open-course').textContent=next?(n?'Продолжить курс →':'Начать курс →'):'Повторить курс →';
}
function renderSolution(){const v=current();$('solution-panel').hidden=!v||!progress[v.id]?.solved;$('solution-code').textContent=v?solutions[v.id]||'':'';}
function applyEntry(entry){
  if(!entry)return;
  if((progress[entry.variantId]?.revision||0)>entry.revision)return;
  progress[entry.variantId]=entry;
  renderCourse();if(selectionReady){renderNav();renderSolution();
    tasks[taskIndex].variants.forEach((v,i)=>$('variants').children[i]?.classList.toggle('is-solved',!!progress[v.id]?.solved));}
}
function acceptSession(data,token){
  auth={token:token||data.token,user:data.user};progress=data.progress||{};
  drafts.clear();reports.clear();selectionReady=false;
  Object.values(progress).forEach(e=>{drafts.set(e.variantId,e.code);reports.set(e.variantId,{status:e.status==='passed'?'passed':'error',title:e.solved?'✓ Последнее решение прошло все тесты':'Последнее решение не зачтено',message:'Код загружен из таблицы. Запусти проверку, чтобы увидеть подробности.'});});
  writeLocal('python-session',auth);
  outbox=readLocal('python-pending-'+auth.user.id,[]);
  history.replaceState(null,'','#courses');showScreen('courses');flushOutbox();
}
async function authenticate(action){
  if(!$('auth-form').reportValidity())return;
  $('login').disabled=$('register').disabled=true;$('auth-error').hidden=true;
  try{acceptSession(await api(action,{username:$('username').value},null));}
  catch(e){$('auth-error').textContent=e.message;$('auth-error').hidden=false;}
  finally{$('login').disabled=$('register').disabled=false;}
}
async function restoreSession(){
  const saved=readLocal('python-session',null);
  if(!saved?.token){showScreen('auth');return;}
  $('login').disabled=$('register').disabled=true;
  try{acceptSession(await api('resume',{},saved.token),saved.token);}
  catch(e){showScreen('auth');$('username').value=saved.user?.name||'';$('auth-error').textContent=e.message;$('auth-error').hidden=false;}
  finally{$('login').disabled=$('register').disabled=false;}
}
function finishAttempt(status){
  const attempt=activeAttempt;if(!attempt)return;activeAttempt=null;
  if(auth?.token!==attempt.token)return;
  const entry=progress[attempt.variantId];
  if(entry?.attemptId===attempt.attemptId)applyEntry({...entry,solved:status==='passed',status});
  outbox.push({variantId:attempt.variantId,attemptId:attempt.attemptId,courseId:config.courseId,status});
  writeLocal('python-pending-'+auth.user.id,outbox);flushOutbox();
}
async function flushOutbox(){
  if(flushing||!auth||!outbox.length)return;
  flushing=true;const token=auth.token,userId=auth.user.id;
  try{
    notice('Сохраняем результат в таблице…');
    while(outbox.length&&auth?.token===token){
      const item=outbox[0],response=await api('finish',item,token);
      if(auth?.token!==token)return;
      applyEntry(response.entry);outbox.shift();writeLocal('python-pending-'+userId,outbox);
    }
    if(auth?.token===token)notice('Код и результат сохранены в таблице.');
  }catch(e){if(auth?.token===token)notice('Результат пока не сохранён в таблице. '+e.message,true);}
  finally{flushing=false;}
}
$('auth-form').addEventListener('submit',e=>{e.preventDefault();authenticate('login');});
$('register').addEventListener('click',()=>authenticate('register'));
$('retry-save').addEventListener('click',flushOutbox);
window.addEventListener('online',flushOutbox);
$('open-course').addEventListener('click',()=>{const v=allVariants().find(v=>!progress[v.id]?.solved)||allVariants()[0];selectById(v.id);});
$('logout').addEventListener('click',async()=>{
  if(running)cancelRun(false);
  await flushOutbox();
  if(outbox.length){notice('Перед выходом сохрани результат кнопкой «Повторить сохранение».',true);return;}
  const token=auth?.token;auth=null;progress={};drafts.clear();reports.clear();selectionReady=false;
  worker?.terminate();worker=null;generation++;clearTimeout(timer);ready=false;running=false;
  writeLocal('python-session',null);notice('');history.replaceState(null,'','#courses');showScreen('auth');
  if(token)api('logout',{},token).catch(()=>{});
});
start();
