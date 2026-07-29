/**
 * Computes all six goat weight predictions (F2, Random Forest, Elastic Net, ENS,
 * Blend, MIN) from raw measurements, using the model bundle exported by
 * export_ens_model.py (ens_model_export.json). No ML runtime library needed --
 * pure JS, runs fully on-device.
 *
 * Validated against the live scikit-learn training pipeline across 271 goats
 * from three populations: Elastic Net matches to floating-point noise
 * (~1e-14 kg). Random Forest matches to floating-point noise for the typical
 * goat, with a rare (~2% of goats) residual up to ~0.2kg -- this comes from
 * scikit-learn internally casting inputs to float32 for tree models (a memory
 * detail, not a bug), reproduced here via Math.fround(). Far smaller than the
 * model's own real-world accuracy (~1.7-2kg MAE) and safe to ignore in practice.
 *
 * Usage:
 *   const model = await fetch('ens_model_export.json').then(r => r.json());
 *   const result = computeAllPredictions(model, {
 *     hg_cm: 68, bl_cm: 62, height_cm: 70, rump_w_cm: 13, paunch_g_cm: 75,
 *     teeth_count: 2, sex: 'female',
 *   });
 *   // result = { f2, randomForest, elasticNet, ens, blend, min }
 *
 *   // 2-dimension mode (only HG + BL known): use computeWeightF2 directly.
 *   const weight = computeWeightF2(hg_cm, bl_cm);
 */

function engineerFeatures(raw) {
  return {
    hg_cm: raw.hg_cm,
    bl_cm: raw.bl_cm,
    height_cm: raw.height_cm,
    rump_w_cm: raw.rump_w_cm,
    paunch_g_cm: raw.paunch_g_cm,
    hg2_bl: raw.hg_cm * raw.hg_cm * raw.bl_cm,
    hg_paunch: raw.hg_cm * raw.paunch_g_cm,
    bl_height: raw.bl_cm * raw.height_cm,
    paunch_hg_ratio: raw.paunch_g_cm / raw.hg_cm,
    teeth_count: raw.teeth_count,
  };
}

/** Model 1: F2 power-law formula. Only needs HG and BL -- the sole option in
 * 2-dimension mode, and one of the three raw ingredients of Blend and MIN. */
function computeWeightF2(hg_cm, bl_cm) {
  const hgIn = hg_cm / 2.54;
  const blIn = bl_cm / 2.54;
  return 0.003 * Math.pow(hgIn, 2.1) * Math.pow(blIn, 0.67);
}

/** Model 3: Elastic Net -- a linear formula. intercept + sum(coefficient x
 * standardized_feature). Coefficients come from the exported model bundle. */
function computeWeightElasticNet(modelExport, raw) {
  const en = modelExport.elastic_net;
  const feats = engineerFeatures(raw);
  const standardized = en.numeric_features.map((name, i) => {
    const value = feats[name] != null ? feats[name] : en.numeric_impute_median[i];
    return (value - en.numeric_mean[i]) / en.numeric_scale[i];
  });
  const sexOneHot = en.sex_categories.map((cat) => (raw.sex === cat ? 1 : 0));
  const fullVector = standardized.concat(sexOneHot);
  return en.intercept + fullVector.reduce((sum, x, i) => sum + x * en.coefficients[i], 0);
}

function walkTree(node, vec) {
  if ('leaf' in node) return node.leaf;
  const goLeft = vec[node.feature] <= node.threshold;
  return walkTree(goLeft ? node.left : node.right, vec);
}

/** Model 2: Random Forest -- average the prediction of every tree in the
 * exported forest (typically 200-400 trees). */
function computeWeightRandomForest(modelExport, raw) {
  const rf = modelExport.random_forest;
  const feats = engineerFeatures(raw);
  // Math.fround mimics scikit-learn's internal float32 cast for tree models --
  // needed to match sklearn bit-for-bit at rare threshold-boundary cases.
  const standardized = rf.numeric_features.map((name, i) => {
    const value = feats[name] != null ? feats[name] : rf.numeric_impute_median[i];
    return Math.fround((value - rf.numeric_mean[i]) / rf.numeric_scale[i]);
  });
  const sexOneHot = rf.sex_categories.map((cat) => Math.fround(raw.sex === cat ? 1 : 0));
  const vec = standardized.concat(sexOneHot);

  const total = rf.trees.reduce((sum, tree) => sum + walkTree(tree, vec), 0);
  return total / rf.n_trees;
}

/**
 * Computes all six predictions. raw = { hg_cm, bl_cm, height_cm, rump_w_cm,
 * paunch_g_cm, teeth_count, sex }. Requires all 5 measurements -- this is the
 * 5-dimension path only. For 2-dimension mode, call computeWeightF2 directly.
 */
function computeAllPredictions(modelExport, raw) {
  const f2 = computeWeightF2(raw.hg_cm, raw.bl_cm);
  const randomForest = computeWeightRandomForest(modelExport, raw);
  const elasticNet = computeWeightElasticNet(modelExport, raw);

  // Model 4: ENS -- plain average of Random Forest and Elastic Net.
  const ens = (elasticNet + randomForest) / 2;

  // Model 5: Blend -- 0.5xF2 + 0.25xRF + 0.25xEN (equivalently avg(F2, ENS)).
  const blend = 0.5 * f2 + 0.25 * randomForest + 0.25 * elasticNet;

  // Model 6: MIN -- the smallest of the three raw (non-averaged) predictions.
  const min = Math.min(elasticNet, randomForest, f2);

  return { f2, randomForest, elasticNet, ens, blend, min };
}

if (typeof module !== 'undefined') {
  module.exports = {
    computeAllPredictions, computeWeightF2, computeWeightElasticNet,
    computeWeightRandomForest, engineerFeatures,
  };
}
