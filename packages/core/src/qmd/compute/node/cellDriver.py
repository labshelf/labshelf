# Persistent cell driver: reads one JSON request per stdin line and keeps one namespace for the life of the process.
# Each response is a line "\u0001LABSHELF\u0001" + JSON {id, text|latex|error, plot?, warnings?}; anything the cell prints goes to stdout before it.
# plot is a labshelf-plot v1 spec as a JSON string, sent beside the PNG when the figure is one Axes of lines, scatters and 3D surfaces.
import ast, base64, contextlib, io, json, os, re, sys, traceback, warnings

# PLATFORM: cells run headlessly in the helper, including when the user calls pyplot.show().
os.environ.setdefault("MPLBACKEND", "Agg")

SENTINEL = "\u0001LABSHELF\u0001"

def emit(request_id, payload, printed=""):
    # The printed text ends its line first so the sentinel always starts one.
    if printed:
        sys.stdout.write(printed if printed.endswith("\n") else printed + "\n")
    sys.stdout.write(SENTINEL + json.dumps({"id": request_id, **payload}) + "\n")
    sys.stdout.flush()

MESH_TRIANGLES = 20000

def round4(v):
    r = float(f"{v:.4g}")
    return 0.0 if r == 0 else r

def plot_values(values):
    import numpy
    out = []
    for v in numpy.ma.filled(numpy.ma.asarray(values, dtype=float), numpy.nan).ravel().tolist():
        out.append(round4(v) if numpy.isfinite(v) else None)
    return out

def visible(artist):
    return artist.get_visible()

def artist_name(artist, trace):
    label = artist.get_label()
    if isinstance(label, str) and label and not label.startswith("_"):
        trace["name"] = label
    return trace

def single_color(colors):
    import numpy
    from matplotlib.colors import to_hex
    colors = numpy.asarray(colors, dtype=float)
    if colors.ndim != 2 or len(colors) == 0 or not (colors == colors[0]).all():
        return None
    return to_hex(colors[0])

def line_trace(line, dim):
    from matplotlib.colors import to_hex
    if dim == 3:
        xs, ys, zs = line.get_data_3d()
        trace = {"x": plot_values(xs), "y": plot_values(ys), "z": plot_values(zs)}
    else:
        trace = {"x": plot_values(line.get_xdata()), "y": plot_values(line.get_ydata())}
    no_line = line.get_linestyle() in ("None", "none", "", " ")
    marker = line.get_marker()
    has_marker = marker not in (None, "None", "none", "", " ")
    trace = {"type": "points" if no_line and has_marker else "line", **trace}
    trace["color"] = to_hex(line.get_color())
    return artist_name(line, trace)

def scatter_trace(collection, dim):
    import numpy
    if dim == 3:
        xs, ys, zs = collection._offsets3d
        trace = {"type": "points", "x": plot_values(xs), "y": plot_values(ys), "z": plot_values(zs)}
    else:
        offsets = numpy.ma.asarray(collection.get_offsets())
        trace = {"type": "points", "x": plot_values(offsets[:, 0]), "y": plot_values(offsets[:, 1])}
    color = single_color(collection.get_facecolor()) if collection.get_array() is None else None
    if color:
        trace["color"] = color
    return artist_name(collection, trace)

def mesh_polygons(collection):
    # The stored 3D polygons: _faces (padded, with an invalid-vertex mask) on current matplotlib, _vec/_segslices before it.
    import numpy
    if hasattr(collection, "_faces"):
        faces = numpy.asarray(collection._faces, dtype=float)
        invalid = numpy.broadcast_to(numpy.asarray(collection._invalid_vertices, dtype=bool), faces.shape[:2])
        return [face[~mask] for face, mask in zip(faces, invalid)]
    if hasattr(collection, "_vec") and hasattr(collection, "_segslices"):
        vec = numpy.asarray(collection._vec, dtype=float)
        return [vec[:3, part].T for part in collection._segslices]
    raise ValueError("no stored 3D vertices")

def mesh_trace(collection):
    import numpy
    index, vertices, faces = {}, [], []
    for polygon in mesh_polygons(collection):
        if len(polygon) < 3 or not numpy.isfinite(polygon).all():
            continue
        corners = []
        for point in polygon.tolist():
            key = tuple(point)
            if key not in index:
                index[key] = len(vertices)
                vertices.append([round4(v) for v in key])
            corners.append(index[key])
        for i in range(1, len(corners) - 1):
            faces.append([corners[0], corners[i], corners[i + 1]])
        if len(faces) > MESH_TRIANGLES:
            raise ValueError("too many triangles")
    trace = {"type": "mesh", "vertices": vertices, "faces": faces}
    color = single_color(collection.get_facecolor()) if collection.get_array() is None else None
    if color:
        trace["color"] = color
    return artist_name(collection, trace)

def plot_axis(axes, letter):
    axis = {}
    label = getattr(axes, "get_" + letter + "label")()
    if label:
        axis["label"] = label
    if getattr(axes, "get_" + letter + "scale")() == "log":
        axis["log"] = True
    if not getattr(axes, "get_autoscale" + letter + "_on")():
        lo, hi = getattr(axes, "get_" + letter + "lim")()
        axis["range"] = [round4(float(lo)), round4(float(hi))]
    return axis

