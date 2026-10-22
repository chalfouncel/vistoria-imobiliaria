export const config = {
  maxDuration: 120,
  api: { bodyParser: { sizeLimit: '15mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const groqApiKey = process.env.GROQ2_API_KEY;
  const vistoriaOpenApiKey = process.env.VISTORIA_OPEN_API_KEY;

  if (!geminiApiKey && !groqApiKey && !vistoriaOpenApiKey) {
    return res.status(500).json({ error: 'Configure GEMINI_API_KEY, GROQ2_API_KEY ou VISTORIA_OPEN_API_KEY nas variáveis de ambiente da Vercel.' });
  }

  const { roomName, photosDataUrls, isMeterReading } = req.body;

  if (!Array.isArray(photosDataUrls) || photosDataUrls.length === 0) {
    return res.status(400).json({ error: 'Nenhuma fotografia enviada.' });
  }

  // ------------------------------------------------------------------
  // PROMPT ÚNICO (usado por todos os provedores)
  // ------------------------------------------------------------------
  const promptBase = `Você é perito de vistoria imobiliária. Analise TODAS as fotos do ambiente ou item "${roomName}" em conjunto. 
Compare as imagens, mas descreva cada foto apenas pelo que está visível nela. 
Não invente funcionamento, medidas, marcas, materiais, cores exatas ou avarias. 
Não trate sombra, reflexo ou sujeira como dano sem evidência. 
Quando funcionamento não puder ser testado, escreva "Não verificável por fotografia". 
A coluna DESCRIÇÃO E ESTADO DE CONSERVAÇÃO deve ser detalhada. 
Retorne exatamente ${photosDataUrls.length} itens em fotos, na ordem recebida. 
Use classificações: BOM ESTADO APARENTE, REGULAR/ATENÇÃO, AVARIA VISÍVEL ou NÃO CONCLUSIVO.`;

  const promptMeter = isMeterReading
    ? ` ATENÇÃO ESPECIAL: Este item é um medidor técnico ("${roomName}"). Identifique obrigatoriamente nos visores das fotografias o número de série/identificação do aparelho e a leitura numérica atual do consumo, informando-os claramente na descrição e nos elementos técnicos.`
    : '';

  const prompt = promptBase + promptMeter;

  // ------------------------------------------------------------------
  // SCHEMA JSON (Gemini usa nativamente; OpenRouter/Groq recebem no prompt)
  // ------------------------------------------------------------------
  const schema = {
    type: "object",
    properties: {
      introducao: { type: "string" },
      elementos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            elemento: { type: "string" },
            descricao: { type: "string" },
            funcionamento: { type: "string" },
            classificacao: { type: "string" }
          },
          required: ["elemento", "descricao", "funcionamento", "classificacao"]
        }
      },
      fotos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            descricao: { type: "string" },
            avaria: { type: "boolean" }
          },
          required: ["titulo", "descricao", "avaria"]
        }
      },
      ressalvas: { type: "string" }
    },
    required: ["introducao", "elementos", "fotos", "ressalvas"]
  };

try {
    const erros = [];

    // 1) Tenta OpenRouter com todas as fotos do cômodo de uma vez
    if (vistoriaOpenApiKey) {
      try {
        const resOpen = await chamarOpenRouter(vistoriaOpenApiKey, photosDataUrls, prompt, schema);
        return res.status(200).json(unificarResultados([resOpen], photosDataUrls.length, roomName));
      } catch (err) {
        erros.push('OpenRouter: ' + err.message);
      }
    }

    // 2) Se OpenRouter falhar, tenta Gemini com todas as fotos de uma vez
    if (geminiApiKey) {
      try {
        const resGemini = await chamarGemini(geminiApiKey, photosDataUrls, prompt, schema);
        return res.status(200).json(unificarResultados([resGemini], photosDataUrls.length, roomName));
      } catch (err) {
        erros.push('Gemini: ' + err.message);
      }
    }

    // 3) Se Gemini falhar, tenta Groq dividindo em lotes de até 3 fotos
    if (groqApiKey) {
      try {
        const TAMANHO_LOTE = 3;
        const resultadosParciais = [];
        for (let i = 0; i < photosDataUrls.length; i += TAMANHO_LOTE) {
          const lote = photosDataUrls.slice(i, i + TAMANHO_LOTE);
          const idxLote = Math.floor(i / TAMANHO_LOTE) + 1;
          const totalLotes = Math.ceil(photosDataUrls.length / TAMANHO_LOTE);
          const promptLote = `${prompt}\n\nESTE É O LOTE ${idxLote} DE ${totalLotes}. Analise APENAS as ${lote.length} foto(s) deste lote.`;
          const resGroq = await chamarGroq(groqApiKey, lote, promptLote, schema);
          resultadosParciais.push(resGroq);
        }
        return res.status(200).json(unificarResultados(resultadosParciais, photosDataUrls.length, roomName));
      } catch (err) {
        erros.push('Groq: ' + err.message);
      }
    }

    return res.status(500).json({
      error: 'Nenhum provedor de IA respondeu com sucesso.',
      details: erros
    });

  } catch (error) {
    console.error('Falha no audit:', error);
    return res.status(500).json({ error: 'Erro interno no processamento.', details: error.message });
  }
}

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

