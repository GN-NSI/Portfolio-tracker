module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'symbol requis' });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Yahoo Finance indisponible' });
    }

    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice || meta?.previousClose;

    if (!price) {
      return res.status(404).json({ error: `Cours introuvable pour ${symbol}` });
    }

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
