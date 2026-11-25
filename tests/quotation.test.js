import { describe, expect, it } from 'vitest';
import { DEFAULT_EQUIPMENT, DEFAULT_STAGE_CONFIG } from '../src/data/catalog.js';
import { computeBillOfQuantities, escapeHtml } from '../src/utils/quotation.js';

describe('computeBillOfQuantities', () => {
  it('calculates stage area, electrical kVA (PF 0.8), genset recommendation, and totals', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_STAGE_CONFIG));
    config.ukuranPanggung = { lebar: 14, panjang: 9, tinggi: 1.2 };
    config.tipePanggung = 'festival_truss';
    config.ledBackdrop = true;
    config.rentalDays = 2;

    const q = computeBillOfQuantities(config, DEFAULT_EQUIPMENT);

    expect(q.totalStageArea).toBe(126);
    expect(q.totalWatt).toBeGreaterThan(20000);
    expect(q.totalKva).toBe(Number((q.totalWatt / 1000 / 0.8).toFixed(1)));
    expect(q.totalKva).toBeGreaterThan(60);
    expect(q.gensetRec).toBe('Genset Silent 100 kVA');
    expect(q.grandTotal).toBe(q.dailyTotal * 2);
  });

  it('adds 14m2 catwalk area when tipePanggung is catwalk_t and excludes truss for indoor_ballroom', () => {
    const catwalkCfg = JSON.parse(JSON.stringify(DEFAULT_STAGE_CONFIG));
    catwalkCfg.ukuranPanggung = { lebar: 10, panjang: 6, tinggi: 1.0 };
    catwalkCfg.tipePanggung = 'catwalk_t';
    const qCatwalk = computeBillOfQuantities(catwalkCfg, DEFAULT_EQUIPMENT);
    expect(qCatwalk.totalStageArea).toBe(74); // 60 + 14

    const ballroomCfg = JSON.parse(JSON.stringify(DEFAULT_STAGE_CONFIG));
    ballroomCfg.tipePanggung = 'indoor_ballroom';
    const qBallroom = computeBillOfQuantities(ballroomCfg, DEFAULT_EQUIPMENT);
    const hasTruss = qBallroom.boqItems.some((it) => it.equipmentId === 'eq-truss-rigging');
    expect(hasTruss).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('escapes potentially dangerous HTML characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });
});
