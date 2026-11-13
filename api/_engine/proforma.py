"""Proforma invoice PDF engine. Pure functions, no network.

`build_pdf(doc)` -> bytes. The letterhead is drawn at the top of EVERY page; table rows flow onto continuation
pages (header row repeated) and the closing block (amount in words, account details, signature) stays together.
"""
import io
import os
from decimal import Decimal, ROUND_HALF_UP
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, Image as RLImage, KeepTogether, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
MAX_ROWS = 15

_ready = False
def _fonts():
    global _ready
    if _ready: return
    for name, f in (("Serif", "LiberationSerif-Regular.ttf"), ("Serif-B", "LiberationSerif-Bold.ttf"),
                    ("Sans", "LiberationSans-Regular.ttf"), ("Sans-B", "LiberationSans-Bold.ttf")):
        pdfmetrics.registerFont(TTFont(name, os.path.join(FONTS, f)))
    pdfmetrics.registerFontFamily("Serif", normal="Serif", bold="Serif-B", italic="Serif", boldItalic="Serif-B")
    pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-B", italic="Sans", boldItalic="Sans-B")
    _ready = True

# ───────────────────────── numbers ─────────────────────────
def dec(v):
    if v is None: return Decimal(0)
    s = "".join(ch for ch in str(v) if ch.isdigit() or ch in ".-")
    try: return Decimal(s) if s not in ("", "-", ".", "-.") else Decimal(0)
    except Exception: return Decimal(0)

def q2(d): return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
def money0(d):
    s = f"{q2(d):,.2f}"
    return s[:-3] if s.endswith(".00") else (s[:-1] if s.endswith("0") else s)

def units_of(r):
    u = r.get("units")
    return Decimal(1) if u is None or str(u).strip() == "" else dec(u)

def row_total(r):
    t = r.get("total")
    return dec(t) if t not in (None, "") else units_of(r) * dec(r.get("unit_price"))

def compute(doc):
    ov = doc.get("overrides") or {}
    subtotal = sum((row_total(r) for r in doc["rows"]), Decimal(0))
    vat = dec(ov["vat"]) if ov.get("vat") not in (None, "") else q2(subtotal * dec(doc.get("vat_rate", 7.5)) / 100)
    total = dec(ov["total"]) if ov.get("total") not in (None, "") else subtotal + vat
    return subtotal, vat, total

# ───────────────────────── amount in words ─────────────────────────
_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
         "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
_SCALES = ["", "Thousand", "Million", "Billion", "Trillion"]

