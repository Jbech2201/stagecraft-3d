import { DEFAULT_EQUIPMENT, STEPPABLE_MODELS } from '../data/catalog.js';
import * as cloud from '../lib/cloud.js';
import { computeBillOfQuantities, escapeHtml, formatRupiah } from '../utils/quotation.js';

export function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3200);
}

export class AppController {
  constructor(store, stageEngine, audioSynth) {
    this.store = store;
    this.engine = stageEngine;
    this.audioSynth = audioSynth;
    this.graphicHigh = true;
    this.autoOrbit = false;
    this.pendingDeleteId = null;
    this.pendingResetConfirm = false;
  }

  init() {
    this.bindEvents();
    this.syncUiFromConfig();
    this.syncRoleVisibility();
    this.renderEquipmentPicker();
    this.recalculateQuotation();
    this.initCloud();
  }

  /* ───────── Supabase (auth, catalog, orders) ───────── */
  async initCloud() {
    if (!cloud.cloudEnabled) return;
    try {
      const [settings, catalog] = await Promise.all([cloud.fetchVendorSettings(), cloud.fetchCatalog()]);
      if (settings) this.store.vendorSettings = settings;
      if (catalog.length) this.applyCatalog(catalog);
    } catch (err) {
      console.warn('[cloud] gagal memuat data awal:', err.message);
    }
    cloud.onAuthChange((event, session) => this.handleSession(event, session));
  }

  applyCatalog(catalog) {
    this.store.equipmentCatalog = catalog;
    this.renderEquipmentPicker();
    this.recalculateQuotation();
  }

  async handleSession(event, session) {
    if (!session) {
      this.lastUserId = null;
      this.stopOrdersLive?.();
      this.stopOrdersLive = null;
      if (this.store.isVendor()) {
        this.store.logoutVendor();
        this.syncRoleVisibility();
      }
      return;
    }
    if (this.lastUserId === session.user.id) return;
    this.lastUserId = session.user.id;

    const email = session.user.email || '';
    try {
      const vendor = await cloud.getVendor(email);
      if (!vendor) {
        this.lastUserId = null;
        await cloud.signOut();
        this.closeModal('vendor-login-modal');
        showToast(`${email} belum terdaftar sebagai penjual.`, true);
        return;
      }
      const meta = session.user.user_metadata || {};
      this.store.setVendorSession({ email, displayName: vendor.display_name || meta.full_name || meta.name });
      this.closeModal('vendor-login-modal');

      if (await cloud.seedCatalogIfEmpty(DEFAULT_EQUIPMENT)) {
        showToast('Katalog awal disimpan ke database.');
      }
      await this.refreshOrders();
      this.syncRoleVisibility();
      this.stopOrdersLive?.();
      this.stopOrdersLive = cloud.subscribeOrders(() => this.onOrdersChanged());
      if (event === 'SIGNED_IN') showToast(`Login berhasil sebagai ${email}.`);
    } catch (err) {
      this.lastUserId = null;
      showToast(`Gagal memverifikasi akun: ${err.message}`, true);
    }
  }

  async refreshOrders() {
    if (!cloud.cloudEnabled || !this.store.isVendor()) return;
    this.store.bookingOrders = await cloud.fetchOrders();
  }

  async onOrdersChanged() {
    try {
      await this.refreshOrders();
      this.syncRoleVisibility();
      if (document.getElementById('vendor-dashboard-modal')?.classList.contains('open')) {
        this.renderVendorDashboardData();
      }
    } catch (err) {
      console.warn('[cloud] gagal menyegarkan pesanan:', err.message);
    }
  }

  /** Runs a cloud write; shows a toast on failure. Returns true on success (or when cloud is off). */
  async cloudWrite(fn, failMsg) {
    if (!cloud.cloudEnabled) return true;
    try {
      await fn();
      return true;
    } catch (err) {
      showToast(`${failMsg}: ${err.message}`, true);
      return false;
    }
  }

  syncRoleVisibility() {
    const isVendor = this.store.isVendor();
    const sess = this.store.vendorSession;
    const roleBadge = document.getElementById('lbl-user-role');
    const statusAuthLbl = document.getElementById('status-auth-lbl');

    if (roleBadge) {
      roleBadge.className = `role-badge ${isVendor ? 'vendor' : 'guest'}`;
      if (isVendor) {
        const providerTag = sess.authProvider === 'google' ? 'Google' : 'Vendor';
        roleBadge.textContent = `Penjual (${providerTag}): ${sess.email || sess.username}`;
      } else {
        roleBadge.textContent = 'Mode: Konsumen';
      }
    }

    if (statusAuthLbl) {
      statusAuthLbl.textContent = isVendor
        ? `Sesi Penjual: ${sess.displayName || sess.username} (${sess.authProvider === 'google' ? 'Google OAuth' : 'Kredensial'})`
        : 'Sesi: Konsumen (Tanpa Login)';
    }

    document.getElementById('btn-account')?.classList.toggle('is-vendor', isVendor);

    document.querySelectorAll('[data-vendor-only]').forEach((el) => {
      el.classList.toggle('hidden', !isVendor);
    });
    document.querySelectorAll('[data-guest-only]').forEach((el) => {
      el.classList.toggle('hidden', isVendor);
    });

    if (isVendor) {
      const pending = this.store.bookingOrders.filter((o) => o.status === 'PENDING').length;
      const badge = document.getElementById('badge-pending-orders');
      if (badge) badge.textContent = `(${pending})`;
    } else {
      this.closeModal('crud-modal');
      this.closeModal('vendor-dashboard-modal');
    }
  }

