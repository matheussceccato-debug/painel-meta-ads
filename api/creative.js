export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.FB_ACCESS_TOKEN_PERMANENTE;
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const base = 'https://graph.facebook.com/v20.0';

  if (!token || !accountId) {
    return res.status(500).json({ error: 'Variáveis de ambiente não configuradas.' });
  }

  const { ad_id, date_preset, since, until } = req.query;
  if (!ad_id) return res.status(400).json({ error: 'ad_id obrigatório.' });

  try {
    // Buscar detalhes do criativo
    const creativeRes = await fetch(
      `${base}/${ad_id}?fields=name,creative{thumbnail_url,image_url,video_id,object_type,title,body,asset_feed_spec,effective_object_story_id}&access_token=${token}`
    );
    const creativeData = await creativeRes.json();
    if (creativeData.error) return res.status(400).json({ error: creativeData.error.message });

    const creative = creativeData.creative || {};
    let videoUrl = null;

    // Se for vídeo, buscar a URL do arquivo
    if (creative.video_id) {
      const videoRes = await fetch(`${base}/${creative.video_id}?fields=source,length,picture&access_token=${token}`);
      const videoJson = await videoRes.json();
      if (!videoJson.error) {
        videoUrl = videoJson.source || null;
        if (!creative.thumbnail_url) creative.thumbnail_url = videoJson.picture;
      }
    }

    // Buscar breakdown de posicionamentos
    let dateParam;
    if (since && until) {
      dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
    } else {
      dateParam = `date_preset=${date_preset || 'last_7d'}`;
    }

    const placementRes = await fetch(
      `${base}/act_${accountId}/insights?fields=impressions,spend&level=ad&breakdowns=publisher_platform,platform_position&filtering=${encodeURIComponent(JSON.stringify([{ field: 'ad.id', operator: 'IN', value: [ad_id] }]))}&${dateParam}&limit=100&access_token=${token}`
    );
    const placementData = await placementRes.json();
    const placements = (placementData.data || []).map(p => ({
      platform: p.publisher_platform,
      position: p.platform_position,
      impressions: parseInt(p.impressions || 0),
      spend: parseFloat(p.spend || 0)
    })).sort((a, b) => b.impressions - a.impressions);

    res.json({
      ad_name: creativeData.name,
      creative: {
        object_type: creative.object_type,
        thumbnail_url: creative.thumbnail_url,
        image_url: creative.image_url,
        video_url: videoUrl,
        video_id: creative.video_id,
        title: creative.title,
        body: creative.body,
        carousel: creative.asset_feed_spec?.images || null
      },
      placements
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
