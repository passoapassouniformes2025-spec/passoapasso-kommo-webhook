const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUBDOMAIN = 'passoapassouniformes2025';
const TOKEN     = process.env.KOMMO_TOKEN; // token da integração privada

// IDs dos pipelines criados
const PIPELINE = {
  main:        13368211,
  empresarial: 13664859,
  fitness:     13664863,
  formandos:   13664867,
  futebol:     13664871,
  inverno:     13664875,
  menos10:     13664879,
};

// Status "Etapa de leads de entrada" de cada pipeline (para onde mover)
const ENTRADA_STATUS = {
  empresarial: 105455831,
  fitness:     105455875,
  formandos:   105455919,
  futebol:     105455963,
  inverno:     105456007,
  menos10:     105456051,
};

// ─── MAPEAMENTO DE PALAVRAS-CHAVE ──────────────────────────────────────────
const REGRAS = [
  { keywords: ['linha empresarial', 'empresarial'],                                pipeline: 'empresarial' },
  { keywords: ['linha fitness', 'fitness'],                                         pipeline: 'fitness'     },
  { keywords: ['linha formandos', 'formandos', 'formatura'],                        pipeline: 'formandos'   },
  { keywords: ['linha futebol', 'futebol', 'time de futebol', 'fut'],               pipeline: 'futebol'     },
  { keywords: ['linha inverno', 'inverno', 'moletom', 'jaqueta', 'blusa de frio'],  pipeline: 'inverno'     },
  { keywords: ['menos de 10', 'menos que 10', 'menos de dez', 'só 1 peça',
               'só 2 peças', 'só 3 peças', 'avulso', 'unidade', 'peça avulsa'],     pipeline: 'menos10'     },
];

function detectarPipeline(texto) {
  if (!texto) return null;
  const lower = texto.toLowerCase();
  for (const regra of REGRAS) {
    if (regra.keywords.some(kw => lower.includes(kw))) {
      return regra.pipeline;
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

async function moveLead(leadId, pipelineKey) {
  const pipelineId = PIPELINE[pipelineKey];
  const statusId   = ENTRADA_STATUS[pipelineKey];
  const res = await fetch(`https://${SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipeline_id: pipelineId, status_id: statusId })
  });
  const data = await res.json();
  console.log(`[MOVE] Lead ${leadId} → pipeline "${pipelineKey}" | status ${res.status}`);
  return data;
}

// ─── ROTA PRINCIPAL DO WEBHOOK ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('[WEBHOOK]', JSON.stringify(body).substring(0, 500));

    // Kommo envia leads em body.leads.add (novo) ou body.leads.update
    const leadsAdicionados = body?.leads?.add || [];

    for (const lead of leadsAdicionados) {
      const leadId     = lead.id;
      const pipelineId = lead.pipeline_id;

      // Só processa leads do pipeline principal (evita loop)
      if (Number(pipelineId) !== PIPELINE.main) continue;

      // Pega dados completos do lead (com notes = mensagem inicial)
      const leadData = await getLead(leadId);
      const notas    = leadData?._embedded?.notes || [];

      // A mensagem do WhatsApp fica nas notas do tipo 'amocontact' ou 'common'
      const textoMensagem = notas
        .map(n => n.params?.text || n.text || '')
        .join(' ');

      // Também tenta o nome do lead (às vezes a mensagem fica no nome)
      const textoTotal = `${lead.name || ''} ${textoMensagem}`;

      const pipelineKey = detectarPipeline(textoTotal);

      if (pipelineKey) {
        await moveLead(leadId, pipelineKey);
      } else {
        console.log(`[SKIP] Lead ${leadId} — sem palavra-chave detectada. Texto: "${textoTotal.substring(0,100)}"`);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[ERRO]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'kommo-webhook-router' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
