import ast
import builtins
import contextlib
import io
import json
import traceback

# Learner code runs only in a disposable browser Worker. This allowlist limits
# course operations; it is not a security boundary for executing code on a server.
_SAFE_NAMES = ('abs','all','any','ascii','bin','bool','bytes','chr','divmod','float',
    'format','hex','int','len','list','max','min','oct','ord','pow','print','repr',
    'round','sorted','str','sum','range','enumerate','zip','iter','next','reversed',
    'dict','set','tuple','frozenset','object','isinstance','type','callable','map',
    'filter','Exception','ValueError','TypeError','KeyError','IndexError',
    'StopIteration','AssertionError','RuntimeError','ZeroDivisionError')
_ALLOWED_MODULES = {'math','copy','unicodedata','functools'}
def _course_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name not in _ALLOWED_MODULES:
        raise ImportError('В этой главе доступны math, copy, unicodedata и functools.')
    return builtins.__import__(name, globals, locals, fromlist, level)
_SAFE_BUILTINS = {name:getattr(builtins,name) for name in _SAFE_NAMES}
_SAFE_BUILTINS['__import__'] = _course_import
_HINTS = {
    'SyntaxError':'Проверь скобки, кавычки, двоеточия и запись выражения.',
    'IndentationError':'Проверь отступы внутри условий, циклов и функций.',
    'NameError':'Проверь имя переменной или функции. Нужные имена указаны в условии.',
    'TypeError':'Проверь типы значений, параметры функции и способ её вызова.',
    'IndexError':'Такой позиции нет. Индексы начинаются с нуля.',
    'KeyError':'Такого ключа нет в словаре. Проверь ключ или используй get, если это соответствует условию.',
    'ValueError':'Значение не подходит операции. Проверь ограничения условия и граничные случаи.',
    'AttributeError':'Проверь название метода и тип объекта.',
    'ZeroDivisionError':'В этом тесте делитель равен нулю.',
    'StopIteration':'Источник закончился. Проверь количество вызовов input/next и условие остановки.',
    'RecursionError':'Рекурсия не заканчивается или слишком глубока. Проверь базовый случай.',
    'MemoryError':'Программа создаёт слишком большой объект.',
}
def _error(exc):
    line=getattr(exc,'lineno',None)
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename=='solution.py': line=frame.lineno
    return {'type':type(exc).__name__, 'message':str(exc).split(' (solution.py,')[0],
        'line':line,'column':getattr(exc,'offset',None),'hint':_HINTS.get(type(exc).__name__,'')}

def _restriction(tree, chapter):
    always=(ast.AsyncFunctionDef,ast.ClassDef,ast.AsyncFor,ast.With,ast.AsyncWith,
            ast.Await,ast.NamedExpr)
    blocked=list(always)
    if chapter<2: blocked += [ast.If,ast.IfExp,ast.BoolOp,ast.Match]
    if chapter<3: blocked += [ast.While]
    if chapter<4: blocked += [ast.For,ast.ListComp,ast.GeneratorExp]
    if chapter<5: blocked += [ast.Dict,ast.Set,ast.DictComp,ast.SetComp]
    if chapter<6: blocked += [ast.FunctionDef,ast.Lambda,ast.Import,ast.ImportFrom,
        ast.Try,ast.Raise,ast.Assert,ast.Yield,ast.YieldFrom,ast.Global,ast.Nonlocal]
    if hasattr(ast,'TryStar'): blocked.append(ast.TryStar)
    for item in ast.walk(tree):
        message=None
        if isinstance(item,tuple(blocked)) or (chapter<5 and isinstance(item,ast.Tuple) and isinstance(item.ctx,ast.Load)):
            message='Эта конструкция ещё не входит в текущую главу учебника.'
        if isinstance(item,ast.Attribute) and item.attr.startswith('_') and not (chapter>=6 and item.attr in {'__name__','__doc__','__annotations__'}):
            message='Служебные атрибуты объектов для этих задач не нужны.'
        if isinstance(item,ast.Name) and item.id.startswith('__') and not (chapter>=6 and item.id=='__name__'):
            message='Это служебное имя недоступно в тренажёре.'
        if isinstance(item,(ast.Import,ast.ImportFrom)) and chapter>=6:
            names=[a.name for a in item.names] if isinstance(item,ast.Import) else [item.module]
            if any(name not in _ALLOWED_MODULES for name in names) or getattr(item,'level',0):
                message='Доступны модули учебника: math, copy, unicodedata и functools.'
            if isinstance(item,ast.ImportFrom) and any(a.name.startswith('_') for a in item.names):
                message='Служебные имена модулей недоступны в тренажёре.'
        if message:
            return {'status':'error','title':'Проверь используемые конструкции',
                'error':{'type':'Ограничение главы','message':message,'line':getattr(item,'lineno',None),
                    'hint':'Используй материал выбранной главы и предыдущих глав.'}}
    return None

def _equal(left,right):
    if type(left) is not type(right): return False
    if isinstance(left,(list,tuple)):
        return len(left)==len(right) and all(_equal(a,b) for a,b in zip(left,right))
    if isinstance(left,dict):
        return left.keys()==right.keys() and all(_equal(left[k],right[k]) for k in left)
    return left==right

class _Output(io.StringIO):
    def write(self,text):
        if self.tell()+len(text)>8000: raise ValueError('Вывод программы превышает 8000 символов. Проверь цикл и отладочную печать.')
        return super().write(text)

def _grade(payload):
    try:
        tree=ast.parse(payload['code'],filename='solution.py')
        restriction=_restriction(tree,int(payload.get('chapter',1)))
        if restriction: return restriction
        code=compile(tree,'solution.py','exec')
    except (SyntaxError,ValueError) as exc:
        return {'status':'error','title':'Не удалось прочитать код','error':_error(exc)}
    results=[]
    for test in payload['tests']:
        # Setup/probe are trusted course fixtures. Functions defined by the learner
        # retain the restricted builtins that were active when they were created.
        namespace={'__builtins__':builtins.__dict__.copy(),'__name__':'analytics'}
        exec(compile(test['setup_code'],'test_setup.py','exec'),namespace)
        namespace['__builtins__']=_SAFE_BUILTINS.copy()
        output=_Output()
        record={'purpose':test['purpose'],'input':test.get('display_input_code',test['setup_code']),
            'expected':test['expected_python'],'expectedStdout':test['expected_stdout']}
        try:
            with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
                exec(code,namespace)
                namespace['__builtins__']=builtins.__dict__.copy()
                exec(compile(test.get('probe_code','actual = result'),'test_probe.py','exec'),namespace)
            actual=namespace['actual']; expected=ast.literal_eval(test['expected_python'])
            stdout=output.getvalue().replace('\r\n','\n')
            stdout_mismatch=stdout!=test['expected_stdout'].replace('\r\n','\n')
            passed=_equal(actual,expected) and not stdout_mismatch
            representation=repr(actual)
            if len(representation)>8000: representation=representation[:8000]+'… (результат сокращён)'
            record.update(status='passed' if passed else 'failed',actual=representation,stdoutMismatch=stdout_mismatch)
        except BaseException as exc:
            record.update(status='error',error=_error(exc))
        record['stdout']=output.getvalue()
        results.append(record)
    return {'status':'passed' if all(r['status']=='passed' for r in results) else 'failed','tests':results}

def _grade_json(request_json):
    return json.dumps(_grade(json.loads(request_json)),ensure_ascii=False)
