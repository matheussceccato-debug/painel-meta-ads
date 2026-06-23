export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.FB_ACCESS_TOKEN_PERMANENTE;
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const base = `https://graph.facebook.com/v20.0`;

  if (!token || !accountId) {
    return res.status(500).json({ error: 'Variáveis de ambiente não configuradas: FB_ACCESS_TOKEN_PERMANENTE e FB_AD_ACCOUNT_ID são obrigatórias.' });
  }

  try {
    const [campsRes, adsetsRes, adsRes] = await Promise.all([
      fetch(`${base}/act_${accountId}/campaigns?fields=id,name,status,objective&limit=200&access_token=${token}`),
      fetch(`${base}/act_${accountId}/adsets?fields=id,name,campaign_id,status&limit=500&access_token=${token}`),
      fetch(`${base}/act_${accountId}/ads?fields=id,name,adset_id,status&limit=1000&access_token=${token}`)
    ]);

    const [camps, adsets, ads] = await Promise.all([
      campsRes.json(),
      adsetsRes.json(),
      adsRes.json()
    ]);

    if (camps.error) return res.status(400).json({ error: camps.error.message });

    res.json({
      campaigns: camps.data || [],
      adsets: adsets.data || [],
      ads: ads.data || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
