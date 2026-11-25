import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_VENDOR_CREDENTIALS, store } from '../src/state/store.js';

describe('Role-Based User System (Consumer Guest vs Vendor Auth & Google Sign-In)', () => {
  beforeEach(() => {
    store.logoutVendor();
    store.bookingOrders = [];
  });

  it('starts in Consumer mode without login and blocks vendor-only mutations', () => {
    expect(store.isVendor()).toBe(false);

    // Consumer CAN submit a booking order without logging in
    const order = store.addBookingOrder({
      clientName: 'EO Merdeka',
      eventName: 'Konser Rakyat',
      grandTotal: 15000000,
    });
    expect(order.status).toBe('PENDING');
    expect(store.bookingOrders).toHaveLength(1);

    // Consumer CANNOT update order status or vendor settings
    expect(store.updateOrderStatus(order.id, 'APPROVED')).toBe(false);
    expect(store.bookingOrders[0].status).toBe('PENDING');
    expect(store.updateVendorSettings('Fake Vendor', '628000')).toBe(false);
  });

  it('rejects invalid vendor credentials and unlocks vendor features on valid login', () => {
    const bad = store.loginVendor('vendor', 'wrongpass');
    expect(bad.ok).toBe(false);
    expect(store.isVendor()).toBe(false);

    const good = store.loginVendor(
      DEMO_VENDOR_CREDENTIALS.username,
      DEMO_VENDOR_CREDENTIALS.password
    );
    expect(good.ok).toBe(true);
    expect(store.isVendor()).toBe(true);
    expect(store.vendorSession.authProvider).toBe('password');

    const order = store.addBookingOrder({ clientName: 'EO Jaya', grandTotal: 20000000 });
    expect(store.updateOrderStatus(order.id, 'APPROVED')).toBe(true);
    expect(store.bookingOrders[0].status).toBe('APPROVED');

    expect(store.updateVendorSettings('CV Cahaya Panggung', '628999888777')).toBe(true);
    expect(store.vendorSettings.companyName).toBe('CV Cahaya Panggung');
    expect(store.vendorSettings.whatsappNumber).toBe('628999888777');

    store.logoutVendor();
    expect(store.isVendor()).toBe(false);
  });

  it('authenticates Vendor using Google Account Sign-In and validates email format', () => {
    const invalidGoogle = store.loginVendorWithGoogle({ email: 'not-an-email' });
    expect(invalidGoogle.ok).toBe(false);
    expect(store.isVendor()).toBe(false);

    const validGoogle = store.loginVendorWithGoogle({
      email: 'production@stagerentalpro.id',
      displayName: 'StageRental Pro Official',
    });
    expect(validGoogle.ok).toBe(true);
    expect(store.isVendor()).toBe(true);
    expect(store.vendorSession.authProvider).toBe('google');
    expect(store.vendorSession.email).toBe('production@stagerentalpro.id');
  });
});
