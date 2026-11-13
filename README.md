# PROFORMA OS

Private, single-administrator web app for **Perfect Hand Integrated Services**. It fills the proforma invoice (recipient, date, a table of up to 15 rows, amount in words), keeps every document, and stores the finished PDF in private cloud storage.

**Stack:** plain HTML/CSS/JavaScript front end (no build step) · Supabase (Auth, Postgres, private Storage, Row Level Security) · one Python serverless function on Vercel that draws the PDF.

```
index.html, css/, js/              the app (login, dashboard, editor, settings)
js/config.js                       your Supabase URL + anon key (the only file you edit)
api/generate.py                    POST /api/generate {proforma_id} -> builds the PDF, stores it, returns a 1-year link
api/_engine/proforma.py            PDF layout (letterhead on every page, table flows to page 2+, amount in words)
supabase/migrations/001_init.sql   tables, security rules, private bucket
supabase/bootstrap_admin.sql       registers you as THE administrator
tests/                             backend tests and a browser test
```

## What you can edit
* **Recipient block** (The Procurement Officer, CBM Country Coordination Office, address…) and the **date**.
* **The whole table, 1 to 15 rows.** Per row: description, a bold line under it (e.g. “Required; 28th and 29th October 2026”), quantity text, units × unit price, total price, remarks. Total price is calculated (units × unit price) unless you type over it.
* **VAT** (7.5% by default) and **Total Amount**: calculated, or type over them.
* **Amount in words**: written automatically from the Total Amount (“Six Hundred and Eighty-Eight Thousand Naira Only.”). Type over it if you want different words; “Reset to auto” brings it back.
* **Account details are optional.** Tick or untick “Show account details” in the editor: ticked prints the ACCOUNT DETAILS section (account name, bank, account number, TIN); unticked leaves the whole section out. It is ticked by default, and each document remembers its own choice.
* Account details, signatory and the “For:” line come from **Settings** and can be changed per document.

## Pages
The letterhead is printed at the top of **every** page. If the rows do not fit on page 1 they continue on page 2 (and 3 if needed) with the table heading repeated. The amount in words, account details and signature always stay together; if there is no room they move to the next page as a block. The live preview shows the same flow; the PDF is the final word on exact page breaks.

## Same as Invoice OS
Single-admin login (sign-ups off, enforced by the database) · every document saved and reopenable · automatic reference number (001, 002…, not printed) · dashboard with totals, a per-month chart, search and Year/Month/PDF filters · Open, Download, Copy link, Duplicate, Delete · private PDF storage with **1-year** download links (a link is a bearer link: anyone holding it can open that PDF).

A *Label* (e.g. “CBM October 2026”) is optional. It is not printed; it names the document on the dashboard and in the downloaded file (`Proforma-001-CBM_October_2026.pdf`).

## Setup (about 10 minutes)

### 1. Supabase
You can use the **same Supabase project as Invoice OS** (one login for both apps; skip steps 3–5) or a new project.
1. **SQL Editor** → paste `supabase/migrations/001_init.sql` → Run.
2. *New project only:* Authentication → Users → Add user (tick *Auto-confirm*); turn **OFF** “Allow new users to sign up”; run `supabase/bootstrap_admin.sql` with your email.
3. **Project Settings → API**: copy the Project URL, `anon` key and `service_role` key.
4. Paste the Project URL and anon key into `js/config.js`.

### 2. GitHub + Vercel
1. Open this folder in VS Code → Source Control → Initialize Repository → Commit → Publish Branch (**private** repository).
2. Vercel → Add New → Project → import it (Framework: Other, no build command).
3. Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the service_role key lives **only** here, never in `js/config.js`).
4. Deploy, then add the Vercel address as the Site URL in Supabase → Authentication → URL Configuration.

### 3. First run
Sign in → Settings (check bank, TIN, signatory) → New proforma → fill it → **Save & generate PDF** → Download.

## Good to know
* Forgot your password? Reset it in Supabase → Authentication → Users.
* Letterhead or signature change: replace `assets/letterhead.jpg` / `assets/signature.png` **and** the copies in `api/_engine/`.
* Wording and column layout live in `js/preview.js` (preview) and `api/_engine/proforma.py` (PDF). Change both together. The amount-in-words rules exist in `js/util.js` and `api/_engine/proforma.py` and are tested to match.

## Tests
```bash
pip install -r requirements.txt pypdf
cd tests && python3 -m unittest test_api     # PDF engine + API against a fake Supabase
node tests/ui.test.js                        # browser test (needs Playwright), fake Supabase
```
