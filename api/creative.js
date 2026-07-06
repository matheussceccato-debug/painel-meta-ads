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
    // ── 1. Buscar criativo com campos expandidos ───────────────────────────
    const fields = [
      'name,',
      'creative{',
        'id,thumbnail_url,image_url,video_id,object_type,title,body,',
        'object_story_spec{',
          'link_data{child_attachments{picture,image_hash,video_id,name,description,link}},',
          'video_data{video_id,image_url}',
        '},',
        'asset_feed_spec{images{hash,url},videos{video_id,picture}}',
      '}'
    ].join('');

    const creativeRes = await fetch(
      `${base}/${ad_id}?fields=${encodeURIComponent(fields)}&access_token=${token}`
    );
    const creativeData = await creativeRes.json();
    if (creativeData.error) return res.status(400).json({ error: creativeData.error.message });

    const creative = creativeData.creative || {};
    let videoUrl = null;
    let videoEmbedUrl = null;
    let videoPicture = null;
    let carousel = null;

    // ── 2. Carrossel via child_attachments ────────────────────────────────
    const childAttachments = creative.object_story_spec?.link_data?.child_attachments || [];

    if (childAttachments.length > 1) {
      // Coletar image_hashes sem picture para buscar em lote
      const hashesNeeded = childAttachments
        .filter(c => !c.picture && c.image_hash)
        .map(c => c.image_hash);

      let hashUrlMap = {};
      if (hashesNeeded.length > 0) {
        const imgRes = await fetch(
          `${base}/act_${accountId}/adimages?hashes=${encodeURIComponent(JSON.stringify(hashesNeeded))}&fields=url,hash&access_token=${token}`
        );
        const imgData = await imgRes.json();
        for (const img of (imgData.data || [])) {
          if (img.hash && img.url) hashUrlMap[img.hash] = img.url;
        }
      }

      carousel = await Promise.all(childAttachments.map(async c => {
        let url = c.picture || hashUrlMap[c.image_hash] || null;

        // Se for slide de vídeo, busca thumbnail
        if (!url && c.video_id) {
          const vRes = await fetch(`${base}/${c.video_id}?fields=picture&access_token=${token}`);
          const vJson = await vRes.json();
          if (!vJson.error) url = vJson.picture || null;
        }

        return { url, video_id: c.video_id || null, name: c.name || '', description: c.description || '' };
      }));
    }

    // ── 3. Carrossel via asset_feed_spec (criativo dinâmico) ──────────────
    if (!carousel) {
      const feedImages = creative.asset_feed_spec?.images || [];
      const feedVideos = creative.asset_feed_spec?.videos || [];

      // Buscar URLs dos hashes de imagem
      const hashesNeeded = feedImages.filter(i => !i.url && i.hash).map(i => i.hash);
      let hashUrlMap = {};
      if (hashesNeeded.length > 0) {
        const imgRes = await fetch(
          `${base}/act_${accountId}/adimages?hashes=${encodeURIComponent(JSON.stringify(hashesNeeded))}&fields=url,hash&access_token=${token}`
        );
        const imgData = await imgRes.json();
        for (const img of (imgData.data || [])) {
          if (img.hash && img.url) hashUrlMap[img.hash] = img.url;
        }
      }

      const allAssets = [
        ...feedImages.map(i => ({ url: i.url || hashUrlMap[i.hash] || null, video_id: null, name: '' })),
        ...feedVideos.map(v => ({ url: v.thumbnail_url || null, video_id: v.video_id || null, name: '' }))
      ];

      if (allAssets.length > 1) carousel = allAssets;
    }

    // ── 4. Vídeo ──────────────────────────────────────────────────────────
    const videoId = creative.video_id
      || creative.object_story_spec?.video_data?.video_id
      || null;

    if (videoId) {
      const videoRes = await fetch(
        `${base}/${videoId}?fields=source,picture,embed_html,permalink_url&access_token=${token}`
      );
      const videoJson = await videoRes.json();
      if (!videoJson.error) {
        videoUrl = videoJson.source || null;
        videoPicture = videoJson.picture
          || creative.object_story_spec?.video_data?.image_url
          || creative.thumbnail_url
          || null;

        // embed_html retorna o iframe oficial do Facebook (funciona cross-origin)
        if (!videoUrl && videoJson.embed_html) {
          // Extrair o src do iframe para usar diretamente
          const match = videoJson.embed_html.match(/src="([^"]+)"/);
          videoEmbedUrl = match ? match[1].replace(/&amp;/g, '&') : null;
        }

        // permalink_url como fallback de link direto
        if (!videoUrl && !videoEmbedUrl && videoJson.permalink_url) {
          videoEmbedUrl = null; // não tem embed, mas guarda para exibir link
          videoPicture = videoPicture || null;
        }
      }

      if (!videoPicture) videoPicture = creative.thumbnail_url || null;

      // Garantir que o response inclua permalink para o link de fallback
      if (!videoUrl && !videoEmbedUrl) {
        // Último recurso: plugin embed do Facebook
        videoEmbedUrl = `https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fvideo%2Fembed%3Fvideo_id%3D${videoId}&width=400&show_text=false&height=300&appId`;
      }
    }

    // ── 5. Breakdown de posicionamentos ───────────────────────────────────
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
        video_embed_url: videoEmbedUrl,
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
