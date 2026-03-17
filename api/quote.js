module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  // ── MODE FUNDAMENTALS : quoteSummary Yahoo Finance ─────────────────
  if (type === 'fundamentals') {
    try {
      const modules = [
        'defaultKeyStatistics',
        'financialData',
        'cashflowStatementHistory',
      ].join(',');

      // Essai 1 : query1
      let response = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://finance.yahoo.com/',
            'Origin': 'https://finance.yahoo.com',
            'Cookie': 'GUC=AQABCAFm; A1=d=AQABBCy; A3=d=AQABBCy',
          }
        }
      );
      // Essai 2 : query2 si query1 échoue
      if (!response.ok) {
        response = await fetch(
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Referer': 'https://finance.yahoo.com/quote/' + symbol,
            }
          }
        );
      }

      if (!response.ok) return res.status(502).json({ error: `Yahoo quoteSummary ${response.status}` });

      const data = await response.json();
      const result = data?.quoteSummary?.result?.[0];
      if (!result) {
        const errMsg = data?.quoteSummary?.error?.description || 'Données introuvables';
        return res.status(404).json({ error: errMsg, symbol });
      }

      const ks = result.defaultKeyStatistics || {};
      const fd = result.financialData || {};
      const cf = result.cashflowStatementHistory?.cashflowStatements || [];

      const fcf0 = cf[0]
        ? (cf[0].totalCashFromOperatingActivities?.raw || 0) - Math.abs(cf[0].capitalExpenditures?.raw || 0)
        : (fd.freeCashflow?.raw || null);
      const fcf1 = cf[1]
        ? (cf[1].totalCashFromOperatingActivities?.raw || 0) - Math.abs(cf[1].capitalExpenditures?.raw || 0)
        : null;
      const fcfGrowth = fcf0 && fcf1 && fcf1 !== 0 ? ((fcf0 - fcf1) / Math.abs(fcf1)) * 100 : null;
      const mktCap = ks.enterpriseValue?.raw || null;
      const pfcf = mktCap && fcf0 && fcf0 > 0 ? mktCap / fcf0 : null;

      return res.json({
        symbol,
        // Valorisation
        trailingPE:       ks.trailingEps?.raw ? null : null, // on utilise financialData
        forwardPE:        ks.forwardPE?.raw || null,
        pegRatio:         ks.pegRatio?.raw || null,
        priceToBook:      ks.priceToBook?.raw || null,
        // Croissance & rentabilité
        profitMargin:     fd.profitMargins?.raw ? fd.profitMargins.raw * 100 : null,
        revenueGrowth:    fd.revenueGrowth?.raw ? fd.revenueGrowth.raw * 100 : null,
        earningsGrowth:   fd.earningsGrowth?.raw ? fd.earningsGrowth.raw * 100 : null,
        returnOnEquity:   fd.returnOnEquity?.raw ? fd.returnOnEquity.raw * 100 : null,
        // Prix
        currentPrice:     fd.currentPrice?.raw || null,
        targetMeanPrice:  fd.targetMeanPrice?.raw || null,
        // FCF
        freeCashflow:     fd.freeCashflow?.raw || fcf0 || null,
        fcfGrowth:        fcfGrowth,
        pfcf:             pfcf,
        // 52 semaines
        fiftyTwoWeekHigh: ks.fiftyTwoWeekHigh?.raw || null,
        fiftyTwoWeekLow:  ks.fiftyTwoWeekLow?.raw || null,
        // Timestamp
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
