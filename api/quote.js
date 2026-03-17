module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  // ── MODE FUNDAMENTALS : Financial Modeling Prep (API stable 2025) ──
  if (type === 'fundamentals') {
    const FMP_KEY = 'yrFxAuUHv6XgKGxfXol6sGWVxmEq6tBr';
    try {
      const [rMetrics, rRatios, rCF, rEst] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&limit=2&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${encodeURIComponent(symbol)}&period=annual&limit=10&apikey=${FMP_KEY}`)
      ]);

      const metricsData = rMetrics.ok ? await rMetrics.json() : [];
      const ratiosData  = rRatios.ok  ? await rRatios.json()  : [];
      const m = Array.isArray(metricsData) ? metricsData[0] : metricsData;
      const r = Array.isArray(ratiosData)  ? ratiosData[0]  : ratiosData;

      if (!m && !r) return res.status(404).json({ error: `Données introuvables pour ${symbol}` });

      // Forward EPS : prendre l'année fiscale à au moins 9 mois dans le futur
      let epsForward = null;
      if (rEst.ok) {
        const estData = await rEst.json();
        if (Array.isArray(estData)) {
          const today = new Date();
          const nineMonths = new Date(today.getTime() + 9*30*24*60*60*1000);
          const nextFY = estData
            .filter(e => new Date(e.date) > nineMonths && e.epsAvg > 0)
            .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
          // Fallback : prochaine année quelle que soit la distance
          if (!nextFY) {
            const fallback = estData
              .filter(e => new Date(e.date) > today && e.epsAvg > 0)
              .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            if (fallback) epsForward = fallback.epsAvg;
          } else {
            epsForward = nextFY.epsAvg;
          }
        }
      }

      // FCF depuis cash flow statement
      let fcfGrowth = null, fcf0 = null;
      if (rCF.ok) {
        const cfData = await rCF.json();
        if (Array.isArray(cfData) && cfData.length >= 2) {
          fcf0 = cfData[0]?.freeCashFlow || null;
          const fcf1 = cfData[1]?.freeCashFlow || null;
          if (fcf0 && fcf1 && fcf1 !== 0) fcfGrowth = ((fcf0 - fcf1) / Math.abs(fcf1)) * 100;
        } else if (Array.isArray(cfData) && cfData.length === 1) {
          fcf0 = cfData[0]?.freeCashFlow || null;
        }
      }

      return res.json({
        symbol,
        trailingPE:        r?.priceToEarningsRatioTTM || null,
        epsForward:        epsForward,   // forward PE calculé côté client : prix_USD / epsForward
        pegRatio:          r?.priceToEarningsGrowthRatioTTM || null,
        profitMarginPct:   r?.netProfitMarginTTM ? r.netProfitMarginTTM * 100 : null,
        freeCashflow:      fcf0,
        fcfGrowth:         fcfGrowth,
        pfcf:              r?.priceToFreeCashFlowRatioTTM || null,
        mktCap:            m?.marketCap || null,
        returnOnEquity:    m?.returnOnEquityTTM ? m.returnOnEquityTTM * 100 : null,
        freeCashFlowYield: m?.freeCashFlowYieldTTM ? m.freeCashFlowYieldTTM * 100 : null,
        timestamp: Date.now(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── MODE COURS : chart Yahoo Finance (défaut) ──────────────────────
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) return res.status(502).json({ error: 'Yahoo Finance indisponible' });

    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice || meta?.previousClose;

    if (!price) return res.status(404).json({ error: `Cours introuvable pour ${symbol}` });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.json({
      symbol,
      price,
      currency: meta?.currency || 'USD',
      exchange: meta?.exchangeName || '',
      timestamp: Date.now()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
