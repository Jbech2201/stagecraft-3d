-- StageCraft 3D — skema Supabase
-- Jalankan SELURUH file ini di: Supabase Dashboard → SQL Editor → New query → Run.
-- Aman dijalankan ulang (idempotent).

-- ───────────── Tabel ─────────────
create table if not exists public.vendors (
  email        text primary key,
  display_name text,
  created_at   timestamptz not null default now()
);

create table if not exists public.vendor_settings (
  id              int primary key default 1 check (id = 1),
  company_name    text not null default 'StageRental Pro Production',
  whatsapp_number text not null default '6281234567890'
);
insert into public.vendor_settings (id) values (1) on conflict do nothing;

create table if not exists public.equipment (
  id         text primary key,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id            text primary key,
  created_at    timestamptz not null default now(),
  status        text not null default 'PENDING'
                check (status in ('PENDING','APPROVED','COMPLETED','REJECTED')),
  client_name   text not null check (char_length(client_name)  <= 120),
  client_phone  text not null check (char_length(client_phone) <= 60),
  event_name    text not null check (char_length(event_name)   <= 160),
  event_date    text not null check (char_length(event_date)   <= 20),
  rental_days   int  not null check (rental_days between 1 and 60),
  stage_summary text not null check (char_length(stage_summary) <= 200),
  power_summary text not null check (char_length(power_summary) <= 200),
  grand_total   bigint not null check (grand_total >= 0)
);

-- ───────────── Helper: apakah pemanggil adalah penjual terdaftar? ─────────────
create or replace function public.is_vendor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vendors v
    where lower(v.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_vendor() from public;
grant execute on function public.is_vendor() to anon, authenticated;

-- ───────────── Row Level Security ─────────────
alter table public.vendors         enable row level security;
alter table public.vendor_settings enable row level security;
alter table public.equipment       enable row level security;
alter table public.orders          enable row level security;

-- vendors: pengguna hanya boleh membaca barisnya sendiri. Tidak ada insert/update/delete dari klien.
drop policy if exists vendors_select_self on public.vendors;
create policy vendors_select_self on public.vendors
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- vendor_settings: publik boleh baca (konsumen butuh nomor WhatsApp), hanya penjual boleh ubah.
drop policy if exists settings_select_all on public.vendor_settings;
create policy settings_select_all on public.vendor_settings
  for select to anon, authenticated using (true);
drop policy if exists settings_update_vendor on public.vendor_settings;
create policy settings_update_vendor on public.vendor_settings
  for update to authenticated using (public.is_vendor()) with check (public.is_vendor());

-- equipment: publik boleh baca, hanya penjual boleh tulis.
drop policy if exists equipment_select_all on public.equipment;
create policy equipment_select_all on public.equipment
  for select to anon, authenticated using (true);
drop policy if exists equipment_write_vendor on public.equipment;
create policy equipment_write_vendor on public.equipment
  for all to authenticated using (public.is_vendor()) with check (public.is_vendor());

-- orders: siapa pun boleh MENGAJUKAN (harus berstatus PENDING), hanya penjual boleh membaca & mengubah.
drop policy if exists orders_insert_public on public.orders;
create policy orders_insert_public on public.orders
  for insert to anon, authenticated with check (status = 'PENDING');
drop policy if exists orders_select_vendor on public.orders;
create policy orders_select_vendor on public.orders
  for select to authenticated using (public.is_vendor());
drop policy if exists orders_update_vendor on public.orders;
create policy orders_update_vendor on public.orders
  for update to authenticated using (public.is_vendor()) with check (public.is_vendor());

-- ───────────── Realtime: pesanan baru muncul langsung di dashboard penjual ─────────────
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

-- ───────────── DAFTARKAN EMAIL PENJUAL (WAJIB, ganti lalu jalankan) ─────────────
-- Hanya email di tabel ini yang menjadi penjual setelah login Google.
-- insert into public.vendors (email, display_name) values
--   ('emailpenjual@gmail.com', 'Nama Penjual')
-- on conflict (email) do nothing;
