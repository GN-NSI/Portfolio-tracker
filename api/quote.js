module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  // ── MODE FUNDAMENTALS ──────────────────────────────────────────────
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
      let epsForward = null;
      if (rEst.ok) {
        const estData = await rEst.json();
        if (Array.isArray(estData)) {
          const today = new Date();
          const nineMonths = new Date(today.getTime() + 9*30*24*60*60*1000);
          const nextFY = estData.filter(e => new Date(e.date) > nineMonths && e.epsAvg > 0).sort((a,b) => new Date(a.date)-new Date(b.date))[0];
          if (!nextFY) {
            const fallback = estData.filter(e => new Date(e.date) > today && e.epsAvg > 0).sort((a,b) => new Date(a.date)-new Date(b.date))[0];
            if (fallback) epsForward = fallback.epsAvg;
          } else { epsForward = nextFY.epsAvg; }
        }
      }
      let fcfGrowth=null,fcf0=null,cfo0=null,capex0=null;
      if (rCF.ok) {
        const cfData = await rCF.json();
        if (Array.isArray(cfData) && cfData.length >= 2) {
          fcf0=cfData[0]?.freeCashFlow||null; cfo0=cfData[0]?.operatingCashFlow||null; capex0=cfData[0]?.capitalExpenditure||null;
          const fcf1=cfData[1]?.freeCashFlow||null;
          if (fcf0&&fcf1&&fcf1!==0) fcfGrowth=((fcf0-fcf1)/Math.abs(fcf1))*100;
        } else if (Array.isArray(cfData)&&cfData.length===1) {
          fcf0=cfData[0]?.freeCashFlow||null; cfo0=cfData[0]?.operatingCashFlow||null; capex0=cfData[0]?.capitalExpenditure||null;
        }
      }
      return res.json({
        symbol, trailingPE:r?.priceToEarningsRatioTTM||null, epsForward,
        currentPriceUSD:m?.stockPriceTTM||null, pegRatio:r?.priceToEarningsGrowthRatioTTM||null,
        profitMarginPct:r?.netProfitMarginTTM?r.netProfitMarginTTM*100:null,
        freeCashflow:fcf0, operatingCashFlow:cfo0, capex:capex0?Math.abs(capex0):null,
        capexToCFO:cfo0&&capex0&&cfo0!==0?(Math.abs(capex0)/cfo0)*100:null,
        fcfGrowth, pfcf:r?.priceToFreeCashFlowRatioTTM||null, mktCap:m?.marketCap||null,
        returnOnEquity:m?.returnOnEquityTTM?m.returnOnEquityTTM*100:null,
        freeCashFlowYield:m?.freeCashFlowYieldTTM?m.freeCashFlowYieldTTM*100:null,
        timestamp:Date.now()
      });
    } catch(err) { return res.status(500).json({error:err.message}); }
  }

  // ── MODE COURS ─────────────────────────────────────────────────────
  try {
    const safeSym = symbol.replace(/%5E/gi,'^').replace(/%3D/gi,'=');
    const range = req.query.range || '1y';

    const fetchOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    };

    // v7 pour prix + variation J vs J-1 fiable (regularMarketChangePercent)
    const urlQuote = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(safeSym)}`;
    // chart pour variations multi-périodes
    const urlChart = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(safeSym)}?interval=1d&range=${range}`;

    const [rQuote, rChart] = await Promise.all([
      fetch(urlQuote, fetchOpts),
      fetch(urlChart, fetchOpts)
    ]);

    // Prix et variation journalière depuis v7
    let price=null, changeAbs=null, changePct=null, prevClose=null, currency='USD', exchange='';
    if (rQuote.ok) {
      const dq = await rQuote.json();
      const q = dq?.quoteResponse?.result?.[0];
      if (q) {
        price     = q.regularMarketPrice || null;
        changeAbs = q.regularMarketChange || null;
        changePct = q.regularMarketChangePercent || null;
        prevClose = q.regularMarketPreviousClose || null;
        currency  = q.currency || 'USD';
        exchange  = q.exchange || q.fullExchangeName || '';
      }
    }

    // Données chart pour multi-périodes + fallback prix
    let change1M=null, changeYTD=null, change1Y=null;
    if (rChart.ok) {
      const dc = await rChart.json();
      const meta = dc?.chart?.result?.[0]?.meta;
      // Fallback prix si v7 a échoué
      if (!price && meta) {
        price     = meta.regularMarketPrice || meta.previousClose || null;
        prevClose = meta.previousClose || null;
        currency  = meta.currency || 'USD';
        exchange  = meta.exchangeName || '';
        if (price && prevClose) {
          changeAbs = price - prevClose;
          changePct = ((price - prevClose) / prevClose) * 100;
        }
      }
      // Variations multi-périodes
      const result = dc?.chart?.result?.[0];
      if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;
        const now = Date.now() / 1000;
        const findClose = ts => {
          let best=null, bestDiff=Infinity;
          timestamps.forEach((t,i)=>{ const d=Math.abs(t-ts); if(d<bestDiff&&closes[i]!=null){best=closes[i];bestDiff=d;} });
          return best;
        };
        const c1M  = findClose(now - 30*24*3600);
        const cYTD = findClose(new Date(new Date().getFullYear(),0,1).getTime()/1000);
        const c1Y  = findClose(now - 365*24*3600);
        if (c1M  && price) change1M  = ((price-c1M) /c1M) *100;
        if (cYTD && price) changeYTD = ((price-cYTD)/cYTD)*100;
        if (c1Y  && price) change1Y  = ((price-c1Y) /c1Y) *100;
      }
    }

    if (!price) return res.status(404).json({ error: `Cours introuvable pour ${symbol}` });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.json({ symbol, price, prevClose, changeAbs, changePct, change1M, changeYTD, change1Y, currency, exchange, timestamp:Date.now() });

  } catch(err) { return res.status(500).json({error:err.message}); }
};
