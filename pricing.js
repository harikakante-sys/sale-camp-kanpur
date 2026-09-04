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

// Which purchase category (if any) a goat falls into, from sex + teeth +
// weight. Business rule (confirmed by the product owner, updated
// 2026-08-22) — six rate-card-backed categories, all requiring a minimum
// weight to be eligible at all:
//   young_male_small    male, 0-2 teeth, <20kg
//   young_male_regular  male, 0-2 teeth, 20kg to <28kg
//   young_male_body     male, 0-2 teeth, >=28kg ("body" is a real priced
//                        category again — briefly removed 2026-08-12,
//                        reinstated 2026-08-22 with its own rate)
//   male_4teeth         male, 4 teeth, >=20kg (newly eligible — 4-teeth
//                        males were never purchasable before this)
//   old_female          female, 6-8 teeth, >=20kg (4-teeth females moved
//                        to their own category below; the weight floor is
//                        new — previously old_female had no weight test)
//   female_4teeth       female, 4 teeth, >=20kg (newly its own category —
//                        previously priced the same as 6/8-teeth females)
// A female with 0-2 teeth is priced from the matching male young category
// minus a flat discount (see FEMALE_YOUNG_DISCOUNT) rather than needing 3
// more rate card entries of her own — rateLookupKey below is which
// rate_card_lines row actually gets read. appliesCastration is only true
// for male_4teeth (updated 2026-08-23) — a 0-2-teeth male is still asked
// whether he's castrated (recorded on the goat either way), but it no
// longer changes his price; a 4-teeth male's price still drops ₹10/kg if
// he isn't.
const FEMALE_YOUNG_DISCOUNT = 10; // rupees per kg, below the equivalent male rate (was 20, lowered 2026-08-23)
const UNCASTRATED_DISCOUNT = 10;  // rupees per kg, for an uncastrated male_4teeth

function classify(sexVal, teethStr, weight) {
  const t = parseInt(teethStr, 10), w = parseFloat(weight);
  if (isNaN(t) || isNaN(w) || !sexVal) return null;

  if (t === 0 || t === 2) {
    let maleKey, femaleKey;
    if (w < 20) { maleKey = 'young_male_small'; femaleKey = 'young_female_small'; }
    else if (w < 28) { maleKey = 'young_male_regular'; femaleKey = 'young_female_regular'; }
    else { maleKey = 'young_male_body'; femaleKey = 'young_female_body'; }
    if (sexVal === 'male') return { key: maleKey, rateLookupKey: maleKey };
    if (sexVal === 'female') return { key: femaleKey, rateLookupKey: maleKey, femaleDiscount: FEMALE_YOUNG_DISCOUNT };
    return null;
  }
  // Floor lowered 2026-08-23 (was 20kg for all three) — a real field animal
  // at 19kg was being rejected outright mid-camp; product owner chose 18kg
  // for all three of these single-band categories instead.
  if (sexVal === 'male' && t === 4) {
    if (w < 18) return null;
    return { key: 'male_4teeth', rateLookupKey: 'male_4teeth', appliesCastration: true };
  }
  if (sexVal === 'female' && (t === 6 || t === 8)) {
    if (w < 18) return null;
    return { key: 'old_female', rateLookupKey: 'old_female' };
  }
  if (sexVal === 'female' && t === 4) {
    if (w < 18) return null;
    return { key: 'female_4teeth', rateLookupKey: 'female_4teeth' };
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

// Full price quote for a goat, given the currently-synced rate card for its
// region. `castrated` only matters for male goats (see classify()'s
// appliesCastration) — pass null/undefined for females, it's simply ignored.
// rateCache shape: { [region]: { version, buffer, lines: { "category|quality": ratePerKg } } }
function computeQuote(rateCache, region, sexVal, teethStr, weight, quality, castrated) {
  const cat = classify(sexVal, teethStr, weight);
  if (!cat) return { eligible: false };
  const rc = rateCache[region];
  if (!rc) return { eligible: true, category: cat, noRateCard: true };
  let rate = rc.lines[cat.rateLookupKey + '|' + quality];
  if (rate == null) return { eligible: true, category: cat, noRateCard: true };
  if (cat.appliesCastration && !castrated) rate -= UNCASTRATED_DISCOUNT;
  if (cat.femaleDiscount) rate -= cat.femaleDiscount;
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
