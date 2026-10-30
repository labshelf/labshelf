# Persistent cell driver: reads one JSON request per stdin line and keeps one namespace for the life of the process.
# Each response is a line "\u0001LABSHELF\u0001" + JSON {id, text|latex|error}; anything the cell prints goes to stdout before it.
import ast, base64, contextlib, io, json, os, sys, traceback

# PLATFORM: cells run headlessly in the helper, including when the user calls pyplot.show().
os.environ.setdefault("MPLBACKEND", "Agg")

SENTINEL = "\u0001LABSHELF\u0001"

def emit(request_id, payload, printed=""):
    # The printed text ends its line first so the sentinel always starts one.
    if printed:
        sys.stdout.write(printed if printed.endswith("\n") else printed + "\n")
    sys.stdout.write(SENTINEL + json.dumps({"id": request_id, **payload}) + "\n")
    sys.stdout.flush()

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
    # The PNG stays theme-neutral: dark ink on a transparent background, which dark themes invert when they show it.
    for axes in figure.get_axes():
        axes.patch.set_facecolor("none")
    legends = list(figure.legends) + [axes.get_legend() for axes in figure.get_axes() if axes.get_legend() is not None]
    for legend in legends:
        frame = legend.get_frame()
        frame.set_alpha(None)
        frame.set_facecolor((1, 1, 1, 0.5))
    buffer = io.BytesIO()
    figure.savefig(buffer, format="png", dpi=160, transparent=True, facecolor="none", edgecolor="none", bbox_inches="tight", pad_inches=0.05)
    pyplot.close(figure)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

def close_figures():
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is not None:
        pyplot.close("all")

def run_cell(code, scope):
    tree = ast.parse(code, "<cell>")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    exec(compile(tree, "<cell>", "exec"), scope)
    value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), scope) if last else None
    image = figure_result(value)
    if image:
        return {"text": image}
    close_figures()
    if value is None:
        return {}
    if type(value).__module__.split(".")[0] == "sympy" or hasattr(value, "_sympy_"):
        import sympy
        return {"latex": sympy.latex(value)}
    return {"text": str(value)}

def main():
    sys.path.insert(0, os.getcwd())
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    scope = {"__name__": "__main__"}
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            request_id, code = request["id"], request["code"]
        except (ValueError, KeyError, TypeError):
            continue
        captured = io.StringIO()
        try:
            with contextlib.redirect_stdout(captured):
                payload = run_cell(code, scope)
        except BaseException:
            close_figures()
            payload = {"error": traceback.format_exc().strip().splitlines()[-1]}
        emit(request_id, payload, captured.getvalue())

main()
