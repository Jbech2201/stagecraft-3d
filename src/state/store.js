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

function emptySession() {
  return { isLoggedIn: false, username: null, email: null, displayName: null, authProvider: null };
}

class StageStore {
  constructor() {
    this.equipmentCatalog = loadFromStorage(STORAGE_CATALOG_KEY, DEFAULT_EQUIPMENT);
    this.stageConfig = loadFromStorage(STORAGE_CONFIG_KEY, DEFAULT_STAGE_CONFIG);
    this.bookingOrders = loadFromStorage(STORAGE_ORDERS_KEY, []);
    this.vendorSettings = loadFromStorage(STORAGE_VENDOR_SETTINGS_KEY, DEFAULT_VENDOR_SETTINGS);
    // Vendor role is never trusted from localStorage: it is derived from the Supabase session + RLS.
    this.vendorSession = emptySession();

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

  /** Called only after the server confirmed the signed-in Google email is a registered vendor. */
  setVendorSession({ email, displayName }) {
    const mail = String(email || '').trim().toLowerCase();
    if (!mail || !mail.includes('@')) return { ok: false, error: 'Alamat email akun Google tidak valid.' };
    this.vendorSession = {
      isLoggedIn: true,
      username: mail.split('@')[0],
      email: mail,
      displayName: String(displayName || '').trim() || mail.split('@')[0],
      authProvider: 'google',
      loggedInAt: new Date().toISOString(),
    };
    this.notify('auth');
    return { ok: true, session: this.vendorSession };
  }

  logoutVendor() {
    this.vendorSession = emptySession();
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
