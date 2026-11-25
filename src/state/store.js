import { DEFAULT_EQUIPMENT, DEFAULT_STAGE_CONFIG, STAGE_PRESETS } from '../data/catalog.js';

const STORAGE_CATALOG_KEY = 'stagecraft_catalog';
const STORAGE_CONFIG_KEY = 'stagecraft_config';
const STORAGE_ORDERS_KEY = 'stagecraft_orders';
const STORAGE_VENDOR_SETTINGS_KEY = 'stagecraft_vendor_settings';

export const DEFAULT_VENDOR_SETTINGS = {
  companyName: 'StageRental Pro Production',
  whatsappNumber: '6281234567890',
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return clone(fallback);
    const parsed = JSON.parse(raw);
    return parsed || clone(fallback);
  } catch {
    return clone(fallback);
  }
}

const STORAGE_SESSION_KEY = 'stagecraft_vendor_session';

/** Akun dummy untuk demo. Dicek di sisi klien, jadi BUKAN keamanan sungguhan. */
export const DEMO_VENDOR_ACCOUNTS = [
  { username: 'vendor', password: 'stagecraft2026', displayName: 'Vendor Utama' },
  { username: 'admin', password: 'admin123', displayName: 'Administrator' },
  { username: 'budi', password: 'budi123', displayName: 'Budi Santoso' },
  { username: 'sari', password: 'sari123', displayName: 'Sari Wulandari' },
  { username: 'demo', password: 'demo', displayName: 'Akun Demo' },
];

function emptySession() {
  return { isLoggedIn: false, username: null, email: null, displayName: null, authProvider: null };
}

class StageStore {
  constructor() {
    this.equipmentCatalog = loadFromStorage(STORAGE_CATALOG_KEY, DEFAULT_EQUIPMENT);
    this.stageConfig = loadFromStorage(STORAGE_CONFIG_KEY, DEFAULT_STAGE_CONFIG);
    this.bookingOrders = loadFromStorage(STORAGE_ORDERS_KEY, []);
    this.vendorSettings = loadFromStorage(STORAGE_VENDOR_SETTINGS_KEY, DEFAULT_VENDOR_SETTINGS);
    this.vendorSession = this.restoreSession();

    this.stageConfig.dmxState.sparkularActive = false;
    this.stageConfig.dmxState.beatSyncActive = false;
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(reason = 'update') {
    for (const fn of this.listeners) {
      fn(this, reason);
    }
  }

  isVendor() {
    return Boolean(this.vendorSession?.isLoggedIn);
  }

  restoreSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_SESSION_KEY) || 'null');
      const acc = saved && DEMO_VENDOR_ACCOUNTS.find((a) => a.username === saved.username);
      if (acc) return { isLoggedIn: true, username: acc.username, email: null, displayName: acc.displayName, authProvider: 'password' };
    } catch {
      // storage unavailable
    }
    return emptySession();
  }

  loginVendor(username, password) {
    const user = String(username || '').trim().toLowerCase();
    const acc = DEMO_VENDOR_ACCOUNTS.find((a) => a.username === user && a.password === String(password || ''));
    if (!acc) return { ok: false, error: 'Username atau password salah.' };
    this.vendorSession = {
      isLoggedIn: true,
      username: acc.username,
      email: null,
      displayName: acc.displayName,
      authProvider: 'password',
      loggedInAt: new Date().toISOString(),
    };
    try { localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify({ username: acc.username })); } catch { /* ignore */ }
    this.notify('auth');
    return { ok: true, session: this.vendorSession };
  }

  logoutVendor() {
    this.vendorSession = emptySession();
    try { localStorage.removeItem(STORAGE_SESSION_KEY); } catch { /* ignore */ }
    this.notify('auth');
  }

  createOrder(order) {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return {
      id: `ORD-${Date.now().toString().slice(-5)}${rand}`,
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      ...order,
    };
  }

  addBookingOrder(order) {
    const newOrder = this.createOrder(order);
    this.bookingOrders.unshift(newOrder);
    this.persist();
    this.notify('order');
    return newOrder;
  }

  updateOrderStatus(orderId, status) {
    if (!this.isVendor()) return false;
    const target = this.bookingOrders.find((o) => o.id === orderId);
    if (!target) return false;
    target.status = status;
    this.persist();
    this.notify('order');
    return true;
  }

  updateVendorSettings(companyName, whatsappNumber) {
    if (!this.isVendor()) return false;
    this.vendorSettings = {
      companyName: String(companyName || '').trim() || DEFAULT_VENDOR_SETTINGS.companyName,
      whatsappNumber: String(whatsappNumber || '').replace(/\D/g, '') || DEFAULT_VENDOR_SETTINGS.whatsappNumber,
    };
    this.persist();
    this.notify('vendorSettings');
    return true;
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_CATALOG_KEY, JSON.stringify(this.equipmentCatalog));
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(this.stageConfig));
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(this.bookingOrders));
      localStorage.setItem(STORAGE_VENDOR_SETTINGS_KEY, JSON.stringify(this.vendorSettings));
    } catch {
      // Ignore storage quota errors
    }
  }

  applyPreset(presetKey) {
    const preset = STAGE_PRESETS[presetKey];
    if (!preset) return;
    this.stageConfig.namaProyek = preset.namaProyek;
    this.stageConfig.ukuranPanggung = clone(preset.ukuranPanggung);
    this.stageConfig.tipePanggung = preset.tipePanggung;
    this.stageConfig.atapCanopy = preset.atapCanopy;
    this.stageConfig.ledBackdrop = preset.ledBackdrop;
    this.stageConfig.tiraiBukaan = preset.tiraiBukaan;
    this.stageConfig.counts = clone(preset.counts);
    Object.assign(this.stageConfig.dmxState, preset.dmxPatch);
    this.persist();
    this.notify('preset');
  }

  resetAll() {
    localStorage.removeItem(STORAGE_CATALOG_KEY);
    localStorage.removeItem(STORAGE_CONFIG_KEY);
    this.equipmentCatalog = clone(DEFAULT_EQUIPMENT);
    this.stageConfig = clone(DEFAULT_STAGE_CONFIG);
    this.persist();
    this.notify('reset');
  }
}

export const store = new StageStore();