function unificarResultados(resultadosParciais, totalFotos, roomName) {
  const introducoes = [];
  const todosElementos = [];
  const todasFotos = [];
  const ressalvas = [];
  
resultadosParciais.forEach((r, idx) => {
    if (r.introducao) {
      introducoes.push(resultadosParciais.length > 1 ? `Lote ${idx + 1}: ${r.introducao}` : r.introducao);
    }
    if (Array.isArray(r.elementos)) todosElementos.push(...r.elementos);
    if (Array.isArray(r.fotos)) todasFotos.push(...r.fotos);
    if (r.ressalvas) ressalvas.push(r.ressalvas);
  });
  
  // Garante que o array de fotos tenha o tamanho correto
  while (todasFotos.length < totalFotos) {
    todasFotos.push({
      titulo: `Registro ${todasFotos.length + 1} — ${roomName}`,
      descricao: 'Registro fotográfico técnico do item.',
      avaria: false
    });
  }

  return {
    introducao: introducoes.length
      ? introducoes.join(' ')
      : `Auditoria técnica do item/ambiente ${roomName}.`,
    elementos: todosElementos.length
      ? todosElementos
      : [{ elemento: roomName, descricao: 'Constatações limitadas ao registro fotográfico.', funcionamento: 'Em conformidade visual', classificacao: 'BOM' }],
    fotos: todasFotos.slice(0, totalFotos),
    ressalvas: ressalvas.length
      ? ressalvas.join(' ')
      : 'Registros consolidados conforme visualizado no momento da inspeção.'
  };
}

// ============================================================================
// OPENROUTER (VISTORIA_OPEN_API_KEY) — PROVEDOR PRINCIPAL
// ============================================================================
async function chamarOpenRouter(apiKey, photosDataUrls, prompt, schema) {

  const content = [
    { type: "text", text: prompt + '\n\nResponda APENAS com um JSON válido, sem markdown, seguindo exatamente este schema: ' + JSON.stringify(schema) },
    ...photosDataUrls.map((url, idx) => ({
      type: "image_url",
      image_url: { url: url }
    }))
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://vistoria-imobiliaria.vercel.app',
      'X-Title': 'Vistoria Imobiliária'
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${err}`);
  }

  const data = await response.json();
  const contentText = data.choices?.[0]?.message?.content;

  if (!contentText) {
    throw new Error('OpenRouter respondeu sem conteúdo.');
  }

  // Limpa possível markdown ```json ... ```
  const jsonLimpo = contentText.replace(/```json\s?|```/g, '').trim();
  return JSON.parse(jsonLimpo);
}

// ============================================================================
// GEMINI
// ============================================================================
async function chamarGemini(geminiApiKey, photosDataUrls, prompt, schema) {
  const parts = [{ text: prompt }];
  photosDataUrls.forEach((dataUrl, idx) => {
    const b64 = dataUrl.split(',')[1];
    parts.push({ text: `FOTO ${idx + 1} DE ${photosDataUrls.length}` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  });

  const payload = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      maxOutputTokens: 3600
    }
  });

  const targetModels = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash"
  ];

  for (const model of targetModels) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });

      const data = await response.json();
      if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return JSON.parse(data.candidates[0].content.parts[0].text);
      }
    } catch (err) {
      continue;
    }
  }

  throw new Error('Todos os modelos Gemini falharam.');
}

// ============================================================================
// GROQ
// ============================================================================
async function chamarGroq(groqApiKey, photosDataUrls, prompt, schema) {
  // Groq só aceita até 3 imagens por request (já garantido pelo caller)
  if (photosDataUrls.length > 3) {
    throw new Error('Groq aceita no máximo 3 imagens por request.');
  }

  const content = [
    { type: "text", text: prompt + '\n\nResponda APENAS com um JSON válido, sem markdown, seguindo exatamente este schema: ' + JSON.stringify(schema) },
    ...photosDataUrls.map((url, idx) => ({
      type: "image_url",
      image_url: { url: url }
    }))
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqApiKey}`
    },
    body: JSON.stringify({
      model: "qwen/qwen3.8-27b",
      messages: [{ role: "user", content }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq HTTP ${response.status}: ${err}`);
  }

  const data = await response.json();
  const contentText = data.choices?.[0]?.message?.content;

  if (!contentText) {
    throw new Error('Groq respondeu sem conteúdo.');
  }

  // Limpa possível markdown ```json ... ```
  const jsonLimpo = contentText.replace(/```json\s?|```/g, '').trim();
  return JSON.parse(jsonLimpo);
}
