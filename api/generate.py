"""POST /api/generate  {proforma_id}  ->  {path, url, ref_no}   (admin only)"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import supa, service


class handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass          # no request logging

    def _send(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json"); self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        try:
            supa.require_admin(self.headers.get("Authorization"))
            n = int(self.headers.get("Content-Length") or 0)
            if n > 10_000: raise supa.ApiError(413, "Request too large")
            body = json.loads(self.rfile.read(n) or b"{}")
            self._send(200, service.generate(body.get("proforma_id")))
        except supa.ApiError as ex: self._send(ex.status, {"error": ex.message})
        except json.JSONDecodeError: self._send(400, {"error": "Invalid request"})
        except Exception: self._send(500, {"error": "Could not generate the PDF"})

    def do_GET(self): self._send(405, {"error": "Use POST"})
