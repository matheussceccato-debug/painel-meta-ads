// Painel / aba Pre-analise
//
// Le as respostas do formulario 4E no Supabase e devolve ja resumido, para o
// painel so desenhar. Somente leitura: este endpoint nunca escreve.
//
// Env vars na Vercel: SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// A service key ignora RLS, entao ela vive so aqui no servidor. O navegador
// nunca a ve: ele chama /api/pre-analises e recebe o resultado pronto.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'SUPABASE_URL ou SUPABASE_SERVICE_KEY não configuradas na Vercel.' });
  }

  const dias = Math.min(Number(req.query.dias) || 90, 365);
  const desde = new Date(Date.now() - dias * 864e5).toISOString();

  const headers = { apikey: key, Authorization: 'Bearer ' + key };

  try {
    const campos = [
      'id', 'codigo', 'criado_em', 'nome', 'marca', 'email', 'whatsapp', 'perfil',
      'lojas', 'internet', 'cd', 'itens_ativos', 'sistema', 'producao', 'historico',
      'plano_12m', 'faturamento', 'investimentos',
      'soma_enxergar', 'soma_estruturar', 'soma_escalar', 'soma_evoluir',
      'nivel_enxergar', 'nivel_estruturar', 'nivel_escalar', 'nivel_evoluir',
      'desenho', 'gato_preto', 'avisos', 'agendou',
    ].join(',');

    const r = await fetch(
      `${url}/rest/v1/pre_analises?select=${campos}&criado_em=gte.${desde}&order=criado_em.desc&limit=500`,
      { headers }
    );
    if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const linhas = await r.json();

    // ---------------------------------------------------------- resumo
    const conta = (campo) => {
      const m = {};
      for (const l of linhas) {
        const v = l[campo] == null || l[campo] === '' ? 'não informado' : l[campo];
        m[v] = (m[v] || 0) + 1;
      }
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };

    // Distribuicao de nivel por E. 1 no escuro, 2 na mao, 3 estruturado.
    const niveis = {};
    for (const e of ['enxergar', 'estruturar', 'escalar', 'evoluir']) {
      niveis[e] = { 1: 0, 2: 0, 3: 0 };
      for (const l of linhas) {
        const n = l['nivel_' + e];
        if (n >= 1 && n <= 3) niveis[e][n]++;
      }
    }

    const agendaram = linhas.filter((l) => l.agendou).length;

    // Quem investiu em alguma coisa nos ultimos 12 meses ja aceitou gastar.
    const investimentos = {};
    for (const l of linhas) {
      for (const i of l.investimentos || []) investimentos[i] = (investimentos[i] || 0) + 1;
    }

    res.status(200).json({
      atualizado_em: new Date().toISOString(),
      dias,
      total: linhas.length,
      agendaram,
      taxa_agendamento: linhas.length ? agendaram / linhas.length : 0,
      niveis,
      por_perfil: conta('perfil'),
      por_desenho: conta('desenho'),
      por_gato: conta('gato_preto'),
      por_faturamento: conta('faturamento'),
      por_plano: conta('plano_12m'),
      por_sistema: conta('sistema'),
      por_investimento: Object.entries(investimentos).sort((a, b) => b[1] - a[1]),
      linhas,
    });
  } catch (erro) {
    console.error('pre-analises:', erro.message);
    res.status(500).json({ error: 'Falha ao ler as pré-análises.' });
  }
}
