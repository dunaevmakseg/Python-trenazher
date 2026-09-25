import ast
import builtins
import contextlib
import io
import json
import traceback

# Each test receives fresh inputs and a separate learner namespace.
# No server execution, imports, JS bridge, filesystem, or dynamic evaluation.
_SAFE_NAMES = ('abs','all','any','ascii','bin','bool','bytes','chr','divmod','float',
               'format','hex','int','len','list','max','min','oct','ord','pow','print',
               'repr','round','sorted','str','sum')
_SAFE_BUILTINS = {name:getattr(builtins,name) for name in _SAFE_NAMES}
_BLOCKED = (ast.Import,ast.ImportFrom,ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef,
            ast.Lambda,ast.For,ast.AsyncFor,ast.While,ast.If,ast.IfExp,ast.Match,
            ast.ListComp,ast.SetComp,ast.DictComp,ast.GeneratorExp,ast.Dict,ast.Set,
            ast.Try,ast.TryStar,ast.Raise,ast.Assert,ast.With,ast.AsyncWith,
            ast.Yield,ast.YieldFrom,ast.Await,ast.Global,ast.Nonlocal,ast.NamedExpr,
            ast.BoolOp)
_HINTS = {
    'SyntaxError':'Проверь скобки, кавычки и запись выражения на указанной строке.',
    'IndentationError':'Проверь отступы. В этой главе обычные команды начинаются с начала строки.',
    'NameError':'Проверь написание имени переменной. Входные переменные перечислены в условии.',
    'TypeError':'Проверь типы значений и аргументы операции: строка, число и список ведут себя по-разному.',
    'IndexError':'Такой позиции в списке или строке нет. Индексы начинаются с нуля.',
    'ValueError':'Значение не подходит операции. Например, remove() и index() требуют существующий элемент.',
    'AttributeError':'Проверь название метода и тип объекта, к которому он применяется.',
    'ZeroDivisionError':'В этом тесте делитель равен нулю.',
    'MemoryError':'Программа создаёт слишком большой объект. Проверь умножение строк и списков.',
}

def _error(exc):
    line=getattr(exc,'lineno',None)
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename=='solution.py': line=frame.lineno
    return {'type':type(exc).__name__, 'message':str(exc).split(' (solution.py,')[0],
            'line':line,'column':getattr(exc,'offset',None),'hint':_HINTS.get(type(exc).__name__,'')}

def _equal(left,right):
    if type(left) is not type(right): return False
    if isinstance(left,(list,tuple)):
        return len(left)==len(right) and all(_equal(a,b) for a,b in zip(left,right))
    if isinstance(left,dict):
        return left.keys()==right.keys() and all(_equal(left[k],right[k]) for k in left)
    return left==right

class _Output(io.StringIO):
    def write(self,text):
        if self.tell()+len(text)>8000: raise ValueError('Вывод программы превышает 8000 символов. Убери отладочную печать.')
        return super().write(text)

def _grade(payload):
    source=payload['code']
    try:
        tree=ast.parse(source,filename='solution.py')
        for item in ast.walk(tree):
            restricted=isinstance(item,_BLOCKED)
            restricted |= isinstance(item,ast.Tuple) and isinstance(item.ctx,ast.Load)
            restricted |= isinstance(item,ast.Attribute) and item.attr.startswith('_')
            restricted |= isinstance(item,ast.Name) and item.id.startswith('__')
            if restricted:
                return {'status':'error','title':'Эта конструкция пока вне главы',
                        'error':{'type':'Материал следующих глав','message':'Реши задачу операциями со строками и списками.',
                                 'line':getattr(item,'lineno',None),'hint':'Условия, циклы, словари, множества, кортежи и определения функций ещё не нужны.'}}
        code=compile(tree,'solution.py','exec')
    except (SyntaxError,ValueError) as exc:
        return {'status':'error','title':'Не удалось прочитать код','error':_error(exc)}
    results=[]
    for test in payload['tests']:
        namespace={'__builtins__':_SAFE_BUILTINS.copy()}
        exec(test['setup_code'],namespace)
        output=_Output()
        record={'purpose':test['purpose'],'input':test['setup_code'],'expected':test['expected_python']}
        try:
            with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
                exec(code,namespace)
            if 'result' not in namespace:
                record.update(status='error',error={'type':'Нет результата','message':'Переменная result не определена.','hint':'Присвой ответ переменной result; печатать его не нужно.'})
            else:
                actual=namespace['result']; expected=ast.literal_eval(test['expected_python'])
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
