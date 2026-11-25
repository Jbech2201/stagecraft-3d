import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env?.VITE_SUPABASE_URL;
const KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY;
// Opt-in: Supabase hanya aktif bila VITE_USE_SUPABASE=true (default: mode lokal + login username/password).
const ENABLED = import.meta.env?.VITE_USE_SUPABASE === 'true';

export const supabase =
  ENABLED && URL && KEY
    ? createClient(URL, KEY, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true } })
    : null;

export const cloudEnabled = Boolean(supabase);

/* ───── Row <-> object mappers (pure, unit-tested) ───── */
export function orderToRow(o) {
  return {
    id: o.id,
    status: 'PENDING',
    client_name: o.clientName,
    client_phone: o.clientPhone,
    event_name: o.eventName,
    event_date: o.eventDate,
    rental_days: o.rentalDays,
    stage_summary: o.stageSummary,
    power_summary: o.powerSummary,
    grand_total: Math.round(Number(o.grandTotal) || 0),
  };
}

export function rowToOrder(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    eventName: r.event_name,
    eventDate: r.event_date,
    rentalDays: r.rental_days,
    stageSummary: r.stage_summary,
    powerSummary: r.power_summary,
    grandTotal: Number(r.grand_total) || 0,
  };
}

function check({ error }) {
  if (error) throw new Error(error.message);
}

/* ───── Auth ───── */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  if (error) throw new Error(error.message);
}

export function signOut() {
  return supabase.auth.signOut();
}

export function onAuthChange(handler) {
  // Never await supabase calls inside this callback (deadlock) — defer to next tick.
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => handler(event, session), 0);
  });
  return () => data.subscription.unsubscribe();
}

/** Returns the vendor row when the signed-in email is registered, else null. Server-side RLS decides. */
export async function getVendor(email) {
  const { data, error } = await supabase
    .from('vendors')
    .select('email, display_name')
    .ilike('email', email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/* ───── Catalog ───── */
export async function fetchCatalog() {
  const { data, error } = await supabase.from('equipment').select('id, data').order('created_at');
  if (error) throw new Error(error.message);
  return data.map((r) => ({ ...r.data, id: r.id }));
}

export async function upsertEquipment(item) {
  check(await supabase.from('equipment').upsert({ id: item.id, data: item }));
}

export async function deleteEquipment(id) {
  check(await supabase.from('equipment').delete().eq('id', id));
}

export async function seedCatalogIfEmpty(items) {
  const { count, error } = await supabase.from('equipment').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  if (count === 0) {
    check(await supabase.from('equipment').insert(items.map((it) => ({ id: it.id, data: it }))));
    return true;
  }
  return false;
}

export async function resetCatalog(items) {
  check(await supabase.from('equipment').delete().neq('id', ''));
  check(await supabase.from('equipment').insert(items.map((it) => ({ id: it.id, data: it }))));
}

/* ───── Orders ───── */
export async function insertOrder(order) {
  // No .select(): consumers can insert but are not allowed to read orders back.
  check(await supabase.from('orders').insert(orderToRow(order)));
}

export async function fetchOrders() {
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(rowToOrder);
}

export async function updateOrderStatus(id, status) {
  check(await supabase.from('orders').update({ status }).eq('id', id));
}

export function subscribeOrders(onChange) {
  const channel = supabase
    .channel('orders-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ───── Vendor settings ───── */
export async function fetchVendorSettings() {
  const { data, error } = await supabase.from('vendor_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { companyName: data.company_name, whatsappNumber: data.whatsapp_number } : null;
}

export async function saveVendorSettings({ companyName, whatsappNumber }) {
  check(
    await supabase
      .from('vendor_settings')
      .update({ company_name: companyName, whatsapp_number: whatsappNumber })
      .eq('id', 1)
  );
}