def build_spec(figure):
    from matplotlib.collections import PathCollection
    from matplotlib.lines import Line2D
    all_axes = figure.get_axes()
    if len(all_axes) != 1:
        return None
    suptitle = getattr(figure, "_suptitle", None)
    if any(visible(text) and text is not suptitle for text in figure.texts):
        return None
    for group in (figure.images, figure.lines, figure.patches, figure.artists, getattr(figure, "subfigs", [])):
        if any(visible(artist) for artist in group):
            return None
    axes = all_axes[0]
    dim = 3 if hasattr(axes, "get_zlim") else 2
    for group in (axes.patches, axes.images, axes.texts, axes.tables, axes.artists):
        if any(visible(artist) for artist in group):
            return None
    if dim == 3:
        from mpl_toolkits.mplot3d.art3d import Line3D, Path3DCollection, Poly3DCollection
    traces, triangles = [], 0
    for line in axes.lines:
        if not visible(line):
            continue
        if dim == 3 and not isinstance(line, Line3D):
            return None
        if dim == 2 and type(line) is not Line2D:
            return None
        traces.append(line_trace(line, dim))
    for collection in axes.collections:
        if not visible(collection):
            continue
        if dim == 3 and type(collection) is Path3DCollection:
            traces.append(scatter_trace(collection, dim))
        elif dim == 2 and type(collection) is PathCollection:
            traces.append(scatter_trace(collection, dim))
        elif dim == 3 and type(collection) is Poly3DCollection:
            trace = mesh_trace(collection)
            triangles += len(trace["faces"])
            if triangles > MESH_TRIANGLES:
                return None
            traces.append(trace)
        else:
            return None
    if not traces:
        return None
    letters = ("x", "y", "z") if dim == 3 else ("x", "y")
    spec = {"v": 1, "dim": dim, "axes": {letter: plot_axis(axes, letter) for letter in letters}, "traces": traces}
    title = axes.get_title() or (suptitle.get_text() if suptitle is not None and visible(suptitle) else "")
    if title:
        spec["title"] = title
    return spec

def plot_spec(figure):
    # Reads the figure only; any failure means the figure gets no spec, never an error.
    try:
        spec = build_spec(figure)
        return json.dumps(spec, separators=(",", ":"), allow_nan=False) if spec else None
    except Exception:
        return None

def figure_result(value, preview=False):
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return None
    # mplot3d artists (plot_surface, a 3D ax.plot) live in mpl_toolkits and count as matplotlib values.
    plotting = ("matplotlib", "mpl_toolkits")
    module = type(value).__module__.split(".")[0]
    artists = isinstance(value, (list, tuple)) and value and all(type(item).__module__.split(".")[0] in plotting for item in value)
    if value is not None and module not in plotting and not artists:
        return None
    numbers = pyplot.get_fignums()
    figure = value if hasattr(value, "savefig") else pyplot.figure(numbers[-1]) if numbers else None
    if figure is None:
        return None
    plot = plot_spec(figure)
    if preview and plot:
        # A preview shows the spec only; the figure is still closed so it does not leak into the next run.
        pyplot.close(figure)
        return {"plot": plot}
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
    image = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    return {"text": image, "plot": plot} if plot else {"text": image}

def close_figures():
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is not None:
        pyplot.close("all")

def run_cell(code, scope, preview=False):
    tree = ast.parse(code, "<cell>")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    exec(compile(tree, "<cell>", "exec"), scope)
    value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), scope) if last else None
    figure = figure_result(value, preview)
    if figure:
        return figure
    close_figures()
    if value is None:
        return {}
    if type(value).__module__.split(".")[0] == "sympy" or hasattr(value, "_sympy_"):
        import sympy
        return {"latex": sympy.latex(value)}
    return {"text": str(value)}

PARAM_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]*")

def invalid_param_name(params):
    # A name must be a plain identifier, and a dunder name could replace the builtins the cell runs on.
    for name in params:
        if not PARAM_NAME.fullmatch(name) or name.startswith("__"):
            return name
    return None

def error_text(error):
    # A missing module names the pip command for this interpreter, so the user installs into the one that runs the cell.
    message = traceback.format_exc().strip().splitlines()[-1]
    if isinstance(error, ModuleNotFoundError) and error.name:
        message += '\nInstall it with: "' + sys.executable + '" -m pip install ' + error.name.split(".")[0]
    return message

def warning_lines(caught):
    # Each warning is one line "<Category>: <message> (line <n>)", kept beside the result and never in its text.
    return [f"{w.category.__name__}: {' '.join(str(w.message).split())} (line {w.lineno})" for w in caught]

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
        # Param values come from the parsed JSON only and are set as data, never evaluated.
        params = request.get("params")
        params = params if isinstance(params, dict) else {}
        rejected = invalid_param_name(params)
        if rejected is not None:
            emit(request_id, {"error": "Invalid parameter name " + rejected})
            continue
        preview = request.get("preview") is True
        scope.update(params)
        captured = io.StringIO()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                with contextlib.redirect_stdout(captured):
                    payload = run_cell(code, scope, preview)
            except BaseException as error:
                close_figures()
                payload = {"error": error_text(error)}
        if caught:
            payload = {**payload, "warnings": warning_lines(caught)}
        emit(request_id, payload, captured.getvalue())

main()
