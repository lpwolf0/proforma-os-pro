import copy, io, json, os, sys, threading, time, unittest, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "api"), os.path.join(ROOT, "api", "_engine"), os.path.join(ROOT, "tests")]
from sample import SAMPLE
import proforma as eng
from pypdf import PdfReader

DOC_ID = str(uuid.uuid4()); ADMIN_JWT, OTHER_JWT = "admin-jwt", "other-jwt"
STORE = {}; DB = {"proformas": [], "admin_profile": [{"user_id": "u-admin"}]}

class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _j(self, code, obj): d = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Length", str(len(d))); self.end_headers(); self.wfile.write(d)
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/auth/v1/user":
            t = self.headers.get("Authorization", "").replace("Bearer ", "")
            return self._j(200, {"id": "u-admin"}) if t == ADMIN_JWT else self._j(200, {"id": "u-other"}) if t == OTHER_JWT else self._j(401, {})
        if u.path.startswith("/rest/v1/"):
            rows = DB[u.path.split("/")[-1]]
            for k, v in q.items():
                if v[0].startswith("eq."): rows = [r for r in rows if str(r.get(k)) == v[0][3:]]
            return self._j(200, rows)
        self._j(404, {})
    def do_POST(self):
        u = urlparse(self.path); body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if u.path.startswith("/storage/v1/object/sign/"): return self._j(200, {"signedURL": "/object/sign/x?token=abc"})
        if u.path.startswith("/storage/v1/object/"): _, _, _, _, b, *p = u.path.split("/"); STORE[(b, "/".join(p))] = body; return self._j(200, {})
        self._j(404, {})
    def do_PATCH(self):
        u = urlparse(self.path); q = parse_qs(u.query); patch = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0))); out = []
        for r in DB[u.path.split("/")[-1]]:
            if str(r["id"]) == q["id"][0][3:]: r.update(patch); out.append(r)
        self._j(200, out)

