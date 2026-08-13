export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token     = process.env.FB_ACCESS_TOKEN_PERMANENTE;
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const base      = 'https://graph.facebook.com/v20.0';

  if (!token || !accountId)
    return res.status(500).json({ error: 'Variáveis de ambiente não configuradas.' });

  const { date_preset, since, until, campaign_id } = req.query;

  const dateParam = since && until
    ? `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`
    : `date_preset=${date_preset || 'last_7d'}`;

  const campFilterArr = campaign_id
    ? [{ field: 'campaign.id', operator: 'IN', value: [campaign_id] }]
    : null;
  const campFilterStr = campFilterArr
    ? `&filtering=${encodeURIComponent(JSON.stringify(campFilterArr))}`
    : '';

  // Extrai um tipo de ação da lista de ações
  const getAct = (actions, type) => {
    const found = (actions || []).find(a => a.action_type === type);
    return found ? parseFloat(found.value) : 0;
  };

  const parseRow = (row, dimKey, dimKey2) => {
    const spend    = parseFloat(row.spend || 0);
    const purchases = Math.max(
      getAct(row.actions, 'purchase'),
      getAct(row.actions, 'offsite_conversion.fb_pixel_purchase')
    );
    const checkout = Math.max(
      getAct(row.actions, 'initiate_checkout'),
      getAct(row.actions, 'offsite_conversion.fb_pixel_initiate_checkout')
    );
    const cart = Math.max(
      getAct(row.actions, 'add_to_cart'),
      getAct(row.actions, 'offsite_conversion.fb_pixel_add_to_cart')
    );
    return {
      dimension:          dimKey2 ? `${row[dimKey]} / ${row[dimKey2]}` : (row[dimKey] || '—'),
      spend,
      impressions:        parseInt(row.impressions || 0),
      cpm:                parseFloat(row.cpm  || 0),
      clicks:             parseInt(row.clicks || 0),
      ctr:                parseFloat(row.ctr  || 0),
      cpc:                parseFloat(row.cpc  || 0),
      purchases,
      cost_per_purchase:  purchases > 0 ? spend / purchases : 0,
      initiate_checkout:  checkout,
      cost_per_checkout:  checkout > 0 ? spend / checkout : 0,
      add_to_cart:        cart,
      leads:              getAct(row.actions, 'lead'),
    };
  };

  try {
    const insightFields = 'impressions,spend,clicks,cpm,cpc,ctr,actions';
    const iBase = `${base}/act_${accountId}/insights?fields=${insightFields}&${dateParam}${campFilterStr}&limit=200&access_token=${token}`;

    const adsetFields = 'id,name,status,campaign{id,name},targeting,targeting_automation,is_dynamic_audience,optimization_goal';
    const adsetFilter = campFilterArr
      ? `&filtering=${encodeURIComponent(JSON.stringify(campFilterArr))}`
      : '';
    const adsetsUrl = `${base}/act_${accountId}/adsets?fields=${adsetFields}&limit=200${adsetFilter}&access_token=${token}`;

    const [ageJson, genderJson, countryJson, placementJson, adsetsJson] = await Promise.all([
      fetch(`${iBase}&breakdowns=age`).then(r => r.json()),
      fetch(`${iBase}&breakdowns=gender`).then(r => r.json()),
      fetch(`${iBase}&breakdowns=country`).then(r => r.json()),
      fetch(`${iBase}&breakdowns=publisher_platform,platform_position`).then(r => r.json()),
      fetch(adsetsUrl).then(r => r.json()),
    ]);

    const bySpend = arr => [...arr].sort((a, b) => b.spend - a.spend);

    const adsets = (adsetsJson.data || []).map(s => {
      const t  = s.targeting || {};
      const ta = s.targeting_automation || {};
      const gMap    = { 1: 'Masculino', 2: 'Feminino' };
      const genders = t.genders?.length
        ? t.genders.map(g => gMap[g] || g).join(', ')
        : 'Todos';
      const countries = t.geo_locations?.countries || [];
      const cities    = (t.geo_locations?.cities  || []).map(c => c.name);
      const regions   = (t.geo_locations?.regions || []).map(r => r.name);
      const geo       = [...countries, ...cities, ...regions].join(', ') || 'Não definido';
      const interests  = [
        ...(t.interests || []),
        ...(t.flexible_spec || []).flatMap(f => f.interests || [])
      ].map(i => i.name);
      const behaviors = [
        ...(t.behaviors || []),
        ...(t.flexible_spec || []).flatMap(f => f.behaviors || [])
      ].map(b => b.name);
      const custom   = (t.custom_audiences || []).map(c => c.name);
      const excluded = (t.exclusions?.custom_audiences || []).map(c => c.name);
      return {
        id: s.id, name: s.name, status: s.status,
        campaign_id: s.campaign?.id, campaign_name: s.campaign?.name,
        advantage_audience: ta.advantage_audience === 1,
        is_dynamic: !!s.is_dynamic_audience,
        age_min: t.age_min || 18, age_max: t.age_max || 65,
        genders, geo, interests, behaviors,
        custom_audiences: custom,
        excluded_audiences: excluded,
        optimization_goal: s.optimization_goal || '',
      };
    });

    res.json({
      by_age:       bySpend((ageJson.data       || []).map(r => parseRow(r, 'age'))),
      by_gender:    bySpend((genderJson.data    || []).map(r => parseRow(r, 'gender'))),
      by_country:   bySpend((countryJson.data   || []).map(r => parseRow(r, 'country'))).slice(0, 20),
      by_placement: bySpend((placementJson.data || []).map(r => parseRow(r, 'publisher_platform', 'platform_position'))),
      adsets,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
