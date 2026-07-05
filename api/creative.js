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
    // Campos do criativo — inclui object_story_spec para carrossel e asset_feed_spec para dinâmico
    const creativeFields = [
      'name',
      'creative{thumbnail_url,image_url,video_id,object_type,title,body',
      'object_story_spec,asset_feed_spec}'
    ].join('');

    const creativeRes = await fetch(
      `${base}/${ad_id}?fields=${encodeURIComponent('name,creative{thumbnail_url,image_url,video_id,object_type,title,body,object_story_spec,asset_feed_spec}')}&access_token=${token}`
    );
    const creativeData = await creativeRes.json();
    if (creativeData.error) return res.status(400).json({ error: creativeData.error.message });

    const creative = creativeData.creative || {};
    let videoUrl = null;
    let videoPicture = null;
    let carousel = null;

    // ── Detectar carrossel via object_story_spec ──────────────────────────
    const linkData = creative.object_story_spec?.link_data;
    const childAttachments = linkData?.child_attachments || [];

    if (childAttachments.length > 1) {
      // Carrossel padrão
      carousel = childAttachments.map(c => ({
        url: c.picture || null,
        video_id: c.video_id || null,
        name: c.name || '',
        description: c.description || '',
        link: c.link || ''
      }));
    }

    // ── Detectar carrossel via asset_feed_spec (creative dinâmico) ────────
    if (!carousel) {
      const feedImages = creative.asset_feed_spec?.images || [];
      const feedVideos = creative.asset_feed_spec?.videos || [];
      const allAssets = [...feedImages, ...feedVideos];
      if (allAssets.length > 1) {
        carousel = allAssets.map(a => ({
          url: a.url || a.picture || null,
          video_id: a.video_id || null,
          name: ''
        }));
      }
    }

    // ── Buscar URL de vídeo ───────────────────────────────────────────────
    const videoId = creative.video_id || (carousel === null && linkData?.video_id) || null;

    if (videoId) {
      const videoRes = await fetch(
        `${base}/${videoId}?fields=source,picture,length,embeddable_link&access_token=${token}`
      );
      const videoJson = await videoRes.json();
      if (!videoJson.error) {
        videoUrl = videoJson.source || null;
        videoPicture = videoJson.picture || creative.thumbnail_url || null;
      }
    }

    // ── Buscar URLs dos slides de vídeo dentro do carrossel ───────────────
    if (carousel) {
      for (let i = 0; i < carousel.length; i++) {
        if (carousel[i].video_id && !carousel[i].url) {
          const vRes = await fetch(
            `${base}/${carousel[i].video_id}?fields=picture&access_token=${token}`
          );
          const vJson = await vRes.json();
          if (!vJson.error) carousel[i].url = vJson.picture || null;
        }
      }
    }

    // ── Breakdown de posicionamentos ──────────────────────────────────────
    let dateParam;
    if (since && until) {
      dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
    } else {
      dateParam = `date_preset=${date_preset || 'last_7d'}`;
    }

    const placementRes = await fetch(
      `${base}/act_${accountId}/insights?fields=impressions,spend&level=ad` +
      `&breakdowns=publisher_platform,platform_position` +
      `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'ad.id', operator: 'IN', value: [ad_id] }]))}` +
      `&${dateParam}&limit=100&access_token=${token}`
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
        thumbnail_url: videoPicture || creative.thumbnail_url,
        image_url: creative.image_url,
        video_url: videoUrl,
        video_id: videoId,
        title: creative.title,
        body: creative.body,
        carousel
      },
      placements
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
