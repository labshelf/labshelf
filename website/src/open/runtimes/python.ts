// A Python cell session in the browser: Pyodide from the jsDelivr CDN in a module worker of its own, so a cancel can terminate it.
import type { CellRequest } from "@labshelf/core";

import type { RuntimeAnswer } from "./cellResult.js";
import type { CellSession } from "./cells.js";

// INVARIANT: the Pyodide release every /open/ page loads; its lock file ships numpy, sympy and matplotlib.
const PYODIDE_VERSION = "314.0.7";

const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// The desktop driver's reading of a cell (cellDriver.py), reduced: the last expression is the value, a matplotlib figure becomes a PNG, a SymPy value LaTeX.
const PYTHON_DRIVER = String.raw`
import ast, base64, io, json, os, re, sys, traceback, warnings
os.environ.setdefault("MPLBACKEND", "Agg")
_labshelf_scope = {"__name__": "__main__"}
_PARAM_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]*")

def _labshelf_close():
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is not None:
        pyplot.close("all")

def _labshelf_figure(value):
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return None
    plotting = ("matplotlib", "mpl_toolkits")
    module = type(value).__module__.split(".")[0]
    artists = isinstance(value, (list, tuple)) and value and all(type(item).__module__.split(".")[0] in plotting for item in value)
    if value is not None and module not in plotting and not artists:
        return None
    numbers = pyplot.get_fignums()
    figure = value if hasattr(value, "savefig") else pyplot.figure(numbers[-1]) if numbers else None
    if figure is None:
        return None
    for axes in figure.get_axes():
        axes.patch.set_facecolor("none")
    buffer = io.BytesIO()
    # Pyodide's matplotlib warns about its own float pixel sizes on every save; those are not the cell's warnings.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        figure.savefig(buffer, format="png", dpi=160, transparent=True, facecolor="none", edgecolor="none", bbox_inches="tight", pad_inches=0.05)
    pyplot.close("all")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

def _labshelf_value(code):
    tree = ast.parse(code, "<cell>")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    exec(compile(tree, "<cell>", "exec"), _labshelf_scope)
    value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), _labshelf_scope) if last else None
    image = _labshelf_figure(value)
    if image:
        return {"text": image}
    _labshelf_close()
    if value is None:
        return {}
    if type(value).__module__.split(".")[0] == "sympy" or hasattr(value, "_sympy_"):
        import sympy
        return {"latex": sympy.latex(value)}
    return {"text": str(value)}

def labshelf_run(code, params_json):
    params = json.loads(params_json)
    for name in params:
        if not _PARAM_NAME.fullmatch(name) or name.startswith("__"):
            return json.dumps({"error": "Invalid parameter name " + name})
    _labshelf_scope.update(params)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            payload = _labshelf_value(code)
        except BaseException:
            _labshelf_close()
            payload = {"error": traceback.format_exc().strip().splitlines()[-1]}
    if caught:
        payload["warnings"] = [f"{w.category.__name__}: {' '.join(str(w.message).split())} (line {w.lineno})" for w in caught]
    return json.dumps(payload)
`;

// The worker loads Pyodide once, then answers one {id, code, params} message at a time with {id, answer} or {id, failure}.
const WORKER_SOURCE = `
const INDEX_URL = ${JSON.stringify(PYODIDE_INDEX_URL)};
const DRIVER = ${JSON.stringify(PYTHON_DRIVER)};
let printed = [];
const ready = (async () => {
  const { loadPyodide } = await import(INDEX_URL + "pyodide.mjs");
  const pyodide = await loadPyodide({ indexURL: INDEX_URL });
  pyodide.setStdout({ batched: (line) => printed.push(line) });
  pyodide.setStderr({ batched: (line) => printed.push(line) });
  pyodide.runPython(DRIVER);
  return pyodide;
})();
self.onmessage = async ({ data }) => {
  let pyodide;
  try { pyodide = await ready; }
  catch (error) { postMessage({ id: data.id, failure: "Python could not load in your browser: " + (error && error.message ? error.message : String(error)) }); return; }
  printed = [];
  try {
    await pyodide.loadPackagesFromImports(data.code, { messageCallback: () => {}, errorCallback: () => {} });
  } catch {}
  try {
    const answer = JSON.parse(pyodide.globals.get("labshelf_run")(data.code, JSON.stringify(data.params || {})));
    postMessage({ id: data.id, answer: { ...answer, printed: printed.join("\\n") } });
  } catch (error) {
    postMessage({ id: data.id, failure: error && error.message ? error.message : String(error) });
  }
};
`;

interface WorkerReply { id: number; answer?: RuntimeAnswer; failure?: string }

/** @returns a Python session whose worker starts on the first run; dispose terminates it, mid-run included. */
export function createPythonSession(): CellSession {
  let worker: Worker | undefined;
  let nextId = 0;
  const waiting = new Map<number, { resolve: (answer: RuntimeAnswer) => void; reject: (error: Error) => void }>();

  function failAll(error: Error): void {
    for (const pending of waiting.values()) { pending.reject(error); }
    waiting.clear();
  }

  function start(): Worker {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const started = new Worker(url, { type: "module", name: "labshelf-python" });
    URL.revokeObjectURL(url);
    started.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      const pending = waiting.get(data.id);
      if (!pending) { return; }
      waiting.delete(data.id);
      if (data.answer) { pending.resolve(data.answer); } else { pending.reject(new Error(data.failure ?? "Python stopped without an answer.")); }
    };
    started.onerror = (event) => { event.preventDefault(); failAll(new Error(`Python stopped: ${event.message || "the worker failed"}`)); };
    return started;
  }

  return {
    run(request: CellRequest) {
      worker ??= start();
      const id = nextId++;
      const answer = new Promise<RuntimeAnswer>((resolve, reject) => { waiting.set(id, { resolve, reject }); });
      worker.postMessage({ id, code: request.code, params: request.params ?? {} });
      return answer;
    },
    dispose() {
      worker?.terminate();
      worker = undefined;
      failAll(new Error("Python was stopped."));
    },
  };
}
