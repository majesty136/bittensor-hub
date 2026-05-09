/**
 * mining-core.js — source de vérité unique pour la logique métier.
 * Importé par index.html (desktop hub) et app.html (iOS PWA).
 * Tout ajout de métrique, formule ou fetch passe ICI en premier.
 */

// ── Fetch ─────────────────────────────────────────────────────────

async function fetchStatus(sub) {
  try {
    const r = await fetch(sub.statusFile + '?t=' + Date.now(), { cache: 'no-store' });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function fetchMeta() {
  try {
    const r = await fetch('./status/meta.json?t=' + Date.now(), { cache: 'no-store' });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function fetchTaoPrice(fallback = 0) {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd',
      { cache: 'no-store' }
    );
    const d = await r.json();
    return d.bittensor.usd || fallback;
  } catch { return fallback; }
}

// ── Calculs P&L ───────────────────────────────────────────────────

/**
 * Calcule le P&L global à partir de tous les miners + coûts fixes config.
 * @param {Array}  results   - tableau de status JSON (null si offline)
 * @param {number} taoPrice  - prix TAO en USD (CoinGecko)
 * @param {Array}  fixedCosts - FIXED_COSTS depuis config.js
 * @returns {Object} pnlData
 */
function computePnl(results, taoPrice, fixedCosts, registrationCosts = []) {
  const monthlyFixed = fixedCosts.reduce((s, c) => s + c.usd_month, 0);

  let totalEarnedTao   = 0;
  let totalEarnedAlpha = 0;
  let varCosts         = 0;
  let earliestMs       = null;
  let taoFallback      = 0;

  results.forEach(data => {
    if (!data) return;
    totalEarnedTao   += data.total_earned_tao   || 0;
    totalEarnedAlpha += data.total_earned_alpha  || 0;
    varCosts         += data.cost_usd            || 0;
    if (data.tao_price_usd) taoFallback = data.tao_price_usd;
    if (data.tracking_since) {
      const ts = new Date(data.tracking_since).getTime();
      if (!earliestMs || ts < earliestMs) earliestMs = ts;
    }
  });

  const price        = taoPrice || taoFallback;
  const daysTracked  = earliestMs ? (Date.now() - earliestMs) / 86_400_000 : 0;
  const fixedTotal   = (monthlyFixed / 30.44) * daysTracked;
  const regTotal     = registrationCosts.reduce((s, c) => s + c.tao * price, 0);
  const revenue      = totalEarnedTao * price;
  const totalCosts   = varCosts + fixedTotal + regTotal;
  const pnl          = revenue - totalCosts;
  const roi          = totalCosts > 0 ? pnl / totalCosts * 100 : 0;

  const dailyRevenue  = daysTracked > 0 ? revenue / daysTracked : 0;
  const breakEvenDays = pnl < 0 && dailyRevenue > 0 ? Math.abs(pnl) / dailyRevenue : 0;

  return {
    price, totalEarnedTao, totalEarnedAlpha, varCosts,
    fixedTotal, monthlyFixed, regTotal, daysTracked,
    revenue, totalCosts, pnl, roi, breakEvenDays,
    lines: [
      { label: 'Revenus — TAO gagné (est.)', val: revenue, sign: +1,
        sub: `~${totalEarnedTao.toFixed(4)} τ · ~${totalEarnedAlpha.toFixed(2)} α × $${price.toFixed(2)}` },
      { label: 'GPU / RunPod',    val: varCosts,  sign: -1, sub: 'variable (heures × tarif)' },
      ...fixedCosts.map(c => ({
        label: c.label,
        val:   (c.usd_month / 30.44) * daysTracked,
        sign:  -1,
        sub:   `$${c.usd_month}/mois · ${daysTracked.toFixed(1)} j trackés`,
      })),
      ...registrationCosts.map(c => ({
        label: c.label,
        val:   c.tao * price,
        sign:  -1,
        sub:   `${c.tao.toFixed(4)} τ × $${price.toFixed(0)} · bloc ${c.reg_block.toLocaleString()}`,
      })),
      { label: 'Total coûts',  val: totalCosts, sign: -1, sub: 'GPU + fixes + inscriptions', separator: true },
      { label: 'P&L net',      val: pnl,        sign: pnl >= 0 ? 1 : -1, sub: `ROI ${roi.toFixed(1)}%` },
    ],
  };
}

// ── Agrégats flotte ───────────────────────────────────────────────

function computeFleetSummary(results) {
  const ACTIVE_STATUSES = ['MINING', 'ACTIVE', 'IMMUNE', 'STARTING'];
  let mining = 0, totalCost = 0, totalDone = 0, totalRecv = 0, totalEmission = 0;
  results.forEach(data => {
    if (!data) return;
    if (ACTIVE_STATUSES.includes(data.status)) mining++;
    totalCost     += data.cost_usd     || 0;
    totalEmission += data.emission_day || 0;
    if (data.tasks) {
      totalDone += data.tasks.completed || 0;
      totalRecv += data.tasks.received  || 0;
    }
  });
  const successRate = totalRecv > 0 ? Math.round(totalDone / totalRecv * 100) : 0;
  return { mining, totalCost, totalDone, totalRecv, totalEmission, successRate };
}

/** Formate un score Brier (lower=better) avec couleur */
function brierColor(score) {
  if (score === null || score === undefined) return 'rgba(255,255,255,.3)';
  if (score < 0.20) return '#30D158';
  if (score < 0.25) return '#FF9F0A';
  return '#FF453A';
}

/** Formate une durée en heures → "6j 23h" */
function fmtHours(h) {
  if (h <= 0) return '0h';
  const days = Math.floor(h / 24);
  const hrs  = Math.floor(h % 24);
  return days > 0 ? `${days}j ${hrs}h` : `${hrs}h`;
}

// ── Helpers UI ────────────────────────────────────────────────────

function statusColor(s) {
  if (s === 'MINING')   return '#30D158';
  if (s === 'ERROR')    return '#FF453A';
  if (s === 'STARTING') return '#FF9F0A';
  return 'rgba(255,255,255,.3)';
}

/** Formate un P&L signé : +$12.34 ou −$12.34 */
function fmtPnl(n) {
  return (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
}

/** Formate une durée en secondes : 2h 14m */
function fmtUptime(s) {
  if (s < 60)     return s + 's';
  if (s < 3600)   return Math.floor(s / 60) + 'm';
  if (s < 86400)  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  return Math.floor(s / 86400) + 'j ' + Math.floor((s % 86400) / 3600) + 'h';
}
