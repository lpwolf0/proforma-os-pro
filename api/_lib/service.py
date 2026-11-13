import datetime
import os
import re
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_engine"))
from . import supa
import proforma as engine

LINK_SECONDS = 60 * 60 * 24 * 365      # long-lived link: 1 year
BUCKET = "proforma-pdfs"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def generate(doc_id):
    """Build the proforma PDF, store it privately, return a long-lived link."""
    if not UUID.match(str(doc_id or "").lower()): raise supa.ApiError(400, "proforma_id is required")
    rows = supa.select("proformas", {"id": f"eq.{doc_id}", "select": "*"})
    if not rows: raise supa.ApiError(404, "Proforma not found")
    doc = rows[0]
    try: pdf = engine.build_pdf(doc)
    except ValueError as ex: raise supa.ApiError(422, str(ex))
    now = datetime.datetime.now(datetime.timezone.utc)
    path = f"{doc_id}/proforma-{now.strftime('%Y%m%d-%H%M%S')}.pdf"        # a new object every time: old versions are never overwritten
    supa.storage_put(BUCKET, path, pdf, "application/pdf")
    supa.update("proformas", {"id": f"eq.{doc_id}"}, {"pdf_path": path, "pdf_generated_at": now.isoformat()})
    return {"path": path, "url": supa.signed_url(BUCKET, path, LINK_SECONDS), "ref_no": doc["ref_no"]}
