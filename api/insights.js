export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.FB_ACCESS_TOKEN_PERMANENTE;
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const base = 'https://graph.facebook.com/v20.0';

  if (!token || !accountId) {
    return res.status(500).json({ error: 'Variáveis de ambiente não configuradas.' });
  }

  const { campaign_ids, adset_ids, ad_ids, date_preset, since, until } = req.query;

  // Nível da consulta baseado no filtro mais específico selecionado
  let level = 'campaign';
  if (ad_ids && ad_ids !== 'all') level = 'ad';
  else if (adset_ids && adset_ids !== 'all') level = 'adset';

  const fields = [
    'campaign_id', 'campaign_name',
    'adset_id', 'adset_name',
    'ad_id', 'ad_name',
    'date_start', 'date_stop',
    'impressions', 'reach', 'clicks', 'spend', 'ctr', 'cpm', 'cpc',
    'actions', 'cost_per_action_type',
    'video_p25_watched_actions', 'video_p50_watched_actions',
    'video_p75_watched_actions', 'video_p100_watched_actions',
    'video_thruplay_watched_actions', 'video_continuous_2_sec_watched_actions'
  ].join(',');

  // Filtro por IDs
  let filtering = null;
  if (ad_ids && ad_ids !== 'all') {
    filtering = [{ field: 'ad.id', operator: 'IN', value: ad_ids.split(',') }];
  } else if (adset_ids && adset_ids !== 'all') {
    filtering = [{ field: 'adset.id', operator: 'IN', value: adset_ids.split(',') }];
  } else if (campaign_ids && campaign_ids !== 'all') {
    filtering = [{ field: 'campaign.id', operator: 'IN', value: campaign_ids.split(',') }];
  }

  // Período
  let dateParam;
  if (since && until) {
    dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  } else {
    dateParam = `date_preset=${date_preset || 'last_7d'}`;
  }

  const filterParam = filtering
    ? `&filtering=${encodeURIComponent(JSON.stringify(filtering))}`
    : '';

  const url = `${base}/act_${accountId}/insights?fields=${encodeURIComponent(fields)}&level=${level}&time_increment=1&${dateParam}${filterParam}&limit=500&access_token=${token}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    // Paginação: coleta todas as páginas
    let allRows = data.data || [];
    let next = data.paging?.next;
    let pages = 0;

    while (next && allRows.length < 5000 && pages < 10) {
      const nextRes = await fetch(next);
      const nextData = await nextRes.json();
      allRows = [...allRows, ...(nextData.data || [])];
      next = nextData.paging?.next;
      pages++;
    }

    res.json({ data: allRows, level });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
