module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  // ── MODE FUNDAMENTALS : Financial Modeling Prep ───────────────────
  if (type === 'fundamentals') {
    const FMP_KEY = 'yrFxAuUHv6XgKGxfXol6sGWVxmEq6tBr';
    try {
      // Appel 1 : ratios (PER, PEG, marges, FCF...)
      const [rRatios, rCF] = await Promise.all([
        fetch(`https://financialmodelingprep.com/api/v3/ratios-ttm/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }),
        fetch(`https://financialmodelingprep.com/api/v3/cash-flow-statement/${encodeURIComponent(symbol)}?limit=2&apikey=${FMP_KEY}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        })
      ]);

      if (!rRatios.ok) return res.status(502).json({ error: `FMP ratios ${rRatios.status}` });

      const ratios = await rRatios.json();
      const r = Array.isArray(ratios) ? ratios[0] : ratios;
      if (!r) return res.status(404).json({ error: `Ratios introuvables pour ${symbol}` });

      // FCF croissance
      let fcfGrowth = null;
      let pfcf = null;
      let fcf0 = null;
      if (rCF.ok) {
        const cfData = await rCF.json();
        if (Array.isArray(cfData) && cfData.length >= 2) {
          fcf0 = cfData[0].freeCashFlow || null;
          const fcf1 = cfData[1].freeCashFlow || null;
          if (fcf0 && fcf1 && fcf1 !== 0) fcfGrowth = ((fcf0 - fcf1) / Math.abs(fcf1)) * 100;
        } else if (Array.isArray(cfData) && cfData.length === 1) {
          fcf0 = cfData[0].freeCashFlow || null;
        }
      }

      // P/FCF depuis ratio TTM
      pfcf = r.priceToFreeCashFlowsRatioTTM || null;

      // 52 semaines via chart endpoint
      let w52h = null, w52l = null;
      try {
        const rQuote = await fetch(
          `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (rQuote.ok) {
          const qData = await rQuote.json();
          const q = Array.isArray(qData) ? qData[0] : null;
          if (q) { w52h = q.yearHigh; w52l = q.yearLow; }
        }
      } catch(e) {}

      return res.json({
        symbol,
        // Valorisation
        forwardPE:     r.priceEarningsRatioTTM || null,
        pegRatio:      r.priceEarningsToGrowthRatioTTM || null,
        priceToBook:   r.priceToBookRatioTTM || null,
        // Rentabilité
        profitMargin:  r.netProfitMarginTTM ? r.netProfitMarginTTM * 100 : null,
        revenueGrowth: null, // pas dispo en TTM simple, nécessite income statement
        earningsGrowth: r.epsgrowthTTM ? r.epsgrowthTTM * 100 : null,
        returnOnEquity: r.returnOnEquityTTM ? r.returnOnEquityTTM * 100 : null,
        // FCF
        freeCashflow:  fcf0,
        fcfGrowth:     fcfGrowth,
        pfcf:          pfcf,
        // 52 semaines
        fiftyTwoWeekHigh: w52h,
        fiftyTwoWeekLow:  w52l,
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
