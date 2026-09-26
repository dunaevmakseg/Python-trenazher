const SHEET_ID = '1neTmFrGhmIqkiv8g1EBdvpQmENe8-RDDB8ei6NtwpMs';
const COURSE_ID = 'python-basics';
const SCHEMA = {
  'Пользователи': ['user_id','username','username_key','created_at','last_seen'],
  'Задания': ['exercise_id','parent_id','course_id','chapter','title','kind'],
  'Прогресс': ['user_id','username','course_id','variant_id','solved','last_code','last_status','updated_at','attempt_id','revision']
};
const CODE_PREFIX = '\u200B';
const MAX_CODE = 20000;
// The app intentionally signs in by nickname only, as requested for friends.
function doGet() { return json_({ok:true, service:'python-practice', version:1}); }
function doPost(e) {
  try {
    const text = e && e.postData ? e.postData.contents : '';
    if (text.length > 100000) fail_('TOO_LARGE','Запрос слишком большой.');
    return json_({ok:true, data:dispatch_(JSON.parse(text || '{}'))});
  } catch (error) {
    return json_({ok:false, error:{code:error.code || 'SERVER_ERROR', message:error.code ? error.message : 'Не удалось обратиться к таблице. Попробуй ещё раз.'}});
  }
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code,message) { const e=new Error(message); e.code=code; throw e; }
function dispatch_(p) {
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_('BUSY','Таблица занята. Повтори запрос через несколько секунд.');
  try {
    const db=SpreadsheetApp.openById(SHEET_ID);
    ensure_(db);
    if (p.action==='register' || p.action==='login') return auth_(db,p);
    const user=session_(db,p.token);
    if (p.action==='resume') return state_(db,user);
    if (p.action==='logout') { PropertiesService.getScriptProperties().deleteProperty(sessionKey_(p.token)); return {}; }
    if (p.action==='begin' || p.action==='finish') return attempt_(db,user,p);
    fail_('BAD_ACTION','Неизвестное действие.');
  } finally { lock.releaseLock(); }
}
function ensure_(db) {
  Object.keys(SCHEMA).forEach(name=>{
    let sheet=db.getSheetByName(name);
    if (!sheet) sheet=db.insertSheet(name);
    const headers=SCHEMA[name];
    if (sheet.getLastRow()===0) {
      sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#eeeeee');
      sheet.setFrozenRows(1);
      sheet.setColumnWidths(1,headers.length,180);
      if (name==='Прогресс') sheet.setColumnWidth(6,420);
    } else if (JSON.stringify(sheet.getRange(1,1,1,headers.length).getValues()[0])!==JSON.stringify(headers)) {
      fail_('SCHEMA','Структура листа '+name+' изменена. Проверь заголовки.');
    }
  });
}
function rows_(sheet,width) { return sheet.getLastRow()<2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues(); }
function auth_(db,p) {
  const name=String(p.username || '').normalize('NFKC').trim().replace(/\s+/g,' ');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_. -]{0,39}$/u.test(name)) fail_('NAME','Имя: от 1 до 40 букв, цифр, пробелов или символов _ . -');
  const key=name.toLocaleLowerCase('ru');
  const sheet=db.getSheetByName('Пользователи');
  const rows=rows_(sheet,5);
  let index=rows.findIndex(row=>row[2]===key);
  const now=new Date().toISOString();
  if (p.action==='register') {
    if (index!==-1) fail_('EXISTS','Это имя уже занято. Если это твой профиль — нажми «Войти».');
    const row=[Utilities.getUuid(),name,key,now,now];
    sheet.appendRow(row); rows.push(row); index=rows.length-1;
  } else if (index===-1) fail_('NOT_FOUND','Пользователь не найден. Проверь имя или зарегистрируйся.');
  sheet.getRange(index+2,5).setValue(now);
  const user={id:rows[index][0],name:rows[index][1]};
  const token=Utilities.getUuid()+Utilities.getUuid();
  const properties=PropertiesService.getScriptProperties();
  properties.setProperty(sessionKey_(token),JSON.stringify({userId:user.id,expires:Date.now()+30*86400000}));
  const all=properties.getProperties();
  Object.keys(all).filter(k=>k.startsWith('session:')).forEach(k=>{try { if(JSON.parse(all[k]).expires<Date.now())properties.deleteProperty(k); }catch(e){properties.deleteProperty(k);} });
  return Object.assign(state_(db,user),{token});
}
function sessionKey_(token) {
  if (typeof token!=='string' || token.length<30 || token.length>200) fail_('SESSION','Войди в профиль ещё раз.');
  return 'session:'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,token));
}
function session_(db,token) {
  const raw=PropertiesService.getScriptProperties().getProperty(sessionKey_(token));
  if (!raw) fail_('SESSION','Сессия закончилась. Войди ещё раз.');
  const data=JSON.parse(raw);
  if (data.expires<Date.now()) fail_('SESSION','Сессия закончилась. Войди ещё раз.');
  const row=rows_(db.getSheetByName('Пользователи'),5).find(r=>r[0]===data.userId);
  if (!row) fail_('SESSION','Профиль не найден.');
  return {id:row[0],name:row[1]};
}
function entry_(row) {
  const stored=String(row[5] || '');
  return {variantId:row[3],solved:row[4]==='решена',code:stored.startsWith(CODE_PREFIX)?stored.slice(1):stored,status:row[6],updatedAt:row[7],attemptId:row[8],revision:Number(row[9])||0};
}
function state_(db,user) {
  const progress={};
  rows_(db.getSheetByName('Прогресс'),10).filter(r=>r[0]===user.id && r[2]===COURSE_ID).forEach(row=>progress[row[3]]=entry_(row));
  return {user,courseId:COURSE_ID,progress};
}
function attempt_(db,user,p) {
  if (p.courseId!==COURSE_ID || !VARIANT_IDS.includes(p.variantId)) fail_('VARIANT','Неизвестное задание.');
  if (typeof p.attemptId!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(p.attemptId)) fail_('ATTEMPT','Некорректный номер попытки.');
  const sheet=db.getSheetByName('Прогресс');
  const rows=rows_(sheet,10);
  let index=rows.findIndex(r=>r[0]===user.id && r[2]===COURSE_ID && r[3]===p.variantId);
  let row=index<0 ? [user.id,user.name,COURSE_ID,p.variantId,'не решена',CODE_PREFIX,'','', '',0] : rows[index].slice();
  if (p.action==='begin') {
    if (typeof p.code!=='string' || p.code.length>MAX_CODE) fail_('CODE','Код должен быть не длиннее 20 000 символов.');
    if (row[8]===p.attemptId) return {entry:entry_(row)};
    row[5]=CODE_PREFIX+p.code; // Prefix keeps even =... code as literal text, never a formula.
    row[4]='не решена'; row[6]='checking'; row[8]=p.attemptId;
  } else {
    if (index<0) fail_('ATTEMPT','Сначала отправь код на проверку.');
    if (!['passed','failed','error','cancelled'].includes(p.status)) fail_('STATUS','Неизвестный результат проверки.');
    // A delayed result from another tab must never change the latest submission.
    if (row[8]!==p.attemptId) return {entry:entry_(row)};
    row[4]=p.status==='passed'?'решена':'не решена'; row[6]=p.status;
  }
  row[7]=new Date().toISOString(); row[9]=(Number(row[9])||0)+1;
  sheet.getRange(index<0?sheet.getLastRow()+1:index+2,1,1,10).setValues([row]);
  SpreadsheetApp.flush();
  return {entry:entry_(row)};
}

const VARIANT_COUNTS = [[4, 2, 4, 4, 4, 4, 6, 4, 2, 3, 4, 4, 1, 1, 1], [1, 1, 3, 2, 2, 3, 1, 1, 1, 1, 1, 1], [1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1], [1, 2, 1, 2, 2, 1, 1, 2, 1, 3, 1, 1, 1], [1, 2, 2, 3, 1, 3, 3, 3, 4, 3, 4, 1, 1, 1], [3, 2, 2, 2, 3, 3, 2, 3, 4, 1, 2, 2, 1, 1, 1]];
const VARIANT_IDS=VARIANT_COUNTS.flatMap((tasks,ci)=>tasks.flatMap((n,ti)=>Array.from({length:n},(_,vi)=>`ch${String(ci+1).padStart(2,"0")}-t${String(ti+1).padStart(2,"0")}-v${String(vi+1).padStart(2,"0")}`)));
