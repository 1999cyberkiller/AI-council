export const QVMR_CONFIG = Object.freeze({
  thresholds: Object.freeze({
    watch: 70,
    buy: 80,
    strongBuy: 90,
    reduce: 70,
    exit: 60,
  }),

  market: Object.freeze({
    weight: 20,
    rules: Object.freeze([
      Object.freeze({ key: "hs300AboveMA60", points: 5, label: "沪深 300 在 MA60 上方" }),
      Object.freeze({ key: "zz500AboveMA60", points: 5, label: "中证 500 在 MA60 上方" }),
      Object.freeze({ key: "allAAmountAboveMA20", points: 5, label: "全 A 成交额高于 20 日均值" }),
      Object.freeze({ key: "advancersMoreThanDecliners", points: 5, label: "上涨家数多于下跌家数" }),
    ]),
  }),

  industry: Object.freeze({
    weight: 20,
    rules: Object.freeze([
      Object.freeze({ key: "industryReturn20dTop30", points: 6, label: "行业 20 日涨幅前 30%" }),
      Object.freeze({ key: "industryReturn60dTop30", points: 6, label: "行业 60 日涨幅前 30%" }),
      Object.freeze({ key: "industryAmountAboveMA20", points: 4, label: "行业成交额高于 20 日均值" }),
      Object.freeze({ key: "industryNewHighOrLimitUpIncreasing", points: 4, label: "行业新高或涨停扩散" }),
    ]),
  }),

  momentum: Object.freeze({
    weight: 25,
    rules: Object.freeze([
      Object.freeze({ key: "priceAboveMA20", points: 5, label: "股价在 MA20 上方" }),
      Object.freeze({ key: "priceAboveMA60", points: 5, label: "股价在 MA60 上方" }),
      Object.freeze({ key: "ma20AboveMA60", points: 5, label: "MA20 在 MA60 上方" }),
      Object.freeze({ key: "return20dBeatsIndustry", points: 5, label: "20 日涨幅强于行业" }),
      Object.freeze({ key: "distanceFrom52wHighLessThan15pct", points: 5, label: "距离 52 周高点小于 15%" }),
    ]),
  }),

  volume: Object.freeze({
    weight: 15,
    rules: Object.freeze([
      Object.freeze({ key: "amount20dAboveAmount60d", points: 5, label: "20 日均成交额高于 60 日均成交额" }),
      Object.freeze({ key: "upDayAmountHigherThanDownDayAmount", points: 5, label: "上涨日成交额高于下跌日" }),
      Object.freeze({ key: "pullbackVolumeShrinks", points: 5, label: "回调缩量" }),
    ]),
  }),

  quality: Object.freeze({
    weight: 15,
    rules: Object.freeze([
      Object.freeze({ key: "roeAbove8pct", points: 3, label: "ROE 大于 8%" }),
      Object.freeze({ key: "revenueGrowthPositive", points: 3, label: "营收同比增长为正" }),
      Object.freeze({ key: "deductedProfitGrowthPositive", points: 3, label: "扣非净利润同比增长为正" }),
      Object.freeze({ key: "operatingCashFlowPositive", points: 3, label: "经营现金流净额为正" }),
      Object.freeze({ key: "valuationBelow70pctHistoricalPercentile", points: 3, label: "估值低于自身历史 70% 分位" }),
    ]),
  }),

  riskPenalty: Object.freeze([
    Object.freeze({ key: "return20dAbove50pct", points: 5, label: "近 20 日涨幅超过 50%" }),
    Object.freeze({ key: "highVolumeStallNearHigh", points: 5, label: "高位放量滞涨" }),
    Object.freeze({ key: "marginBalanceRisingButPriceFlat", points: 5, label: "融资余额上升但股价横盘" }),
    Object.freeze({ key: "unlockOrShareholderReductionRisk", points: 5, label: "解禁或大股东减持风险" }),
    Object.freeze({ key: "priceBelowMA60", points: 10, label: "股价跌破 MA60" }),
    Object.freeze({ key: "earningsWarningOrGuidanceCut", points: 20, label: "业绩预警或盈利下修" }),
  ]),
});
