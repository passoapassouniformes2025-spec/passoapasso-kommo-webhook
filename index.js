const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUBDOMAIN   = 'passoapassouniformes2025';
const TOKEN       = process.env.KOMMO_TOKEN;
const PIPELINE_ID = 13368211;
const ETAPA_ENTRADA = 103109571; // "Etapa de leads de entrada"

// IDs das etapas no funil principal
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
    if (regra.keywords.some(kw => lower.includes(kw))) return regra.etapa;
  }
  return null;
}

// ─── FUNÇÕES DA API KOMMO ──────────────────────────────────────────────────
const headers = () => ({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
const BASE = `https://${SUBDOMAIN}.kommo.com/api/v4`;

async function getLead(leadId) {
  const res = await fetch(`${BASE}/leads/${leadId}?with=notes`, { headers: headers() });
  return res.json();
}

async function getTalkMessages(talkId) {
  const res = await fetch(`${BASE}/talks/${talkId}/messages?limit=10`, { headers: headers() });
  if (!res.ok) return [];
  const data = await res.json();
  return data._embedded?.messages || [];
}

async function getTalkByLead(leadId) {
  const res = await fetch(`${BASE}/talks?filter[entity_id]=${leadId}&filter[entity_type]=lead&limit=1`, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json();
  return data._embedded?.talks?.[0] || null;
}

async function moverParaEtapa(leadId, etapaKey) {
  const statusId = ETAPA[etapaKey];
  const res = await fetch(`${BASE}/leads/${leadId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status_id: statusId })
  });
  console.log(`[MOVE] Lead ${leadId} → "${etapaKey}" (status ${statusId}) | HTTP ${res.status}`);
}

// ─── PROCESSAMENTO DE UM LEAD ──────────────────────────────────────────────
async function processarLead(leadId, textoExtra = '') {
  const leadData = await getLead(leadId);

  // Verifica se ainda está na etapa de entrada
  if (leadData.status_id !== ETAPA_ENTRADA) {
    console.log(`[SKIP] Lead ${leadId} já está na etapa ${leadData.status_id}`);
    return;
  }

  // Coleta textos: notas + mensagens do talk + texto extra do webhook
  const notas = leadData._embedded?.notes || [];
  const textoNotas = notas.map(n => n.params?.text || n.text || '').join(' ');

  // Tenta pegar mensagens do talk (WhatsApp)
  let textoTalk = '';
  const talk = await getTalkByLead(leadId);
  if (talk) {
    const msgs = await getTalkMessages(talk.talk_id);
    textoTalk = msgs
      .filter(m => m.author_type === 'contact') // só mensagens do cliente
      .map(m => m.text || '')
      .join(' ');
    console.log(`[TALK] Lead ${leadId} | talk_id ${talk.talk_id} | msg: "${textoTalk.substring(0, 150)}"`);
  }

  const textoTotal = `${leadData.name || ''} ${textoNotas} ${textoTalk} ${textoExtra}`.trim();
  console.log(`[ANALISE] Lead ${leadId} | texto total: "${textoTotal.substring(0, 200)}"`);

  const etapaKey = detectarEtapa(textoTotal);
  if (etapaKey) {
    await moverParaEtapa(leadId, etapaKey);
  } else {
    console.log(`[SEM MATCH] Lead ${leadId} — nenhuma palavra-chave encontrada`);
  }
}

// ─── ROTA PRINCIPAL DO WEBHOOK ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.json({ ok: true }); // responde imediatamente ao Kommo

  try {
    const body = req.body;
    console.log('[WEBHOOK]', JSON.stringify(body).substring(0, 400));

    // Evento: novo lead adicionado
    const leadsAdd = body?.leads?.add || [];
    for (const lead of leadsAdd) {
      if (Number(lead.pipeline_id) !== PIPELINE_ID) continue;
      console.log(`[ADD_LEAD] Lead ${lead.id}`);
      await processarLead(lead.id, lead.name || '');
    }

    // Evento: talk atualizado (nova mensagem WhatsApp)
    const talksUpdate = body?.talks?.update || [];
    for (const talk of talksUpdate) {
      const leadId = talk.entity_id || talk.lead_id;
      if (!leadId) continue;
      console.log(`[UPDATE_TALK] talk_id ${talk.id || talk.talk_id} | lead ${leadId}`);
      // Pequena espera para a mensagem ser gravada no sistema
      setTimeout(() => processarLead(leadId, ''), 2000);
    }
  } catch (err) {
    console.error('[ERRO]', err.message);
  }
});

// ─── POLLING: verifica leads novos a cada 45 segundos ─────────────────────
const leadsProcessados = new Set();

async function polling() {
  try {
    const cincoMinAtras = Math.floor(Date.now() / 1000) - 300;
    const res = await fetch(
      `${BASE}/leads?filter[pipeline_id]=${PIPELINE_ID}&filter[status_id]=${ETAPA_ENTRADA}&filter[created_at][from]=${cincoMinAtras}&limit=20`,
      { headers: headers() }
    );
    if (!res.ok) return;
    const data = await res.json();
    const leads = data._embedded?.leads || [];

    for (const lead of leads) {
      if (leadsProcessados.has(lead.id)) continue;
      leadsProcessados.add(lead.id);
      console.log(`[POLLING] Lead novo detectado: ${lead.id}`);
      await processarLead(lead.id, lead.name || '');
    }

    // Limpa set após 10 min para não crescer indefinidamente
    if (leadsProcessados.size > 500) leadsProcessados.clear();
  } catch (err) {
    console.error('[POLLING ERRO]', err.message);
  }
}

setInterval(polling, 45000);
console.log('[POLLING] Iniciado — verifica leads novos a cada 45 segundos');

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', service: 'kommo-webhook-router' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
