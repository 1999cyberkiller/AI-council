function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function gt(a, b) {
  return isFiniteNumber(a) && isFiniteNumber(b) && a > b;
}

function gte(a, b) {
  return isFiniteNumber(a) && isFiniteNumber(b) && a >= b;
}

function lt(a, b) {
  return isFiniteNumber(a) && isFiniteNumber(b) && a < b;
}

function pctRankTop(valueRankPercentile, cutoff = 0.3) {
  return isFiniteNumber(valueRankPercentile) && valueRankPercentile <= cutoff;
}

export function deriveQVMRSignals(metrics = {}) {
  const distanceFrom52wHigh =
    isFiniteNumber(metrics.close) && isFiniteNumber(metrics.high52w) && metrics.high52w > 0
      ? 1 - metrics.close / metrics.high52w
      : null;

  return {
    hs300AboveMA60: gt(metrics.hs300Close, metrics.hs300MA60),
    zz500AboveMA60: gt(metrics.zz500Close, metrics.zz500MA60),
    allAAmountAboveMA20: gt(metrics.allAAmount, metrics.allAAmountMA20),
    advancersMoreThanDecliners: gt(metrics.advancers, metrics.decliners),

    industryReturn20dTop30: pctRankTop(metrics.industryReturn20dRankPct, 0.3),
    industryReturn60dTop30: pctRankTop(metrics.industryReturn60dRankPct, 0.3),
    industryAmountAboveMA20: gt(metrics.industryAmount, metrics.industryAmountMA20),
    industryNewHighOrLimitUpIncreasing: gt(metrics.industryNewHighOrLimitUpCount, metrics.industryNewHighOrLimitUpCountMA5),

    priceAboveMA20: gt(metrics.close, metrics.ma20),
    priceAboveMA60: gt(metrics.close, metrics.ma60),
    ma20AboveMA60: gt(metrics.ma20, metrics.ma60),
    return20dBeatsIndustry: gt(metrics.return20d, metrics.industryReturn20d),
    distanceFrom52wHighLessThan15pct: distanceFrom52wHigh !== null && distanceFrom52wHigh < 0.15,

    amount20dAboveAmount60d: gt(metrics.amountMA20, metrics.amountMA60),
    upDayAmountHigherThanDownDayAmount: gt(metrics.avgUpDayAmount20d, metrics.avgDownDayAmount20d),
    pullbackVolumeShrinks: lt(metrics.pullbackAmountRatio, 1),

    roeAbove8pct: gt(metrics.roe, 0.08),
    revenueGrowthPositive: gt(metrics.revenueGrowthYoY, 0),
    deductedProfitGrowthPositive: gt(metrics.deductedProfitGrowthYoY, 0),
    operatingCashFlowPositive: gt(metrics.operatingCashFlowNet, 0),
    valuationBelow70pctHistoricalPercentile: lt(metrics.valuationHistoricalPercentile, 0.7),

    return20dAbove50pct: gt(metrics.return20d, 0.5),
    highVolumeStallNearHigh: Boolean(metrics.highVolumeStallNearHigh),
    marginBalanceRisingButPriceFlat:
      gt(metrics.marginBalanceChange20d, 0.1) && Math.abs(metrics.return20d ?? 0) < 0.03,
    unlockOrShareholderReductionRisk: Boolean(metrics.unlockOrShareholderReductionRisk),
    priceBelowMA60: lt(metrics.close, metrics.ma60),
    earningsWarningOrGuidanceCut: Boolean(metrics.earningsWarningOrGuidanceCut),
  };
}

export function mergeManualSignals(autoSignals, manualSignals = {}) {
  return {
    ...autoSignals,
    ...manualSignals,
  };
}
