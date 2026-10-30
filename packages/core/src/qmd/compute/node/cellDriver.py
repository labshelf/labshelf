# Runs a code cell and emits its last value as text, LaTeX or an embedded PNG for Matplotlib figures.
import ast, base64, io, json, os, sys, traceback

# PLATFORM: cells run headlessly in the helper, including when the user calls pyplot.show().
os.environ.setdefault("MPLBACKEND", "Agg")

def emit(payload):
    sys.stdout.write("\n" + json.dumps(payload) + "\n")

def figure_result(value):
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return None
    module = type(value).__module__.split(".")[0]
    artists = isinstance(value, (list, tuple)) and value and all(type(item).__module__.split(".")[0] == "matplotlib" for item in value)
    if value is not None and module != "matplotlib" and not artists:
        return None
    numbers = pyplot.get_fignums()
    figure = value if hasattr(value, "savefig") else pyplot.figure(numbers[-1]) if numbers else None
    if figure is None:
        return None
    buffer = io.BytesIO()
    figure.savefig(buffer, format="png", dpi=160)
    pyplot.close(figure)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

try:
    sys.path.insert(0, os.getcwd())
    with open(sys.argv[1], encoding="utf-8") as handle:
        tree = ast.parse(handle.read(), "<cell>")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    scope = {"__name__": "__main__"}
    exec(compile(tree, "<cell>", "exec"), scope)
    value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), scope) if last else None
    image = figure_result(value)
    if image:
        emit({"text": image})
    elif value is None:
        emit({})
    elif type(value).__module__.split(".")[0] == "sympy" or hasattr(value, "_sympy_"):
        import sympy
        emit({"latex": sympy.latex(value)})
    else:
        emit({"text": str(value)})
except BaseException:
    emit({"error": traceback.format_exc().strip().splitlines()[-1]})
