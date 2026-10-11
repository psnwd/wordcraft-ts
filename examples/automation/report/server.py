"""HTTP side of the report example (stdlib server).

  POST /api/report    JSON params -> .docx   (see report.Params)
  POST /api/analyze   .docx       -> JSON    outline, tables, pictures, sections, header/footer
"""

import json
from dataclasses import fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from report import Params, analyze_report, build_report

MAX_BODY = 20 * 1024 * 1024  # 20 MB
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PARAM_NAMES = {f.name for f in fields(Params)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, ctype: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, obj) -> None:
        self._send(status, json.dumps(obj).encode(), "application/json")

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._json(413, {"error": "body too large"})
        body = self.rfile.read(length)
        try:
            if self.path == "/api/report":
                raw = json.loads(body or b"{}")
                params = Params(**{k: v for k, v in raw.items() if k in PARAM_NAMES})  # ignore unknown keys
                return self._send(200, build_report(params), DOCX)
            if self.path == "/api/analyze":
                return self._json(200, analyze_report(body))
        except Exception as e:  # bad JSON / values / not a docx: tell the caller, keep serving
            return self._json(400, {"error": f"{type(e).__name__}: {e}"})
        self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args) -> None:
        print("[py]", fmt % args, flush=True)


if __name__ == "__main__":
    # Loopback only: this is a demo server with no auth.
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("Report API on http://127.0.0.1:8000", flush=True)
    server.serve_forever()
