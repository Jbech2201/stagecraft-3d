const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes untrusted user text before interpolating into HTML templates.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * Computes Bill of Quantities (BoQ), electrical load (Watt & kVA at PF 0.8),
 * genset recommendation, and rental totals from stageConfig + equipmentCatalog.
 */
export function computeBillOfQuantities(stageConfig, equipmentCatalog) {
  const lebar = Number(stageConfig?.ukuranPanggung?.lebar) || 0;
  const panjang = Number(stageConfig?.ukuranPanggung?.panjang) || 0;
  const catwalkArea = stageConfig?.tipePanggung === 'catwalk_t' ? 14 : 0;
  const totalStageArea = Math.round(lebar * panjang + catwalkArea);

  const boqItems = [];

  for (const eq of equipmentCatalog) {
    let qty = 0;
    if (eq.tipeModel === 'stage_deck_m2') {
      qty = totalStageArea;
    } else if (eq.tipeModel === 'truss_rigging_set') {
      qty = stageConfig?.tipePanggung === 'indoor_ballroom' ? 0 : 1;
    } else if (eq.tipeModel === 'led_backdrop_m2') {
      qty = stageConfig?.ledBackdrop ? Math.round(lebar * 0.75 * 4) : 0;
    } else {
      qty = Number(stageConfig?.counts?.[eq.tipeModel]) || 0;
    }

    if (qty > 0) {
      const wattPerUnit = Number(eq.wattPower) || 0;
      const hargaSatuan = Number(eq.hargaSewaHarian) || 0;
      boqItems.push({
        equipmentId: eq.id,
        nama: eq.nama,
        kategori: eq.kategori,
        satuan: eq.satuan,
        jumlah: qty,
        wattPerUnit,
        totalWattItem: qty * wattPerUnit,
        hargaSatuan,
        subtotalHarian: qty * hargaSatuan,
      });
    }
  }

  const totalWatt = boqItems.reduce((acc, it) => acc + it.totalWattItem, 0);
  // Power factor 0.8 -> kVA = (Watt / 1000) / 0.8
  const totalKva = Number((totalWatt / 1000 / 0.8).toFixed(1));

  let gensetRec = 'PLN Venue / Genset 20 kVA';
  if (totalKva > 60) gensetRec = 'Genset Silent 100 kVA';
  else if (totalKva > 38) gensetRec = 'Genset Silent 60 kVA';
  else if (totalKva > 18) gensetRec = 'Genset Silent 40 kVA';

  const dailyTotal = boqItems.reduce((acc, it) => acc + it.subtotalHarian, 0);
  const rentalDays = Math.max(1, Number(stageConfig?.rentalDays) || 1);
  const grandTotal = dailyTotal * rentalDays;

  return {
    totalStageArea,
    boqItems,
    totalWatt,
    totalKva,
    gensetRec,
    dailyTotal,
    rentalDays,
    grandTotal,
  };
}

export function formatRupiah(value) {
  return `Rp ${(Number(value) || 0).toLocaleString('id-ID')}`;
}