def _below100(n): return _ONES[n] if n < 20 else _TENS[n // 10] + ("-" + _ONES[n % 10] if n % 10 else "")
def _below1000(n):
    h, r = divmod(n, 100); parts = []
    if h: parts.append(_ONES[h] + " Hundred")
    if r: parts += (["and"] if h else []) + [_below100(r)]
    return " ".join(parts)

def int_words(n):
    if n == 0: return "Zero"
    groups = []
    while n: groups.append(n % 1000); n //= 1000
    parts = []
    for i in range(len(groups) - 1, -1, -1):
        g = groups[i]
        if not g: continue
        w = _below1000(g)
        if i == 0 and g < 100 and parts: w = "and " + w
        parts.append((w + " " + _SCALES[i]).strip())
    return " ".join(parts)

def naira_words(amount):
    a = q2(abs(dec(amount)))
    if a >= Decimal(10) ** 15: return ""
    naira = int(a); kobo = int((a - naira) * 100)
    out = int_words(naira) + " Naira"
    if kobo: out += ", " + int_words(kobo) + " Kobo"
    return out + " Only."

# ───────────────────────── dates ─────────────────────────
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
def _ord(d): return "th" if 10 <= d % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(d % 10, "th")
def long_date(iso):
    try: y, m, d = (int(x) for x in str(iso)[:10].split("-")); return f'{d}<super rise="3" size="7">{_ord(d)}</super> {MONTHS[m - 1]}, {y}'
    except Exception: return ""

def e(v): return escape(str(v if v is not None else ""))
def lines(v): return e(v).replace("\r", "").replace("\n", "<br/>")

# ───────────────────────── layout (points) ─────────────────────────
PAGE_W, PAGE_H = A4
LH_X, LH_W, LH_TOP = 72, 503, 6
LH_H = LH_W * 371 / 1599
FRAME_X, FRAME_BOTTOM, FRAME_TOP_GAP = 18, 36, 124       # table spans nearly full width; text is indented to 72pt
FRAME_W = PAGE_W - 2 * FRAME_X
IND = 54                                                   # 18 + 54 = 72pt text margin

def _st(name, **kw):
    base = dict(fontName="Serif", fontSize=12, leading=15, leftIndent=IND, rightIndent=IND); base.update(kw)
    return ParagraphStyle(name, **base)

def build_pdf(doc):
    _fonts()
    rows = doc.get("rows") or []
    if not 1 <= len(rows) <= MAX_ROWS: raise ValueError(f"A proforma needs between 1 and {MAX_ROWS} table rows")
    d = {"account_name": "", "bank": "", "account_no": "", "tin": "", "signatory": "", "title": "", "sign_for": "",
         "doc_title": "INVOICE", "show_signature": True, "show_account": True, **(doc.get("details") or {})}
    subtotal, vat, total = compute(doc)
    vr = dec(doc.get("vat_rate", 7.5)).normalize(); vr_txt = f"{vr:f}"
    words = (doc.get("amount_words") or "").strip() or naira_words(total)
    sig_path = os.path.join(HERE, "signature.png")
    sig_ok = bool(d.get("show_signature")) and os.path.exists(sig_path)
    lh_path = os.path.join(HERE, "letterhead.jpg")

    # --- table ---
    cell = ParagraphStyle("cell", fontName="Serif", fontSize=10.5, leading=12.4)
    cellb = ParagraphStyle("cellb", parent=cell, fontName="Serif-B")
    qty = ParagraphStyle("qty", fontName="Sans", fontSize=8.6, leading=10.2)
    num = ParagraphStyle("num", parent=cell, alignment=TA_RIGHT)
    mid = ParagraphStyle("mid", parent=cell, alignment=TA_CENTER)
    head = ParagraphStyle("head", parent=cellb, alignment=TA_CENTER, fontSize=10, leading=12)
    lab = ParagraphStyle("lab", parent=cellb, fontSize=10, leading=12)
    data = [[Paragraph(x, head) for x in ("S/N", "DESCRIPTION", "QUANTITY", "UNIT PRICE", "TOTAL PRICE", "REMARKS")]]
    for i, r in enumerate(rows, 1):
        desc = []
        if str(r.get("description", "")).strip(): desc.append(Paragraph(lines(r.get("description")), cell))
        if str(r.get("note", "")).strip(): desc.append(Paragraph(lines(r.get("note")), cellb))
        data.append([Paragraph(str(i), mid), desc or "", Paragraph(lines(r.get("quantity")), qty),
                     Paragraph(money0(dec(r.get("unit_price"))) if str(r.get("unit_price", "")).strip() else "", num),
                     Paragraph(money0(row_total(r)), num), Paragraph(lines(r.get("remarks")), mid)])
    n = len(rows)
    data.append(["", "", "", Paragraph(f"{vr_txt}% VAT", lab), Paragraph(money0(vat), num), Paragraph("----------", mid)])
    data.append(["", "", "", Paragraph("Total Amount", lab), Paragraph(money0(total), num), Paragraph("----------", mid)])
    cw = [FRAME_W * p / 100 for p in (4.3, 41, 13.4, 12.5, 15.8, 13)]
    tbl = Table(data, colWidths=cw, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), .7, (0, 0, 0)), ("VALIGN", (0, 0), (-1, 0), "MIDDLE"), ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, 0), 4), ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("NOSPLIT", (0, n), (-1, -1)),            # the last item row never gets separated from the VAT / total rows
    ]))

    # --- closing block ---
    b = _st("b", fontSize=12, leading=15)
    bold = lambda t: f"<b>{e(t)}</b>"
    acc = Table([["", Paragraph(bold(k), _st("k", leftIndent=0, rightIndent=0, leading=15.5)), Paragraph(e(v), _st("v", leftIndent=0, rightIndent=0, leading=15.5))]
                 for k, v in (("ACCOUNT NAME:", d["account_name"]), ("Bank:", d["bank"]), ("Account Number:", d["account_no"]), ("TIN Number:", d["tin"]))],
                colWidths=[IND, 144, FRAME_W - IND - 144])
    acc.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                             ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    sig_rows = [["", RLImage(sig_path, width=108, height=108 * 208 / 436, hAlign="LEFT") if sig_ok else Spacer(1, 36)],
                ["", Paragraph(bold(str(d["signatory"]).upper()), _st("s1", leftIndent=0))],
                ["", Paragraph(f"({e(d['title'])})", _st("s2", leftIndent=0))],
                ["", Paragraph(f"<b>For:</b> {e(d['sign_for'])}", _st("s3", leftIndent=0))]]
    sig = Table(sig_rows, colWidths=[IND, FRAME_W - IND])
    sig.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    parts = [Paragraph(f"<b>Amount in Words:</b> {e(words)}", _st("w", spaceBefore=14, spaceAfter=10))]
    if d["show_account"]:                                    # optional: only printed when ticked
        parts += [Paragraph("<b>ACCOUNT DETAILS:</b>", _st("ad", spaceAfter=3)), acc]
    closing = KeepTogether(parts + [Spacer(1, 22), sig])

    story = [Paragraph(long_date(doc.get("doc_date")), _st("date", alignment=TA_RIGHT)),
             Spacer(1, 12), Paragraph(lines(doc.get("recipient")), b),
             Paragraph(f"<b>{e(d['doc_title'])}</b>", _st("t", alignment=TA_CENTER, spaceBefore=14, spaceAfter=12, leftIndent=0, rightIndent=0)),
             tbl, closing]

    def decorate(c, _doc):
        c.drawImage(ImageReader(lh_path), LH_X, PAGE_H - LH_TOP - LH_H, width=LH_W, height=LH_H)      # on every page

    buf = io.BytesIO()
    pdf = BaseDocTemplate(buf, pagesize=A4, title=f"Proforma Invoice {doc.get('ref_no', '')}".strip(), author=d["account_name"] or "Proforma OS",
                          creator="Proforma OS", subject="Proforma invoice")
    top = PAGE_H - LH_TOP - LH_H - 8
    frame = Frame(FRAME_X, FRAME_BOTTOM, FRAME_W, top - FRAME_BOTTOM, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="f")
    pdf.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=decorate)])
    pdf.build(story)
    return buf.getvalue()
