import { calculateQVMR, explainQVMR } from './qvmrScoring.js';
import { deriveQVMRSignals, mergeManualSignals } from './qvmrSignals.js';
import { QVMR_CONFIG } from './qvmrConfig.js';

const avg = (rows, pick) => {
  const values = rows.map(pick).filter((v) => Number.isFinite(v));
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
};

const pctChange = (from, to) => (
  Number.isFinite(from) && from !== 0 && Number.isFinite(to) ? (to - from) / from : null
);

function buildMetrics(stockData, klineData, financialsData) {
  const rows = Array.isArray(klineData) ? klineData.filter((k) => Number.isFinite(k.close)) : [];
  const last = rows[rows.length - 1] || null;
  const prev20 = rows.length > 20 ? rows[rows.length - 21] : null;
  const recent20 = rows.slice(-20);
  const recent60 = rows.slice(-60);
  const latestQuarter = Array.isArray(financialsData?.quarters) ? financialsData.quarters[0] : null;

  const upDays = recent20.filter((k) => k.close >= k.open);
  const downDays = recent20.filter((k) => k.close < k.open);
  const recentHigh = recent20.length ? Math.max(...recent20.map((k) => k.high).filter(Number.isFinite)) : null;
  const last5Volume = avg(rows.slice(-5), (k) => k.volume);
  const prev20Volume = avg(rows.slice(-25, -5), (k) => k.volume);

  return {
    close: last?.close ?? stockData?.price ?? null,
    high52w: stockData?.high52 ?? null,
    ma20: last?.ma20 ?? null,
    ma60: last?.ma60 ?? null,
    return20d: prev20 ? pctChange(prev20.close, last.close) : null,
    industryReturn20d: null,
    amountMA20: avg(recent20, (k) => k.volume),
    amountMA60: avg(recent60, (k) => k.volume),
    avgUpDayAmount20d: avg(upDays, (k) => k.volume),
    avgDownDayAmount20d: avg(downDays, (k) => k.volume),
    pullbackAmountRatio:
      Number.isFinite(recentHigh) && last?.close < recentHigh * 0.97 && prev20Volume
        ? last5Volume / prev20Volume
        : null,
    roe: latestQuarter?.roe ?? null,
    revenueGrowthYoY: latestQuarter?.revenueYoY ?? null,
    deductedProfitGrowthYoY: latestQuarter?.netIncomeYoY ?? null,
    operatingCashFlowNet:
      Number.isFinite(latestQuarter?.cfoToNI) && Number.isFinite(latestQuarter?.netIncome)
        ? latestQuarter.cfoToNI * latestQuarter.netIncome
        : null,
    valuationHistoricalPercentile: null,
    highVolumeStallNearHigh:
      Number.isFinite(recentHigh) &&
      Number.isFinite(last?.close) &&
      Number.isFinite(last?.volume) &&
      Number.isFinite(prev20Volume) &&
      last.close > recentHigh * 0.92 &&
      Math.abs(pctChange(prev20?.close, last.close) ?? 0) < 0.03 &&
      last.volume > prev20Volume * 1.6,
  };
}

const qvmrRuleKeys = [
  ...QVMR_CONFIG.market.rules,
  ...QVMR_CONFIG.industry.rules,
  ...QVMR_CONFIG.momentum.rules,
  ...QVMR_CONFIG.volume.rules,
  ...QVMR_CONFIG.quality.rules,
  ...QVMR_CONFIG.riskPenalty,
].map((rule) => rule.key);

const finite = (v) => Number.isFinite(v);

function coverageFromMetrics(metrics, manualSignals) {
  const manualKnown = (key) => typeof manualSignals?.[key] === 'boolean';
  const autoKnown = {
    hs300AboveMA60: finite(metrics.hs300Close) && finite(metrics.hs300MA60),
    zz500AboveMA60: finite(metrics.zz500Close) && finite(metrics.zz500MA60),
    allAAmountAboveMA20: finite(metrics.allAAmount) && finite(metrics.allAAmountMA20),
    advancersMoreThanDecliners: finite(metrics.advancers) && finite(metrics.decliners),

    industryReturn20dTop30: finite(metrics.industryReturn20dRankPct),
    industryReturn60dTop30: finite(metrics.industryReturn60dRankPct),
    industryAmountAboveMA20: finite(metrics.industryAmount) && finite(metrics.industryAmountMA20),
    industryNewHighOrLimitUpIncreasing:
      finite(metrics.industryNewHighOrLimitUpCount) && finite(metrics.industryNewHighOrLimitUpCountMA5),

    priceAboveMA20: finite(metrics.close) && finite(metrics.ma20),
    priceAboveMA60: finite(metrics.close) && finite(metrics.ma60),
    ma20AboveMA60: finite(metrics.ma20) && finite(metrics.ma60),
    return20dBeatsIndustry: finite(metrics.return20d) && finite(metrics.industryReturn20d),
    distanceFrom52wHighLessThan15pct: finite(metrics.close) && finite(metrics.high52w) && metrics.high52w > 0,

    amount20dAboveAmount60d: finite(metrics.amountMA20) && finite(metrics.amountMA60),
    upDayAmountHigherThanDownDayAmount: finite(metrics.avgUpDayAmount20d) && finite(metrics.avgDownDayAmount20d),
    pullbackVolumeShrinks: finite(metrics.pullbackAmountRatio),

    roeAbove8pct: finite(metrics.roe),
    revenueGrowthPositive: finite(metrics.revenueGrowthYoY),
    deductedProfitGrowthPositive: finite(metrics.deductedProfitGrowthYoY),
    operatingCashFlowPositive: finite(metrics.operatingCashFlowNet),
    valuationBelow70pctHistoricalPercentile: finite(metrics.valuationHistoricalPercentile),

    return20dAbove50pct: finite(metrics.return20d),
    highVolumeStallNearHigh: typeof metrics.highVolumeStallNearHigh === 'boolean',
    marginBalanceRisingButPriceFlat: finite(metrics.marginBalanceChange20d) && finite(metrics.return20d),
    unlockOrShareholderReductionRisk: typeof metrics.unlockOrShareholderReductionRisk === 'boolean',
    priceBelowMA60: finite(metrics.close) && finite(metrics.ma60),
    earningsWarningOrGuidanceCut: typeof metrics.earningsWarningOrGuidanceCut === 'boolean',
  };
  const known = qvmrRuleKeys.filter((key) => autoKnown[key] || manualKnown(key)).length;
  return Math.min(100, Math.round((known / qvmrRuleKeys.length) * 100));
}

export function buildQVMRForDispatch({ stockData, klineData, financialsData, manualSignals = {} }) {
  if (!stockData) return null;
  const metrics = buildMetrics(stockData, klineData, financialsData);
  const autoSignals = deriveQVMRSignals(metrics);
  const signals = mergeManualSignals(autoSignals, manualSignals);
  const stockInput = {
    stockCode: stockData.code,
    stockName: stockData.name,
    tradeDate: new Date().toISOString().slice(0, 10),
    signals,
  };
  const qvmr = calculateQVMR(stockInput);
  return {
    qvmr,
    explanation: explainQVMR(qvmr),
    metrics,
    autoSignals,
    manualSignals,
    dataCoverage: coverageFromMetrics(metrics, manualSignals),
  };
}

export function qvmrActionToVerdict(action) {
  if (action === 'STRONG_BUY' || action === 'BUY') return 'BUY';
  if (action === 'EXIT' || action === 'HOLD_OR_REDUCE') return 'SELL';
  return 'HOLD';
}
