/* ═══════════════════════════════════════════════════════════════
   pricing.js — the ONE place goat eligibility + pricing math lives.

   Why this is its own file: index.html's Add Goat screen and its
   Calculator tab both need this exact same logic. Before, they used to
   duplicate it in two places (a real risk — a fix in one place and not
   the other silently creates two different prices for the same goat,
   which is exactly the ₹370 vs ₹385 mismatch this whole project started
   from). Now there is exactly one implementation, loaded by index.html
   via <script src="pricing.js">, and also loaded directly by
   tests/pricing.test.js under plain Node — no browser needed to test it.
   ═══════════════════════════════════════════════════════════════ */

// Which purchase category (if any) a goat falls into, from sex + teeth + weight.
// Business rule (confirmed by the product owner): ONLY young males (milk or
// 2 permanent teeth) and old females (4, 6, or 8 teeth) are ever purchased.
// A 4-teeth female prices identically to a 6/8-teeth female (same category,
// same rate) — 4-teeth males and anything else still return null (not eligible).
function classify(sexVal, teethStr, weight) {
  const t = parseInt(teethStr, 10), w = parseFloat(weight);
  if (isNaN(t) || isNaN(w) || !sexVal) return null;
  if (sexVal === 'male' && (t === 0 || t === 2)) {
    if (w < 17) return { key: 'young_male_small', label: 'नर - छोटा (<17 kg)' };
    if (w <= 26) return { key: 'young_male_regular', label: 'नर - सामान्य (17-26 kg)' };
    return { key: 'young_male_body', label: 'नर - बड़ा/Body (>26 kg)' };
  }
  if (sexVal === 'female' && (t === 4 || t === 6 || t === 8)) {
    return { key: 'old_female', label: 'पुरानी मादा (4-8 दांत)' };
  }
  return null;
}

// Weight estimate from tape measurements, for camps without a working scale.
// Formula as given in the original field-app prototype. Referred to as "F2"
// now that a second formula (F3, below) exists alongside it.
function estimateWeightFromTape(hg, bl) {
  if (!hg || !bl) return null;
  const hgIn = hg / 2.54, blIn = bl / 2.54;
  return 0.003 * Math.pow(hgIn, 2.1) * Math.pow(blIn, 0.67);
}

// F3: a second weight-estimation formula, using all 5 measurements (heart
// girth, body length, paunch girth, rump width, height) instead of just 2.
// Deployed alongside F2 (not replacing it) specifically to compare both
// against real scale weight and each other — same inches conversion as F2.
function estimateWeightFromMeasurementsF3(hg, bl, pg, rw, h) {
  if (!hg || !bl || !pg || !rw || !h) return null;
  const hgIn = hg / 2.54, blIn = bl / 2.54, pgIn = pg / 2.54, rwIn = rw / 2.54, hIn = h / 2.54;
  return 0.001747 * Math.pow(hgIn, 1.825) * Math.pow(blIn, 0.536) * Math.pow(pgIn, 0.059) * Math.pow(rwIn, 0.016) * Math.pow(hIn, 0.503);
}

// Full price quote for a goat, given the currently-synced rate card for its region.
// rateCache shape: { [region]: { version, buffer, lines: { "category|quality": ratePerKg } } }
function computeQuote(rateCache, region, sexVal, teethStr, weight, quality) {
  const cat = classify(sexVal, teethStr, weight);
  if (!cat) return { eligible: false };
  const rc = rateCache[region];
  if (!rc) return { eligible: true, category: cat, noRateCard: true };
  const rate = rc.lines[cat.key + '|' + quality];
  if (rate == null) return { eligible: true, category: cat, noRateCard: true };
  const finalPrice = Math.round(parseFloat(weight) * rate * rc.buffer);
  return { eligible: true, category: cat, noRateCard: false, rate, buffer: rc.buffer, finalPrice };
}

// Works both as a plain <script> in the browser (exposes window.PricingLib)
// and as a Node module for tests (module.exports) — no build step needed.
const PricingLib = { classify, estimateWeightFromTape, estimateWeightFromMeasurementsF3, computeQuote };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PricingLib;
} else {
  window.PricingLib = PricingLib;
}