class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Fake); threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        os.environ.update(SUPABASE_URL=f"http://127.0.0.1:{cls.srv.server_port}", SUPABASE_ANON_KEY="anon", SUPABASE_SERVICE_ROLE_KEY="svc")
        import generate
        cls.api = HTTPServer(("127.0.0.1", 0), generate.handler); threading.Thread(target=cls.api.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls): cls.srv.shutdown(); cls.api.shutdown()
    def setUp(self): STORE.clear(); d = copy.deepcopy(SAMPLE); d.update(id=DOC_ID, pdf_path=None); DB["proformas"][:] = [d]
    def post(self, jwt, body):
        import urllib.request, urllib.error
        req = urllib.request.Request(f"http://127.0.0.1:{self.api.server_port}/api/generate", data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {jwt}" if jwt else "", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
        except urllib.error.HTTPError as ex: return ex.code, json.loads(ex.read())

    def test_requires_login(self): self.assertEqual(self.post(None, {"proforma_id": DOC_ID})[0], 401)
    def test_rejects_non_admin(self): self.assertEqual(self.post(OTHER_JWT, {"proforma_id": DOC_ID})[0], 403)
    def test_bad_id(self): self.assertEqual(self.post(ADMIN_JWT, {"proforma_id": "x"})[0], 400)
    def test_unknown(self): self.assertEqual(self.post(ADMIN_JWT, {"proforma_id": str(uuid.uuid4())})[0], 404)
    def test_generate_stores_pdf_and_link(self):
        st, out = self.post(ADMIN_JWT, {"proforma_id": DOC_ID}); self.assertEqual(st, 200, out); self.assertIn("token=", out["url"])
        self.assertEqual(len(PdfReader(io.BytesIO(STORE[("proforma-pdfs", out["path"])])).pages), 1)
        self.assertEqual(DB["proformas"][0]["pdf_path"], out["path"])
    def test_regenerate_keeps_old_versions(self):
        a = self.post(ADMIN_JWT, {"proforma_id": DOC_ID})[1]["path"]; time.sleep(1.1); b = self.post(ADMIN_JWT, {"proforma_id": DOC_ID})[1]["path"]
        self.assertNotEqual(a, b); self.assertIn(("proforma-pdfs", a), STORE)
    def test_16_rows_rejected_with_422(self):
        DB["proformas"][0]["rows"] = [SAMPLE["rows"][0]] * 16; self.assertEqual(self.post(ADMIN_JWT, {"proforma_id": DOC_ID})[0], 422)

def pages(doc): return PdfReader(io.BytesIO(eng.build_pdf(doc)))
def text(doc, n): return pages(doc).pages[n].extract_text()

class EngineTests(unittest.TestCase):
    def test_matches_original_numbers(self):
        s, v, t = eng.compute(SAMPLE); self.assertEqual((str(s), str(v), str(t)), ("640000", "48000.00", "688000.00"))
        self.assertEqual(eng.naira_words(t), "Six Hundred and Eighty-Eight Thousand Naira Only.")
    def test_words_cases(self):
        c = {0: "Zero Naira Only.", 21: "Twenty-One Naira Only.", 101: "One Hundred and One Naira Only.", 1050: "One Thousand and Fifty Naira Only.",
             1000050: "One Million and Fifty Naira Only.", 688000.25: "Six Hundred and Eighty-Eight Thousand Naira, Twenty-Five Kobo Only."}
        for n, w in c.items(): self.assertEqual(eng.naira_words(n), w)
    def test_total_override_and_blank_units(self):
        d = copy.deepcopy(SAMPLE); d["rows"][0]["units"] = ""; self.assertEqual(str(eng.compute(d)[0]), "160000")
        d["rows"][0]["total"] = "500,000"; self.assertEqual(str(eng.compute(d)[0]), "500000")
        d["overrides"] = {"vat": "1000", "total": "999999"}; self.assertEqual((str(eng.compute(d)[1]), str(eng.compute(d)[2])), ("1000", "999999"))
    def test_typed_amount_in_words_is_used(self):
        d = copy.deepcopy(SAMPLE); d["amount_words"] = "Custom words only."; self.assertIn("Custom words only.", text(d, 0))
    def test_letterhead_on_every_page(self):
        d = copy.deepcopy(SAMPLE); d["rows"] = [SAMPLE["rows"][0]] * 15; r = pages(d); self.assertGreaterEqual(len(r.pages), 2)
        for pg in r.pages: self.assertGreaterEqual(len(pg.images), 1)    # letterhead on every page
        self.assertIn("DESCRIPTION", r.pages[1].extract_text())          # header row repeats
    def test_closing_block_stays_together(self):
        d = copy.deepcopy(SAMPLE); d["rows"] = [SAMPLE["rows"][0]] * 15; r = pages(d); last = r.pages[-1].extract_text()
        for w in ("Amount in Words", "ACCOUNT DETAILS", "TIN Number", "UBONG UDOH", "For:"): self.assertIn(w, last)
    def test_account_details_optional(self):
        d = copy.deepcopy(SAMPLE); self.assertIn("ACCOUNT DETAILS", text(d, 0)); self.assertIn("0153023517", text(d, 0))
        d["details"]["show_account"] = False; t = text(d, 0)
        for w in ("ACCOUNT DETAILS", "ACCOUNT NAME", "0153023517", "TIN Number"): self.assertNotIn(w, t)
        for w in ("Amount in Words", "UBONG UDOH", "For:"): self.assertIn(w, t)          # the rest of the closing block stays
        d["details"].pop("show_account"); self.assertIn("ACCOUNT DETAILS", text(d, 0))     # older documents without the setting still show it
    def test_15_ok_16_rejected(self):
        d = copy.deepcopy(SAMPLE); d["rows"] = [SAMPLE["rows"][0]] * 15; eng.build_pdf(d)
        d["rows"] = [SAMPLE["rows"][0]] * 16
        with self.assertRaises(ValueError): eng.build_pdf(d)
        d["rows"] = []
        with self.assertRaises(ValueError): eng.build_pdf(d)
    def test_markup_in_fields_is_escaped(self):
        d = copy.deepcopy(SAMPLE); d["recipient"] = "<b>x & y</b> <script>"; d["rows"][0]["description"] = "<i>a</i> & b"; eng.build_pdf(d)

if __name__ == "__main__": unittest.main()
