export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    version: "0.10.0",
    mode:
      "AUTONOMOUS_RESEARCH_AND_PAPER",
    marketData:
      "BINANCE_PUBLIC_MARKET_DATA_ONLY",
    automation: {
      engine: "GitHub Actions",
      targetCadence:
        "every 2 hours",
      persistenceBranch:
        "research-data",
      browserMayBeClosed: true,
      paperPortfolio: true,
      liveTrading: false,
    },
    paperPolicy: {
      startingCapitalPln: 200,
      riskPerTradePct: 0.50,
      maxOpenPositions: 3,
      maxGrossExposurePct: 100,
      maxSinglePositionPct: 50,
      dailyLossLimitPct: 2,
      hardDrawdownStopPct: 10,
      maxHoldingHours: 168,
      stop:
        "2x ATR, min 1%, max 5%",
      feePerSidePct: 0.10,
      slippagePerSidePct: 0.03,
    },
    resilience: {
      marketDataTimeoutMs: 10000,
      marketDataMaxAttempts: 3,
      maxMarketDataStalenessHours: 4,
      heartbeatPreflightTests: true,
      ciBuildGate: true,
      healthScore: true,
      decisionJournal: true,
      persistentAlerts: true,
      portfolioIntelligence: {
        equityCurve: true,
        expectancy: true,
        profitFactor: true,
        rMultiple: true,
        mfeMae: true,
        rollingWindowsDays: [7, 30, 90],
        strategyBreakdown: true,
        symbolBreakdown: true,
      },
      externalWatchdog: {
        engine: "GitHub Actions",
        cadence: "hourly",
        staleCriticalHours: 3.25,
        singleIssueAlert: true,
      },
    },
    scannerUniverse: 8,
    strategyFamilies: 4,
    allMarketScreenBars: 3000,
    deepLabBars: 5000,
    finalOosPct: 30,
    validation:
      "anchored + purged walk-forward",
    purgeBars: 24,
    storagePolicy: {
      publicResearchOnly: true,
      simulatedPaperPositionsOnly:
        true,
      secrets: false,
      realMoneyPositions: false,
      brokerData: false,
    },
    liveTrading: false,
    broker:
      "XTB_NOT_CONNECTED",
  });
}
