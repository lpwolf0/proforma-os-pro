-- PROFORMA OS · schema, row-level security and private storage
-- Run once in the Supabase SQL editor. Works in a NEW project, or in the project that already runs Invoice OS
-- (the administrator table is shared; every other table and bucket has its own name).

create extension if not exists pgcrypto;

-- ───────────── the one administrator ─────────────
create table if not exists public.admin_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists admin_profile_single_row on public.admin_profile ((true));   -- exactly one admin

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_profile where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ───────────── default details (single row) ─────────────
create table public.pf_settings (
  id boolean primary key default true check (id),
  account_name text not null default 'Perfect Hand Integrated Service.',
  bank text not null default 'GTB',
  account_no text not null default '0153023517',
  tin text not null default '18234768',
  signatory text not null default 'UBONG UDOH',
  title text not null default 'Manager',
  sign_for text not null default 'Perfect Hand Transport Services.',
  doc_title text not null default 'INVOICE',
  recipient text not null default E'The Procurement Officer,\nCBM Country Coordination Office,\n13 Okemesi Crescent, Off Twon Brass Street, Garki 2,\nAbuja, Nigeria.',
  vat_rate numeric(5,2) not null default 7.5 check (vat_rate between 0 and 100),
  show_signature boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.pf_settings default values;
create trigger pf_settings_touch before update on public.pf_settings for each row execute function public.touch_updated_at();

-- ───────────── proforma invoices ─────────────
create table public.proformas (
  id uuid primary key default gen_random_uuid(),
  ref_no text not null check (length(trim(ref_no)) > 0),          -- internal reference, not printed on the PDF
  label text not null default '',                                  -- internal label for the dashboard / file name, not printed
  doc_date date not null default current_date,
  recipient text not null default '',
  vat_rate numeric(5,2) not null default 7.5,
  rows jsonb not null default '[]'::jsonb
    check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) between 1 and 15),   -- 1 to 15 table rows
  overrides jsonb not null default '{}'::jsonb,                    -- typed-over vat / total / amount in words
  amount_words text not null default '',
  details jsonb not null default '{}'::jsonb,                      -- account details & signatory as they were on this document
  subtotal numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  pdf_path text,
  pdf_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index proformas_ref_unique on public.proformas (lower(trim(ref_no)));
create index proformas_date on public.proformas (doc_date desc);
create trigger proformas_touch before update on public.proformas for each row execute function public.touch_updated_at();

-- next reference: highest numeric reference + 1, zero-padded to 3 digits
create or replace function public.next_pf_ref() returns text
language plpgsql stable security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select coalesce(max(ref_no::bigint), 0) + 1 into n from public.proformas where ref_no ~ '^[0-9]{1,12}$';
  return lpad(n::text, 3, '0');
end $$;
revoke all on function public.next_pf_ref() from public;
grant execute on function public.next_pf_ref() to authenticated;

-- ───────────── row-level security: everything is admin-only ─────────────
alter table public.admin_profile enable row level security;
alter table public.pf_settings   enable row level security;
alter table public.proformas     enable row level security;

drop policy if exists admin_self on public.admin_profile;      -- safe if Invoice OS already created it in this project
create policy admin_self on public.admin_profile for select to authenticated using (user_id = auth.uid());
create policy admin_all  on public.pf_settings   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all  on public.proformas     for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ───────────── private storage ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proforma-pdfs', 'proforma-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- the admin may read and delete generated PDFs; only the server (service role) writes them
create policy proforma_pdfs_read   on storage.objects for select to authenticated using (bucket_id = 'proforma-pdfs' and public.is_admin());
create policy proforma_pdfs_delete on storage.objects for delete to authenticated using (bucket_id = 'proforma-pdfs' and public.is_admin());
