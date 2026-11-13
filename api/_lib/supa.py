"""Minimal Supabase client (Auth check, PostgREST, Storage) using only the standard library.
SERVER-SIDE ONLY: it uses the service-role key, which must never reach the browser."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message); self.status, self.message = status, message


def _env(name):
    v = os.environ.get(name)
    if not v: raise ApiError(500, f"Server is missing the environment variable {name}")
    return v

def base(): return _env("SUPABASE_URL").rstrip("/")
def _svc(): return _env("SUPABASE_SERVICE_ROLE_KEY")


def _call(method, url, headers=None, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read()
    except urllib.error.HTTPError as ex: return ex.code, ex.read()
    except Exception as ex: raise ApiError(502, f"Could not reach Supabase: {type(ex).__name__}")

def _svc_headers(extra=None):
    h = {"apikey": _svc(), "Authorization": f"Bearer {_svc()}"}; h.update(extra or {}); return h


# ---- only the single admin may call the API ----
def require_admin(authorization):
    if not authorization or not authorization.lower().startswith("bearer "): raise ApiError(401, "Not signed in")
    jwt = authorization.split(" ", 1)[1].strip()
    st, body = _call("GET", f"{base()}/auth/v1/user", {"apikey": _env("SUPABASE_ANON_KEY"), "Authorization": f"Bearer {jwt}"}, timeout=15)
    if st != 200: raise ApiError(401, "Session expired. Please sign in again")
    uid = json.loads(body).get("id")
    if not select("admin_profile", {"user_id": f"eq.{uid}", "select": "user_id"}): raise ApiError(403, "This account is not the administrator")
    return uid


def select(table, params):
    st, body = _call("GET", f"{base()}/rest/v1/{table}?{urllib.parse.urlencode(params)}", _svc_headers(), timeout=20)
    if st >= 300: raise ApiError(500, f"Database read failed ({table})")
    return json.loads(body)

def update(table, match, patch):
    st, body = _call("PATCH", f"{base()}/rest/v1/{table}?{urllib.parse.urlencode(match)}",
                     _svc_headers({"Content-Type": "application/json", "Prefer": "return=representation"}), json.dumps(patch).encode(), 20)
    if st >= 300: raise ApiError(500, f"Database update failed ({table})")
    return json.loads(body)


def _path(p): return "/".join(urllib.parse.quote(x, safe="") for x in p.split("/"))

def storage_get(bucket, path):
    st, body = _call("GET", f"{base()}/storage/v1/object/{bucket}/{_path(path)}", _svc_headers(), timeout=60)
    if st >= 300: raise ApiError(404, f"File missing in storage: {path.rsplit('/', 1)[-1]}")
    return body

def storage_put(bucket, path, data, content_type):
    st, _ = _call("POST", f"{base()}/storage/v1/object/{bucket}/{_path(path)}",
                  _svc_headers({"Content-Type": content_type, "x-upsert": "false"}), data, 120)
    if st >= 300: raise ApiError(500, "Could not save the PDF to private storage")

def signed_url(bucket, path, expires):
    st, body = _call("POST", f"{base()}/storage/v1/object/sign/{bucket}/{_path(path)}",
                     _svc_headers({"Content-Type": "application/json"}), json.dumps({"expiresIn": expires}).encode(), 20)
    if st >= 300: raise ApiError(500, "Could not create a download link")
    return f"{base()}/storage/v1{json.loads(body)['signedURL']}"
