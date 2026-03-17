module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  // ── MODE FUNDAMENTALS : Financial Modeling Prep (API stable 2025) ──
  if (type === 'fundamentals') {
    const FMP_KEY = 'yrFxAuUHv6XgKGxfXol6sGWVxmEq6tBr';
    try {
      const [rMetrics, rRatios, rCF] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&limit=2&apikey=${FMP_KEY}`)
      ]);

      const metricsData = rMetrics.ok ? await rMetrics.json() : [];
      const ratiosData  = rRatios.ok  ? await rRatios.json()  : [];
      const m = Array.isArray(metricsData) ? metricsData[0] : metricsData;
      const r = Array.isArray(ratiosData)  ? ratiosData[0]  : ratiosData;

      if (!m && !r) return res.status(404).json({ error: `Données introuvables pour ${symbol}` });

      // FCF croissance
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
        forwardPE:        m?.peRatioTTM || r?.peRatioTTM || null,
        pegRatio:         m?.pegRatioTTM || r?.pegRatioTTM || null,
        profitMarginPct:  r?.netProfitMarginTTM ? r.netProfitMarginTTM * 100 : null,
        earningsGrowth:   null,
        freeCashflow:     fcf0,
        fcfGrowth:        fcfGrowth,
        pfcf:             m?.pfcfRatioTTM || r?.priceToFreeCashFlowsTTM || null,
        fiftyTwoWeekHigh: m?.yearHighTTM || null,
        fiftyTwoWeekLow:  m?.yearLowTTM  || null,
        mktCap:           m?.marketCapTTM || null,
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
