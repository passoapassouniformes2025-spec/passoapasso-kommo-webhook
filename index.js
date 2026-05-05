const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUBDOMAIN    = 'passoapassouniformes2025';
const TOKEN        = process.env.KOMMO_TOKEN;
const PIPELINE_ID  = 13368211; // funil principal (único)

// IDs das etapas criadas dentro do funil principal
const ETAPA = {
  empresarial: 105468287,
  fitness:     105468291,
  formandos:   105468295,
  futebol:     105468231,
  inverno:     105468299,
  menos10:     105468303,
};

// ─── MAPEAMENTO DE PALAVRAS-CHAVE ──────────────────────────────────────────
const REGRAS = [
  { keywords: ['linha empresarial', 'empresarial'],                                etapa: 'empresarial' },
  { keywords: ['linha fitness', 'fitness'],                                         etapa: 'fitness'     },
  { keywords: ['linha formandos', 'formandos', 'formatura'],                        etapa: 'formandos'   },
  { keywords: ['linha futebol', 'futebol', 'time de futebol', 'fut'],               etapa: 'futebol'     },
  { keywords: ['linha inverno', 'inverno', 'moletom', 'jaqueta', 'blusa de frio'],  etapa: 'inverno'     },
  { keywords: ['menos de 10', 'menos que 10', 'menos de dez', 'só 1 peça',
               'só 2 peças', 'só 3 peças', 'avulso', 'unidade', 'peça avulsa'],     etapa: 'menos10'     },
];

function detectarEtapa(texto) {
  if (!texto) return null;
  const lower = texto.toLowerCase();
  for (const regra of REGRAS) {
    if (regra.keywords.some(kw => lower.includes(kw))) {
      return regra.etapa;
    }
  }
  return null;
}

// ─── FUNÇÕES DA API KOMMO ──────────────────────────────────────────────────
async function getLead(leadId) {
  const res = await fetch(`https://${SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=notes`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  return res.json();
}

async function moverParaEtapa(leadId, etapaKey) {
  const statusId = ETAPA[etapaKey];
  const res = await fetch(`https://${SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status_id: statusId })
  });
  const data = await res.json();
  console.log(`[MOVE] Lead ${leadId} → etapa "${etapaKey}" (status_id ${statusId}) | HTTP ${res.status}`);
  return data;
}

// ─── ROTA PRINCIPAL DO WEBHOOK ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('[WEBHOOK]', JSON.stringify(body).substring(0, 600));

    const leadsAdicionados = body?.leads?.add || [];

    for (const lead of leadsAdicionados) {
      const leadId     = lead.id;
      const pipelineId = Number(lead.pipeline_id);

      // Só processa leads que entram no pipeline principal (evita loop)
      if (pipelineId !== PIPELINE_ID) {
        console.log(`[SKIP] Lead ${leadId} ignorado — pipeline ${pipelineId} !== ${PIPELINE_ID}`);
        continue;
      }

      // Busca dados completos do lead incluindo notas (mensagem do WhatsApp)
      const leadData = await getLead(leadId);
      const notas    = leadData?._embedded?.notes || [];

      const textoMensagem = notas
        .map(n => n.params?.text || n.text || '')
        .join(' ');

      // Combina nome do lead + mensagem para detectar palavra-chave
      const textoTotal = `${lead.name || ''} ${textoMensagem}`;
      console.log(`[ANALISE] Lead ${leadId} | texto: "${textoTotal.substring(0, 150)}"`);

      const etapaKey = detectarEtapa(textoTotal);

      if (etapaKey) {
        await moverParaEtapa(leadId, etapaKey);
      } else {
        console.log(`[SEM MATCH] Lead ${leadId} — nenhuma palavra-chave detectada`);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[ERRO]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'kommo-webhook-router' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
