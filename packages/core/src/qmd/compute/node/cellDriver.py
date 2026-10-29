# Runs one code cell: exec()s every statement but the last, eval()s the last if it is an expression,
# and prints one JSON line: {latex, text} on success or {error} with the last traceback line.
import ast, json, os, sys, traceback

def emit(payload):
    sys.stdout.write("\n" + json.dumps(payload) + "\n")

try:
    sys.path.insert(0, os.getcwd())
    with open(sys.argv[1], encoding="utf-8") as handle:
        tree = ast.parse(handle.read(), "<cell>")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    scope = {"__name__": "__main__"}
    exec(compile(tree, "<cell>", "exec"), scope)
    if last is None:
        emit({})
    else:
        value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), scope)
        if value is None:
            emit({})
        elif type(value).__module__.split(".")[0] == "sympy" or hasattr(value, "_sympy_"):
            import sympy
            emit({"latex": sympy.latex(value)})
        else:
            emit({"text": str(value)})
except BaseException:
    emit({"error": traceback.format_exc().strip().splitlines()[-1]})
