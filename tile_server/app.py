"""Flask DeepZoom server.

The process binds to localhost. The Express app is the public entry point and
checks the viewer's login before it proxies a request here.
"""

from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, Response, jsonify, request

from tile_server.slides import SlideNotFound, SlideOpenError, SlideStore


def default_roots() -> dict[str, Path]:
    library = Path(os.environ.get("WSI_SLIDE_DIR", "slides"))
    uploads = Path(os.environ.get("WSI_UPLOAD_DIR", "uploads/slides"))
    return {"library": library, "uploads": uploads}


def create_app(slide_dirs: dict[str, Path] | None = None) -> Flask:
    app = Flask(__name__)
    store = SlideStore(slide_dirs if slide_dirs is not None else default_roots())
    app.config["SLIDE_STORE"] = store

    @app.get("/health")
    def health():
        return jsonify(ok=True, roots=sorted(store.roots))

    @app.get("/slides")
    def list_slides():
        return jsonify(store.list_slides(request.args.get("root")))

    @app.get("/r/<root>/<filename>/meta")
    def meta(root, filename):
        return jsonify(store.describe(root, filename))

    @app.get("/r/<root>/<filename>/thumbnail.jpg")
    def thumbnail(root, filename):
        data = store.thumbnail(root, filename)
        return Response(data, mimetype="image/jpeg")

    @app.get("/r/<root>/<filename>/clinical")
    def read_clinical(root, filename):
        response = jsonify(store.read_clinical(root, filename))
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.put("/r/<root>/<filename>/clinical")
    def write_clinical(root, filename):
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error="Clinical info must be a JSON object"), 400
        try:
            saved = store.write_clinical(
                root,
                filename,
                body,
                updated_by=request.headers.get("X-Updated-By", ""),
            )
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        response = jsonify(saved)
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.get("/r/<root>/<filename>/macro.jpg")
    def macro(root, filename):
        # Hidden unless the viewer explicitly asks. There is no label route.
        if request.args.get("explicit") != "1":
            return jsonify(
                error="Macro images stay hidden until explicitly requested"
            ), 403
        data = store.macro_jpeg(root, filename)
        return Response(data, mimetype="image/jpeg")

    @app.get("/r/<root>/<filename>.dzi")
    def dzi(root, filename):
        xml = store.dzi(root, filename)
        return Response(xml, mimetype="application/xml")

    @app.get("/r/<root>/<filename>_files/<int:level>/<int:col>_<int:row>.jpeg")
    def tile(root, filename, level, col, row):
        data = store.tile(root, filename, level, col, row)
        response = Response(data, mimetype="image/jpeg")
        response.headers["Cache-Control"] = "private, max-age=86400"
        return response

    @app.errorhandler(SlideNotFound)
    def missing(exc):
        return jsonify(error=str(exc) or "Slide not found"), 404

    @app.errorhandler(SlideOpenError)
    def cannot_open(exc):
        return jsonify(error=str(exc)), 422

    return app


def main():
    host = os.environ.get("WSI_TILE_HOST", "127.0.0.1")
    port = int(os.environ.get("WSI_TILE_PORT", "5001"))
    app = create_app()
    roots = app.config["SLIDE_STORE"].roots
    print(f"WSI tile service on http://{host}:{port}")
    for name, directory in roots.items():
        print(f"  {name}: {directory}")
    app.run(host=host, port=port, threaded=True)


if __name__ == "__main__":
    main()
