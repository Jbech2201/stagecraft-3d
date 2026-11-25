import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../src/state/store.js';
import { orderToRow, rowToOrder } from '../src/lib/cloud.js';

describe('Role-based access (Consumer vs Vendor via verified Google session)', () => {
  beforeEach(() => {
    store.logoutVendor();
    store.bookingOrders = [];
  });

  it('starts as Consumer and blocks vendor-only mutations', () => {
    expect(store.isVendor()).toBe(false);

    const order = store.addBookingOrder({ clientName: 'EO Merdeka', eventName: 'Konser Rakyat', grandTotal: 15000000 });
    expect(order.status).toBe('PENDING');
    expect(store.bookingOrders).toHaveLength(1);

    expect(store.updateOrderStatus(order.id, 'APPROVED')).toBe(false);
    expect(store.bookingOrders[0].status).toBe('PENDING');
    expect(store.updateVendorSettings('Fake Vendor', '628000')).toBe(false);
  });

  it('unlocks vendor features only after the verified vendor session is set', () => {
    const bad = store.setVendorSession({ email: 'not-an-email' });
    expect(bad.ok).toBe(false);
    expect(store.isVendor()).toBe(false);

    const good = store.setVendorSession({ email: 'Owner@Example.com', displayName: 'Owner' });
    expect(good.ok).toBe(true);
    expect(store.isVendor()).toBe(true);
    expect(store.vendorSession.authProvider).toBe('google');
    expect(store.vendorSession.email).toBe('owner@example.com');

    const order = store.addBookingOrder({ clientName: 'EO Jaya', grandTotal: 20000000 });
    expect(store.updateOrderStatus(order.id, 'APPROVED')).toBe(true);
    expect(store.updateVendorSettings('CV Cahaya Panggung', '628999888777')).toBe(true);
    expect(store.vendorSettings.whatsappNumber).toBe('628999888777');

    store.logoutVendor();
    expect(store.isVendor()).toBe(false);
  });

  it('generates unique order ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => store.createOrder({}).id));
    expect(ids.size).toBe(200);
  });
});

describe('Order <-> database row mapping', () => {
  const order = {
    id: 'ORD-1', clientName: 'A', clientPhone: '08', eventName: 'E', eventDate: '2026-12-15',
    rentalDays: 2, stageSummary: '14m', powerSummary: '24 kVA', grandTotal: 1234567.6, status: 'APPROVED',
  };

  it('always inserts as PENDING (status cannot be forged from the client)', () => {
    const row = orderToRow(order);
    expect(row.status).toBe('PENDING');
    expect(row.grand_total).toBe(1234568);
  });

  it('round-trips fields', () => {
    const back = rowToOrder({ ...orderToRow(order), created_at: '2026-01-01T00:00:00Z' });
    expect(back).toMatchObject({ id: 'ORD-1', clientName: 'A', rentalDays: 2, status: 'PENDING' });
  });
});
