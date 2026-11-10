"""Persistent pix2tex worker: reads one JSON line {id, png: base64} per request from stdin and answers one JSON line {id, latex} or {id, error} on stdout.

Everything else (library output, warnings, logs) goes to stderr, so stdout carries only the protocol.
When LABSHELF_PIX2TEX_WEIGHTS is set, the model loads <dir>/weights.pth and <dir>/image_resizer.pth and never downloads.
"""
import base64
import io
import json
import os
import sys

# Keep the real stdout for replies; anything a library prints goes to stderr.
_reply_stream = sys.stdout
sys.stdout = sys.stderr


def _reply(payload):
    _reply_stream.write(json.dumps(payload) + "\n")
    _reply_stream.flush()


def _load_model():
    from pix2tex.cli import LatexOCR

    weights = os.environ.get("LABSHELF_PIX2TEX_WEIGHTS")
    if not weights:
        return LatexOCR()

    from munch import Munch

    checkpoint = os.path.join(os.path.abspath(weights), "weights.pth")
    if not os.path.isfile(checkpoint):
        raise FileNotFoundError("pix2tex weights not found: " + checkpoint)
    # LatexOCR loads image_resizer.pth from the checkpoint's folder, and downloads only when the checkpoint is missing.
    return LatexOCR(Munch({"config": "settings/config.yaml", "checkpoint": checkpoint, "no_cuda": True, "no_resize": False}))


def _predict(model, encoded):
    from PIL import Image

    image = Image.open(io.BytesIO(base64.b64decode(encoded)))
    image.load()
    return model(image)


def main():
    model = None
    load_error = None
    try:
        model = _load_model()
    except BaseException as error:  # reported per request, so the host sees why
        load_error = str(error) or type(error).__name__
        print("pix2tex failed to load: " + load_error, file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if model is None:
                _reply({"id": request_id, "error": "pix2tex failed to load: " + str(load_error)})
                continue
            _reply({"id": request_id, "latex": _predict(model, request["png"])})
        except Exception as error:
            print("pix2tex request failed: " + repr(error), file=sys.stderr, flush=True)
            _reply({"id": request_id, "error": str(error) or type(error).__name__})


if __name__ == "__main__":
    main()