  bindEvents() {
    // Stage Presets
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        document.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.store.applyPreset(key);
        this.syncUiFromConfig();
        this.engine.rebuildStage3D();
        this.renderEquipmentPicker();
        this.recalculateQuotation();
      });
    });

    // Hidden-by-default dock (opened from the icon rail)
    this.activePanel = null;
    document.querySelectorAll('[data-dock-open]').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleDock(btn.getAttribute('data-dock-open')));
    });
    document.querySelectorAll('[data-dock-close]').forEach((btn) => {
      btn.addEventListener('click', () => this.closeDock());
    });

    // Account / settings menu
    const accountBtn = document.getElementById('btn-account');
    const accountMenu = document.getElementById('account-menu');
    accountBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAccountMenu();
    });
    accountMenu?.addEventListener('click', (e) => {
      if (e.target.closest('.menu-item')) this.closeAccountMenu();
    });
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.menu-wrap')) this.closeAccountMenu();
    });

    // Stage Dimension & Type Inputs
    ['inp-project-name', 'sel-stage-type', 'rng-stage-width', 'rng-stage-depth', 'rng-stage-height'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => this.onStageParamChange());
    });

    // Canopy & LED Wall Toggles
    document.getElementById('tog-canopy')?.addEventListener('click', () => {
      this.store.stageConfig.atapCanopy = !this.store.stageConfig.atapCanopy;
      document.getElementById('tog-canopy').classList.toggle('active', this.store.stageConfig.atapCanopy);
      this.engine.rebuildStage3D();
      this.recalculateQuotation();
      this.store.persist();
    });

    document.getElementById('tog-ledwall')?.addEventListener('click', () => {
      this.store.stageConfig.ledBackdrop = !this.store.stageConfig.ledBackdrop;
      document.getElementById('tog-ledwall').classList.toggle('active', this.store.stageConfig.ledBackdrop);
      this.engine.rebuildStage3D();
      this.recalculateQuotation();
      this.store.persist();
    });

    // Curtain Controls
    document.getElementById('rng-curtain-open')?.addEventListener('input', (e) => {
      this.engine.curtainAnimTarget = null;
      this.store.stageConfig.tiraiBukaan = parseInt(e.target.value, 10);
      document.getElementById('val-curtain-open').textContent = `${this.store.stageConfig.tiraiBukaan}%`;
      this.engine.applyCurtainTransform(this.store.stageConfig.ukuranPanggung.lebar);
      this.store.persist();
    });

    document.getElementById('btn-curtain-open')?.addEventListener('click', () => this.engine.animateCurtainTo(100));
    document.getElementById('btn-curtain-close')?.addEventListener('click', () => this.engine.animateCurtainTo(0));
    document.getElementById('btn-goto-equip')?.addEventListener('click', () => {
      this.openDock('market');
    });

    // Equipment Stepper Delegation
    document.getElementById('equipment-picker-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step-model]');
      if (!btn) return;
      const modelKey = btn.getAttribute('data-step-model');
      const delta = parseInt(btn.getAttribute('data-step-delta'), 10);
      const maxStock = parseInt(btn.getAttribute('data-step-max'), 10);
      const cur = this.store.stageConfig.counts[modelKey] || 0;
      this.store.stageConfig.counts[modelKey] = Math.max(0, Math.min(maxStock, cur + delta));
      this.renderEquipmentPicker();
      this.engine.rebuildStage3D();
      this.recalculateQuotation();
      this.store.persist();
    });

    // Camera Presets & Auto Orbit
    document.querySelectorAll('[data-cam-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-cam-preset');
        this.activateCameraPreset(preset);
      });
    });

    document.getElementById('cam-orbit')?.addEventListener('click', (e) => {
      this.autoOrbit = !this.autoOrbit;
      e.currentTarget.classList.toggle('active', this.autoOrbit);
      this.engine.setAutoOrbit(this.autoOrbit);
    });

    document.getElementById('btn-reset-fixture')?.addEventListener('click', () => {
      this.engine.clearFixtureSelection();
      document.getElementById('lbl-selected-fixture').textContent = 'Semua Fixture (Master Group)';
    });

    // DMX Cue Buttons
    document.querySelectorAll('[data-dmx-cue]').forEach((btn) => {
      btn.addEventListener('click', () => this.setDmxCue(btn.getAttribute('data-dmx-cue')));
    });

    // DMX Manual Sliders
    ['rng-dmx-pan', 'rng-dmx-tilt'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        this.setDmxCue('MANUAL');
        this.onDmxParamChange();
      });
    });

    ['rng-dmx-dimmer', 'rng-dmx-strobe', 'rng-dmx-speed', 'rng-dmx-smoke'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => this.onDmxParamChange());
    });

    // Color Pickers & Swatches
    document.getElementById('clr-beam')?.addEventListener('input', (e) => this.setBeamColor(e.target.value));
    document.getElementById('clr-wash')?.addEventListener('input', (e) => {
      this.store.stageConfig.dmxState.washColor = e.target.value;
      this.engine.setWashColor(e.target.value);
      this.store.persist();
    });
    document.getElementById('clr-laser')?.addEventListener('input', (e) => {
      this.store.stageConfig.dmxState.laserColor = e.target.value;
      this.engine.setLaserColor(e.target.value);
      this.store.persist();
    });

    document.getElementById('beam-swatches')?.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-beam-color]');
      if (sw) this.setBeamColor(sw.getAttribute('data-beam-color'));
    });

    // FX & Beat Sync
    document.getElementById('btn-trigger-spark')?.addEventListener('click', (e) => {
      const dmx = this.store.stageConfig.dmxState;
      dmx.sparkularActive = !dmx.sparkularActive;
      e.currentTarget.classList.toggle('active', dmx.sparkularActive);
    });

    document.getElementById('btn-beat-sync')?.addEventListener('click', () => this.toggleBeatSync());

    // Graphic Quality
    document.getElementById('btn-quality')?.addEventListener('click', () => {
      this.graphicHigh = !this.graphicHigh;
      document.getElementById('lbl-quality').textContent = this.graphicHigh ? 'HIGH' : 'LOW';
      this.engine.setGraphicQuality(this.graphicHigh);
      showToast(`Resolusi render WebGL diubah ke ${this.graphicHigh ? 'HIGH' : 'LOW'}`);
    });

    // Rental Days & RAB
    document.getElementById('sel-rental-days')?.addEventListener('change', () => {
      this.recalculateQuotation();
      this.store.persist();
    });

    document.querySelectorAll('[data-open-rab]').forEach((btn) => {
      btn.addEventListener('click', () => this.openRabModal());
    });

    document.querySelectorAll('[data-order-wa]').forEach((btn) => {
      btn.addEventListener('click', () => this.orderViaWhatsApp());
    });

    document.getElementById('btn-print-rab')?.addEventListener('click', () => window.print());

    // Modal Closers & Backdrop Click + Escape Key
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => this.closeModal(btn.getAttribute('data-close-modal')));
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) {
          backdrop.classList.remove('open');
        }
      });
    });

    window.addEventListener('keydown', (e) => this.onGlobalKeyDown(e));

    // CRUD Inventory Modal (Vendor Only)
    document.getElementById('btn-open-crud')?.addEventListener('click', () => {
      if (!this.store.isVendor()) {
        showToast('Fitur ini khusus untuk Penjual / Vendor. Silakan login terlebih dahulu.', true);
        return;
      }
      this.pendingDeleteId = null;
      this.pendingResetConfirm = false;
      this.renderCrudTable();
      this.openModal('crud-modal');
    });
    document.getElementById('btn-crud-add')?.addEventListener('click', () => this.showCrudForm());
    document.getElementById('btn-crud-cancel')?.addEventListener('click', () => {
      document.getElementById('crud-form-box').classList.add('hidden');
    });
    document.getElementById('btn-crud-save')?.addEventListener('click', () => this.saveCrudItem());
    document.getElementById('btn-crud-reset')?.addEventListener('click', () => this.resetDefaultInventory());

    document.getElementById('crud-table-body')?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-crud-edit]');
      const delBtn = e.target.closest('[data-crud-delete]');
      if (editBtn) this.editCrudItem(editBtn.getAttribute('data-crud-edit'));
      if (delBtn) this.deleteCrudItem(delBtn.getAttribute('data-crud-delete'));
    });

    // Consumer Booking Submission
    document.getElementById('btn-submit-booking')?.addEventListener('click', () => this.submitConsumerBooking());

    // Vendor Auth (Password & Google Sign-In)
    document.getElementById('btn-open-vendor-login')?.addEventListener('click', () => {
      this.openModal('vendor-login-modal');
    });

    document.getElementById('btn-google-signin')?.addEventListener('click', async () => {
      if (!cloud.cloudEnabled) {
        showToast('Supabase belum dikonfigurasi (cek file .env).', true);
        return;
      }
      const lbl = document.getElementById('lbl-google-signin');
      if (lbl) lbl.textContent = 'Mengarahkan ke Google…';
      try {
        await cloud.signInWithGoogle();
      } catch (err) {
        if (lbl) lbl.textContent = 'Lanjutkan dengan Google';
        showToast(`Login gagal: ${err.message}`, true);
      }
    });

    document.getElementById('btn-vendor-logout')?.addEventListener('click', async () => {
      if (cloud.cloudEnabled) await cloud.signOut();
      this.store.logoutVendor();
      this.store.bookingOrders = [];
      this.syncRoleVisibility();
      showToast('Anda keluar dari Mode Penjual.');
    });

    document.getElementById('btn-open-vendor-dash')?.addEventListener('click', () => {
      if (!this.store.isVendor()) return;
      this.openVendorDashboard();
    });

    document.getElementById('btn-save-vendor-settings')?.addEventListener('click', async () => {
      if (!this.store.isVendor()) return;
      const company = document.getElementById('vendor-set-company').value;
      const wa = document.getElementById('vendor-set-wa').value;
      this.store.updateVendorSettings(company, wa);
      const ok = await this.cloudWrite(
        () => cloud.saveVendorSettings(this.store.vendorSettings),
        'Gagal menyimpan pengaturan'
      );
      if (ok) showToast('Identitas perusahaan & nomor WhatsApp vendor disimpan.');
    });

    document.getElementById('vendor-orders-tbody')?.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-order-status-id]');
      if (!sel || !this.store.isVendor()) return;
      const orderId = sel.getAttribute('data-order-status-id');
      this.store.updateOrderStatus(orderId, sel.value);
      const ok = await this.cloudWrite(() => cloud.updateOrderStatus(orderId, sel.value), 'Gagal mengubah status');
      if (!ok) await this.refreshOrders();
      this.renderVendorDashboardData();
      this.syncRoleVisibility();
      showToast(`Status order ${orderId} diperbarui ke ${sel.value}`);
    });

    // JSON Export / Import Modal
    document.getElementById('btn-open-json')?.addEventListener('click', () => {
      document.getElementById('json-textarea').value = JSON.stringify(this.store.stageConfig, null, 2);
      this.openModal('json-modal');
    });
    document.getElementById('btn-copy-json')?.addEventListener('click', () => {
      const ta = document.getElementById('json-textarea');
      ta.select();
      navigator.clipboard?.writeText(ta.value);
      showToast('JSON konfigurasi panggung disalin ke clipboard');
    });
    document.getElementById('btn-import-json')?.addEventListener('click', () => this.importJsonConfig());
  }

  completeGoogleLogin(email, displayName) {
    const res = this.store.loginVendorWithGoogle({ email, displayName });
    if (res.ok) {
      this.closeModal('vendor-login-modal');
      this.syncRoleVisibility();
      showToast(`Login Google berhasil sebagai ${res.session.email}`);
    } else {
      showToast(res.error, true);
    }
  }

  toggleDock(name) {
    if (this.activePanel === name) this.closeDock();
    else this.openDock(name);
  }

  openDock(name) {
    this.activePanel = name;
    document.querySelectorAll('.dock-panel').forEach((p) => {
      p.hidden = p.getAttribute('data-panel') !== name;
    });
    document.querySelectorAll('.rail-btn[data-dock-open]').forEach((b) => {
      const on = b.getAttribute('data-dock-open') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-expanded', String(on));
    });
    document.getElementById('dock')?.classList.add('open');
  }

  closeDock() {
    this.activePanel = null;
    document.getElementById('dock')?.classList.remove('open');
    document.querySelectorAll('.rail-btn[data-dock-open]').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-expanded', 'false');
    });
  }

  toggleAccountMenu() {
    const menu = document.getElementById('account-menu');
    const open = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    document.getElementById('btn-account')?.setAttribute('aria-expanded', String(open));
  }

  closeAccountMenu() {
    document.getElementById('account-menu')?.classList.add('hidden');
    document.getElementById('btn-account')?.setAttribute('aria-expanded', 'false');
  }

  activateCameraPreset(preset) {
    document.querySelectorAll('[data-cam-preset]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-cam-preset') === preset);
    });
    this.engine.setCameraPreset(preset);
  }

  toggleBeatSync() {
    const dmx = this.store.stageConfig.dmxState;
    dmx.beatSyncActive = !dmx.beatSyncActive;
    const btn = document.getElementById('btn-beat-sync');
    if (btn) {
      btn.classList.toggle('active', dmx.beatSyncActive);
      const lbl = btn.querySelector('.lbl');
      if (lbl) lbl.textContent = dmx.beatSyncActive ? 'Stop beat sync' : 'Beat sync';
    }
    if (dmx.beatSyncActive) {
      this.audioSynth.start();
    } else {
      this.audioSynth.stop();
    }
  }

  onGlobalKeyDown(e) {
    if (e.key === 'Escape') {
      const openModals = document.querySelectorAll('.modal-backdrop.open');
      if (openModals.length) {
        openModals.forEach((m) => m.classList.remove('open'));
      } else if (!document.getElementById('account-menu')?.classList.contains('hidden')) {
        this.closeAccountMenu();
      } else {
        this.closeDock();
      }
      return;
    }

    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.modal-backdrop.open')) return;

    if (e.key === '1') this.activateCameraPreset('foh');
    else if (e.key === '2') this.activateCameraPreset('bird');
    else if (e.key === '3') this.activateCameraPreset('front');
    else if (e.key === '4') this.activateCameraPreset('side');
    else if (e.key === ' ' && tag !== 'BUTTON') {
      e.preventDefault();
      this.toggleBeatSync();
    }
  }

  onStageParamChange() {
    const cfg = this.store.stageConfig;
    cfg.namaProyek = document.getElementById('inp-project-name').value;
    cfg.tipePanggung = document.getElementById('sel-stage-type').value;
    cfg.ukuranPanggung.lebar = parseFloat(document.getElementById('rng-stage-width').value);
    cfg.ukuranPanggung.panjang = parseFloat(document.getElementById('rng-stage-depth').value);
    cfg.ukuranPanggung.tinggi = parseFloat(document.getElementById('rng-stage-height').value);

    document.getElementById('val-stage-width').textContent = `${cfg.ukuranPanggung.lebar} m`;
    document.getElementById('val-stage-depth').textContent = `${cfg.ukuranPanggung.panjang} m`;
    document.getElementById('val-stage-height').textContent = `${cfg.ukuranPanggung.tinggi} m`;

    const statusProj = document.getElementById('status-project-lbl');
    if (statusProj) statusProj.textContent = cfg.namaProyek;

    this.engine.rebuildStage3D();
    this.recalculateQuotation();
    this.store.persist();
  }

  setDmxCue(mode) {
    this.store.stageConfig.dmxState.cueMode = mode;
    document.querySelectorAll('[data-dmx-cue]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-dmx-cue') === mode);
    });
    document.getElementById('lbl-dmx-mode-badge').textContent = `MODE: ${mode}`;
    this.store.persist();
  }

  onDmxParamChange() {
    const dmx = this.store.stageConfig.dmxState;
    dmx.panDeg = parseInt(document.getElementById('rng-dmx-pan').value, 10);
    dmx.tiltDeg = parseInt(document.getElementById('rng-dmx-tilt').value, 10);
    dmx.dimmer = parseInt(document.getElementById('rng-dmx-dimmer').value, 10);
    dmx.strobeHz = parseInt(document.getElementById('rng-dmx-strobe').value, 10);
    dmx.speed = parseFloat(document.getElementById('rng-dmx-speed').value);
    dmx.smokeLevel = parseInt(document.getElementById('rng-dmx-smoke').value, 10);

    document.getElementById('val-dmx-pan').textContent = `${dmx.panDeg}°`;
    document.getElementById('val-dmx-tilt').textContent = `${dmx.tiltDeg}°`;
    document.getElementById('val-dmx-dimmer').textContent = `${dmx.dimmer}%`;
    document.getElementById('val-dmx-strobe').textContent = `${dmx.strobeHz} Hz`;
    document.getElementById('val-dmx-speed').textContent = `${dmx.speed.toFixed(1)}x`;
    document.getElementById('val-dmx-smoke').textContent = `${dmx.smokeLevel}%`;

    this.store.persist();
  }

  setBeamColor(hex) {
    this.store.stageConfig.dmxState.primaryColor = hex;
    document.getElementById('clr-beam').value = hex;
    document.querySelectorAll('#beam-swatches [data-beam-color]').forEach((sw) => {
      sw.classList.toggle('active', sw.getAttribute('data-beam-color') === hex);
    });
    this.engine.setBeamColor(hex);
    this.store.persist();
  }

  syncUiFromConfig() {
    const cfg = this.store.stageConfig;
    document.getElementById('inp-project-name').value = cfg.namaProyek;
    document.getElementById('sel-stage-type').value = cfg.tipePanggung;
    document.getElementById('rng-stage-width').value = cfg.ukuranPanggung.lebar;
    document.getElementById('rng-stage-depth').value = cfg.ukuranPanggung.panjang;
    document.getElementById('rng-stage-height').value = cfg.ukuranPanggung.tinggi;

    document.getElementById('val-stage-width').textContent = `${cfg.ukuranPanggung.lebar} m`;
    document.getElementById('val-stage-depth').textContent = `${cfg.ukuranPanggung.panjang} m`;
    document.getElementById('val-stage-height').textContent = `${cfg.ukuranPanggung.tinggi} m`;

    const statusProj = document.getElementById('status-project-lbl');
    if (statusProj) statusProj.textContent = cfg.namaProyek;

    document.getElementById('tog-canopy').classList.toggle('active', cfg.atapCanopy);
    document.getElementById('tog-ledwall').classList.toggle('active', cfg.ledBackdrop);
    document.getElementById('rng-curtain-open').value = cfg.tiraiBukaan;
    document.getElementById('val-curtain-open').textContent = `${cfg.tiraiBukaan}%`;

    const dmx = cfg.dmxState;
    document.getElementById('rng-dmx-pan').value = dmx.panDeg;
    document.getElementById('rng-dmx-tilt').value = dmx.tiltDeg;
    document.getElementById('rng-dmx-dimmer').value = dmx.dimmer;
    document.getElementById('rng-dmx-strobe').value = dmx.strobeHz;
    document.getElementById('rng-dmx-speed').value = dmx.speed;
    document.getElementById('rng-dmx-smoke').value = dmx.smokeLevel;

    document.getElementById('val-dmx-pan').textContent = `${dmx.panDeg}°`;
    document.getElementById('val-dmx-tilt').textContent = `${dmx.tiltDeg}°`;
    document.getElementById('val-dmx-dimmer').textContent = `${dmx.dimmer}%`;
    document.getElementById('val-dmx-strobe').textContent = `${dmx.strobeHz} Hz`;
    document.getElementById('val-dmx-speed').textContent = `${dmx.speed}x`;
    document.getElementById('val-dmx-smoke').textContent = `${dmx.smokeLevel}%`;

    document.getElementById('clr-beam').value = dmx.primaryColor;
    document.getElementById('clr-wash').value = dmx.washColor;
    document.getElementById('clr-laser').value = dmx.laserColor;

    this.setDmxCue(dmx.cueMode);
  }

  renderEquipmentPicker() {
    const container = document.getElementById('equipment-picker-list');
    const items = this.store.equipmentCatalog.filter(
      (eq) => STEPPABLE_MODELS.includes(eq.tipeModel) || eq.isCustom
    );

    container.innerHTML = items
      .map((eq) => {
        const modelKey = eq.tipeModel;
        const currentQty = this.store.stageConfig.counts[modelKey] || 0;
        const stepSize = eq.tipeModel === 'line_array_box' ? 2 : 1;
        const safeName = escapeHtml(eq.nama);
        const safeCat = escapeHtml(eq.kategori);
        const safeUnit = escapeHtml(eq.satuan);

        return `
        <div class="equip">
          <div class="equip-main">
            <div class="equip-name">${safeName}</div>
            <div class="equip-sub">
              <span class="tag cat-${safeCat}">${safeCat}</span>
              <span>${eq.wattPower} W · stok ${eq.stokTersedia} ${safeUnit}</span>
            </div>
            <div class="equip-price">${formatRupiah(eq.hargaSewaHarian)} <small>/ hari</small></div>
          </div>
          <div class="stepper">
            <button type="button" class="btn-step" data-step-model="${escapeHtml(modelKey)}" data-step-delta="-${stepSize}" data-step-max="${eq.stokTersedia}" aria-label="Kurangi ${safeName}">−</button>
            <span class="step-count">${currentQty}</span>
            <button type="button" class="btn-step" data-step-model="${escapeHtml(modelKey)}" data-step-delta="${stepSize}" data-step-max="${eq.stokTersedia}" aria-label="Tambah ${safeName}">+</button>
          </div>
        </div>
      `;
      })
      .join('');
  }

  recalculateQuotation() {
    const daysEl = document.getElementById('sel-rental-days');
    if (daysEl) {
      this.store.stageConfig.rentalDays = parseInt(daysEl.value, 10) || 1;
    }

    const q = computeBillOfQuantities(this.store.stageConfig, this.store.equipmentCatalog);

    document.getElementById('lbl-power-watt').textContent = `${q.totalWatt.toLocaleString('id-ID')} W (${q.totalKva} kVA)`;
    document.getElementById('lbl-genset-rec').textContent = q.gensetRec;
    const pct = Math.min(100, Math.round((q.totalKva / 80) * 100));
    document.getElementById('power-bar-fill').style.width = `${pct}%`;

    document.getElementById('boq-mini-list').innerHTML = q.boqItems
      .map(
        (it) => `
      <div class="boq-mini-row">
        <div>
          <div class="name">${escapeHtml(it.nama)}</div>
          <div class="meta">${it.jumlah} ${escapeHtml(it.satuan)} · ${it.totalWattItem.toLocaleString('id-ID')} W</div>
        </div>
        <div class="sub">${formatRupiah(it.subtotalHarian)}</div>
      </div>
    `
      )
      .join('');

    document.getElementById('lbl-daily-total').textContent = formatRupiah(q.dailyTotal);
    document.getElementById('lbl-grand-total').textContent = formatRupiah(q.grandTotal);
    const hudTotal = document.getElementById('hud-total');
    if (hudTotal) hudTotal.textContent = formatRupiah(q.grandTotal);

    const c = this.store.stageConfig.counts;
    const row = (label, val) => `<div class="summary-row"><span>${label}</span><strong>${val}</strong></div>`;
    document.getElementById('quick-fixture-summary').innerHTML =
      row('Moving head beam', `${c.moving_head_beam || 0} unit`) +
      row('PAR LED wash', `${c.par_led_wash || 0} unit`) +
      row('Strobe blinder', `${c.strobe_blinder || 0} unit`) +
      row('Laser RGB', `${c.laser_rgb || 0} unit`) +
      row('Cold sparkular', `${c.cold_sparkular || 0} unit`) +
      row('Line array', `${c.line_array_box || 0} box`) +
      row('Subwoofer', `${c.subwoofer_dual18 || 0} unit`);

    const totalFixtures =
      (c.moving_head_beam || 0) +
      (c.par_led_wash || 0) +
      (c.strobe_blinder || 0) +
      (c.laser_rgb || 0) +
      (c.line_array_box || 0) +
      (c.subwoofer_dual18 || 0) +
      (c.cold_sparkular || 0);

    document.getElementById('hud-area').textContent = `${q.totalStageArea} m²`;
    document.getElementById('hud-fixtures').textContent = `${totalFixtures} Unit`;
    document.getElementById('hud-kva').textContent = `${q.totalKva} kVA`;
  }

  openModal(id) {
    document.getElementById(id)?.classList.add('open');
  }

  closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  openRabModal() {
    const q = computeBillOfQuantities(this.store.stageConfig, this.store.equipmentCatalog);
    const { lebar: W, panjang: D, tinggi: H } = this.store.stageConfig.ukuranPanggung;

    document.getElementById('rab-summary-header').innerHTML = `
      <div>
        <div class="k">Proyek / acara</div>
        <div class="v">${escapeHtml(this.store.stageConfig.namaProyek)}</div>
        <div class="s">${W} m × ${D} m × ${H} m · ${q.totalStageArea} m²</div>
      </div>
      <div>
        <div class="k">Kebutuhan daya</div>
        <div class="v">${q.totalWatt.toLocaleString('id-ID')} W (${q.totalKva} kVA)</div>
        <div class="s warn">${escapeHtml(q.gensetRec)}</div>
      </div>
      <div style="text-align:right;">
        <div class="k">Grand total · ${q.rentalDays} hari</div>
        <div class="total">${formatRupiah(q.grandTotal)}</div>
      </div>
    `;

    document.getElementById('rab-table-body').innerHTML = q.boqItems
      .map(
        (it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(it.nama)}</strong></td>
        <td><span class="tag cat-${escapeHtml(it.kategori)}">${escapeHtml(it.kategori)}</span></td>
        <td>${it.jumlah} ${escapeHtml(it.satuan)}</td>
        <td>${it.totalWattItem.toLocaleString('id-ID')} W</td>
        <td>${formatRupiah(it.hargaSatuan)}</td>
        <td><strong>${formatRupiah(it.subtotalHarian)}</strong></td>
      </tr>
    `
      )
      .join('');

    this.openModal('rab-modal');
  }

  orderViaWhatsApp() {
    const q = computeBillOfQuantities(this.store.stageConfig, this.store.equipmentCatalog);
    const clientName = document.getElementById('rab-client-name')?.value || 'EO Partner';
    const eventDate = document.getElementById('rab-event-date')?.value || '2026-12-15';
    const { lebar: W, panjang: D, tinggi: H } = this.store.stageConfig.ukuranPanggung;
    const vendor = this.store.vendorSettings;

    const itemLines = q.boqItems
      .map((it) => `- ${it.nama}: ${it.jumlah} ${it.satuan} (${formatRupiah(it.subtotalHarian)}/hr)`)
      .join('\n');

    const text =
      `Halo Tim *${vendor.companyName}*,\n` +
      `Saya *${clientName}* ingin mengajukan pemesanan sewa produksi panggung 3D:\n\n` +
      `*Nama Acara:* ${this.store.stageConfig.namaProyek}\n` +
      `*Tanggal:* ${eventDate} (${q.rentalDays} Hari)\n` +
      `*Ukuran Panggung:* ${W}m x ${D}m x ${H}m (${q.totalStageArea} m²)\n` +
      `*Total Daya Listrik:* ${q.totalWatt.toLocaleString('id-ID')} W (${q.totalKva} kVA - ${q.gensetRec})\n\n` +
      `*Rincian Peralatan:*\n${itemLines}\n\n` +
      `*Total Estimasi RAB (${q.rentalDays} Hari):* ${formatRupiah(q.grandTotal)}\n` +
      `*(Data Simulasi Demo StageCraft 3D)*`;

    window.open(
      `https://wa.me/${vendor.whatsappNumber}?text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  async submitConsumerBooking() {
    const q = computeBillOfQuantities(this.store.stageConfig, this.store.equipmentCatalog);
    const clientName = document.getElementById('rab-client-name')?.value.trim() || 'Konsumen Event';
    const clientPhone = document.getElementById('rab-client-phone')?.value.trim() || '-';
    const eventDate = document.getElementById('rab-event-date')?.value || '2026-12-15';
    const { lebar: W, panjang: D, tinggi: H } = this.store.stageConfig.ukuranPanggung;

    const payload = {
      clientName,
      clientPhone,
      eventName: this.store.stageConfig.namaProyek,
      eventDate,
      rentalDays: q.rentalDays,
      stageSummary: `${W}m × ${D}m × ${H}m (${q.totalStageArea} m²)`,
      powerSummary: `${q.totalKva} kVA (${q.gensetRec})`,
      grandTotal: q.grandTotal,
    };

    const btn = document.getElementById('btn-submit-booking');
    let order;
    if (cloud.cloudEnabled) {
      order = this.store.createOrder(payload);
      if (btn) btn.disabled = true;
      const ok = await this.cloudWrite(() => cloud.insertOrder(order), 'Pengajuan gagal terkirim');
      if (btn) btn.disabled = false;
      if (!ok) return;
      if (this.store.isVendor()) await this.refreshOrders();
    } else {
      order = this.store.addBookingOrder(payload);
    }

    if (this.store.isVendor()) this.syncRoleVisibility();
    this.closeModal('rab-modal');
    showToast(`Pengajuan sewa ${order.id} terkirim ke Penjual! Status: PENDING.`);
  }

  async openVendorDashboard() {
    if (!this.store.isVendor()) return;
    try {
      await this.refreshOrders();
    } catch (err) {
      showToast(`Gagal memuat pesanan: ${err.message}`, true);
    }
    document.getElementById('vendor-set-company').value = this.store.vendorSettings.companyName;
    document.getElementById('vendor-set-wa').value = this.store.vendorSettings.whatsappNumber;
    this.renderVendorDashboardData();
    this.openModal('vendor-dashboard-modal');
  }

  renderVendorDashboardData() {
    const orders = this.store.bookingOrders;
    const pendingCount = orders.filter((o) => o.status === 'PENDING').length;
    const approvedRevenue = orders
      .filter((o) => o.status === 'APPROVED' || o.status === 'COMPLETED')
      .reduce((acc, o) => acc + (Number(o.grandTotal) || 0), 0);

    document.getElementById('vendor-stat-total').textContent = String(orders.length);
    document.getElementById('vendor-stat-pending').textContent = String(pendingCount);
    document.getElementById('vendor-stat-revenue').textContent = formatRupiah(approvedRevenue);

    const tbody = document.getElementById('vendor-orders-tbody');
    if (orders.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty">
            Belum ada pengajuan sewa. Konsumen mengajukan booking dari Dokumen RAB.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = orders
      .map(
        (ord) => `
      <tr>
        <td class="mono-id">${escapeHtml(ord.id)}</td>
        <td>
          <strong>${escapeHtml(ord.clientName)}</strong>
          <div class="sub-line">${escapeHtml(ord.eventName)} · ${escapeHtml(ord.clientPhone)}</div>
        </td>
        <td>${escapeHtml(ord.eventDate)}<div class="sub-line">${ord.rentalDays} hari</div></td>
        <td>${escapeHtml(ord.stageSummary)}<div class="sub-line">${escapeHtml(ord.powerSummary)}</div></td>
        <td><strong>${formatRupiah(ord.grandTotal)}</strong></td>
        <td><span class="status-pill status-${escapeHtml(ord.status)}">${escapeHtml(ord.status)}</span></td>
        <td>
          <select class="select-input select-compact" data-order-status-id="${escapeHtml(ord.id)}" aria-label="Ubah status order ${escapeHtml(ord.id)}">
            <option value="PENDING" ${ord.status === 'PENDING' ? 'selected' : ''}>PENDING</option>
            <option value="APPROVED" ${ord.status === 'APPROVED' ? 'selected' : ''}>APPROVED</option>
            <option value="COMPLETED" ${ord.status === 'COMPLETED' ? 'selected' : ''}>COMPLETED</option>
            <option value="REJECTED" ${ord.status === 'REJECTED' ? 'selected' : ''}>REJECTED</option>
          </select>
        </td>
      </tr>
    `
      )
      .join('');
  }

  renderCrudTable() {
    document.getElementById('crud-table-body').innerHTML = this.store.equipmentCatalog
      .map((eq) => {
        const isConfirming = this.pendingDeleteId === eq.id;
        return `
      <tr>
        <td><strong>${escapeHtml(eq.nama)}</strong></td>
        <td><span class="tag cat-${escapeHtml(eq.kategori)}">${escapeHtml(eq.kategori)}</span></td>
        <td>${escapeHtml(eq.satuan)}</td>
        <td>${eq.wattPower.toLocaleString('id-ID')} W</td>
        <td>${formatRupiah(eq.hargaSewaHarian)}</td>
        <td>${eq.stokTersedia}</td>
        <td>
          <div class="cell-actions">
            <button type="button" class="btn btn-sm" data-crud-edit="${escapeHtml(eq.id)}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-crud-delete="${escapeHtml(eq.id)}">
              ${isConfirming ? 'Yakin hapus?' : 'Hapus'}
            </button>
          </div>
        </td>
      </tr>
    `;
      })
      .join('');
  }

  showCrudForm() {
    document.getElementById('crud-id').value = '';
    document.getElementById('crud-nama').value = '';
    document.getElementById('crud-kategori').value = 'LIGHTING';
    document.getElementById('crud-watt').value = 300;
    document.getElementById('crud-harga').value = 350000;
    document.getElementById('crud-stok').value = 12;
    document.getElementById('crud-form-title').textContent = 'Tambah Alat Rental Baru';
    document.getElementById('crud-form-box').classList.remove('hidden');
  }

  editCrudItem(id) {
    const eq = this.store.equipmentCatalog.find((x) => x.id === id);
    if (!eq) return;
    document.getElementById('crud-id').value = eq.id;
    document.getElementById('crud-nama').value = eq.nama;
    document.getElementById('crud-kategori').value = eq.kategori;
    document.getElementById('crud-watt').value = eq.wattPower;
    document.getElementById('crud-harga').value = eq.hargaSewaHarian;
    document.getElementById('crud-stok').value = eq.stokTersedia;
    document.getElementById('crud-form-title').textContent = `Edit Alat: ${eq.nama}`;
    document.getElementById('crud-form-box').classList.remove('hidden');
  }

  async saveCrudItem() {
    if (!this.store.isVendor()) return;
    const id = document.getElementById('crud-id').value;
    const nama = document.getElementById('crud-nama').value.trim();
    const kategori = document.getElementById('crud-kategori').value;
    const wattPower = Math.max(0, parseInt(document.getElementById('crud-watt').value, 10) || 0);
    const hargaSewaHarian = Math.max(0, parseInt(document.getElementById('crud-harga').value, 10) || 0);
    const stokTersedia = Math.max(1, parseInt(document.getElementById('crud-stok').value, 10) || 1);

    if (!nama) {
      showToast('Nama peralatan wajib diisi.', true);
      return;
    }

    let saved;
    if (id) {
      const idx = this.store.equipmentCatalog.findIndex((x) => x.id === id);
      if (idx !== -1) {
        Object.assign(this.store.equipmentCatalog[idx], {
          nama,
          kategori,
          wattPower,
          hargaSewaHarian,
          stokTersedia,
        });
        saved = this.store.equipmentCatalog[idx];
      }
    } else {
      const customKey = `custom_${Date.now()}`;
      saved = {
        id: `eq-${Date.now()}`,
        nama,
        kategori,
        tipeModel: customKey,
        satuan: 'unit',
        wattPower,
        hargaSewaHarian,
        stokTersedia,
        spesifikasi: 'Custom Production Equipment',
        isCustom: true,
      };
      this.store.equipmentCatalog.push(saved);
      this.store.stageConfig.counts[customKey] = 2;
    }

    this.store.persist();
    if (saved) await this.cloudWrite(() => cloud.upsertEquipment(saved), 'Gagal menyimpan ke database');
    this.renderCrudTable();
    document.getElementById('crud-form-box').classList.add('hidden');
    this.renderEquipmentPicker();
    this.recalculateQuotation();
    showToast('Data inventori berhasil disimpan');
  }

  async deleteCrudItem(id) {
    if (!this.store.isVendor()) return;
    if (this.pendingDeleteId !== id) {
      this.pendingDeleteId = id;
      this.renderCrudTable();
      showToast('Klik sekali lagi tombol "Konfirmasi Hapus?" untuk menghapus item.');
      return;
    }
    this.pendingDeleteId = null;
    this.store.equipmentCatalog = this.store.equipmentCatalog.filter((x) => x.id !== id);
    this.store.persist();
    await this.cloudWrite(() => cloud.deleteEquipment(id), 'Gagal menghapus dari database');
    this.renderCrudTable();
    this.renderEquipmentPicker();
    this.recalculateQuotation();
    showToast('Item inventori berhasil dihapus');
  }

  async resetDefaultInventory() {
    if (!this.store.isVendor()) return;
    const btn = document.getElementById('btn-crud-reset');
    if (!this.pendingResetConfirm) {
      this.pendingResetConfirm = true;
      if (btn) btn.textContent = 'Yakin reset?';
      showToast('Klik sekali lagi "Konfirmasi Reset?" untuk mengembalikan seluruh data bawaan.');
      setTimeout(() => {
        this.pendingResetConfirm = false;
        if (btn) btn.textContent = 'Reset default';
      }, 3500);
      return;
    }
    this.pendingResetConfirm = false;
    if (btn) btn.textContent = 'Reset default';
    this.store.resetAll();
    await this.cloudWrite(() => cloud.resetCatalog(this.store.equipmentCatalog), 'Gagal reset database');
    this.syncUiFromConfig();
    this.renderCrudTable();
    this.renderEquipmentPicker();
    this.engine.rebuildStage3D();
    this.recalculateQuotation();
    showToast('Inventori & konfigurasi di-reset ke bawaan');
  }

  importJsonConfig() {
    try {
      const parsed = JSON.parse(document.getElementById('json-textarea').value);
      if (parsed && parsed.ukuranPanggung && parsed.counts) {
        this.store.stageConfig = parsed;
        this.store.persist();
        this.syncUiFromConfig();
        this.renderEquipmentPicker();
        this.engine.rebuildStage3D();
        this.recalculateQuotation();
        this.closeModal('json-modal');
        showToast('Konfigurasi JSON berhasil dimuat');
      } else {
        showToast('Format JSON tidak sesuai struktur StageConfiguration', true);
      }
    } catch (err) {
      showToast(`JSON tidak valid: ${err.message}`, true);
    }
  }
}
