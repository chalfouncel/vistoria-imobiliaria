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

  const { roomName, photosDataUrls, isMeterReading, roomNote } = req.body;

  if (!Array.isArray(photosDataUrls) || photosDataUrls.length === 0) {
    return res.status(400).json({ error: 'Nenhuma fotografia enviada.' });
  }

  // ------------------------------------------------------------------
  // PROMPT ÚNICO (usado por todos os provedores)
  // ------------------------------------------------------------------
  const promptBase = `Você é perito de vistoria imobiliária. Analise TODAS as fotos do ambiente ou item "${roomName}" em conjunto.
Nos "elementos", decomponha obrigatoriamente todos os itens visíveis nas fotos seguindo este checklist técnico (quando visíveis):
1. Piso e Rodapés (tipo de revestimento, integridade, rejuntes);
2. Paredes e Pintura (tonalidade aparente, acabamento, manchas, furos ou fissuras);
3. Teto e Iluminação (forro/laje, pintura, plafons, lâmpadas ou luminárias);
4. Portas, Janelas, Vidros e Ferragens (folhas, alizares, maçanetas, fechaduras, esquadrias);
5. Instalações Elétricas (tomadas, interruptores, espelhos, quadro);
6. Louças, Metais, Bancadas e Armários (pias, cubas, torneiras, vaso sanitário, box, gabinetes).
Compare as imagens, mas descreva apenas o que está visível. Não trate sombra ou reflexo como dano sem evidência. Quando funcionamento não puder ser testado por foto, escreva "Não verificável por fotografia".
Para cada fotografia, use numero de 1 até o tamanho deste lote, em ordem. Em local indique o elemento e a posição no enquadramento; em descricao registre o sinal visual concreto (forma, cor, padrão, extensão aparente). Havendo irregularidades, descreva todas as distinguíveis e marque avaria=true. Em elementos, associe cada constatação à foto pelo número local em foto. Priorize avarias sobre inventário. Sem dano distinguível, descreva o detalhe efetivamente observado; se a imagem for insuficiente, descreva o que impede a avaliação e use NÃO CONCLUSIVO. Não invente defeito, medida, causa, antiguidade, responsabilidade nem funcionamento. Não use frases de preenchimento. Mantenha legendas concisas. Deixe ressalvas vazias se não houver limitação específica.
Use classificações: BOM ESTADO APARENTE, REGULAR/ATENÇÃO, AVARIA VISÍVEL ou NÃO CONCLUSIVO.`;

  const promptMeter = isMeterReading ? ' Transcreva somente números e unidades legíveis no visor ou placa. Identifique o campo ilegível e a razão visível, sem completar dígitos.' : '';
  const promptNote = roomNote ? ' Nota presencial fornecida pelo vistoriador (atribua a ele; não apresente como observação da IA): ' + String(roomNote) : '';

  const prompt = promptBase + promptMeter + promptNote;

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
            foto: { type: "integer" },
            elemento: { type: "string" },
            descricao: { type: "string" },
            funcionamento: { type: "string" },
            classificacao: { type: "string" }
          },
          required: ["foto", "elemento", "descricao", "funcionamento", "classificacao"]
        }
      },
      fotos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            numero: { type: "integer" },
            local: { type: "string" },
            titulo: { type: "string" },
            descricao: { type: "string" },
            avaria: { type: "boolean" }
          },
          required: ["numero", "local", "titulo", "descricao", "avaria"]
        }
      },
      ressalvas: { type: "string" }
    },
    required: ["introducao", "elementos", "fotos", "ressalvas"]
  };

  // ------------------------------------------------------------------
  // DIVIDE AS FOTOS EM LOTES DE ATÉ 3 (limite do Groq / segurança)
  // ------------------------------------------------------------------
  const lotes = [];
  const TAMANHO_LOTE = 3;
  for (let i = 0; i < photosDataUrls.length; i += TAMANHO_LOTE) {
    lotes.push(photosDataUrls.slice(i, i + TAMANHO_LOTE));
  }

  try {
    const promessasLotes = lotes.map(async (lote, idxLote) => {
      const promptLote = prompt + `\n\nESTE É O LOTE ${idxLote + 1} DE ${lotes.length}. Analise APENAS as ${lote.length} foto(s) deste lote.`;

      let resultadoLote = null;
      const errosLote = [];

      // 1) Tenta OpenRouter (VISTORIA_OPEN_API_KEY) primeiro
      if (vistoriaOpenApiKey) {
        try {
          resultadoLote = validarLote(await chamarOpenRouter(vistoriaOpenApiKey, lote, promptLote, schema), lote.length);
        } catch (err) {
          errosLote.push('OpenRouter: ' + err.message);
        }
      }

      // 2) Se OpenRouter falhar, tenta Gemini
      if (!resultadoLote && geminiApiKey) {
        try {
          resultadoLote = validarLote(await chamarGemini(geminiApiKey, lote, promptLote, schema), lote.length);
        } catch (err) {
          errosLote.push('Gemini: ' + err.message);
        }
      }

      // 3) Se Gemini falhar, tenta Groq
      if (!resultadoLote && groqApiKey) {
        try {
          resultadoLote = validarLote(await chamarGroq(groqApiKey, lote, promptLote, schema), lote.length);
        } catch (err) {
          errosLote.push('Groq: ' + err.message);
        }
      }

      if (!resultadoLote) {
        throw new Error(`Nenhum provedor respondeu no lote ${idxLote + 1}/${lotes.length}: ${errosLote.join(' | ')}`);
      }

      return resultadoLote;
    });

    const resultadosParciais = await Promise.all(promessasLotes);

    // ------------------------------------------------------------------
    // UNIFICA OS RESULTADOS DOS LOTES EM UM ÚNICO OBJETO
    // ------------------------------------------------------------------
    const resultadoFinal = unificarResultados(resultadosParciais);

    return res.status(200).json(resultadoFinal);

  } catch (error) {
    console.error('Falha no audit:', error);
    return res.status(500).json({ error: 'Erro interno no processamento.', details: error.message });
  }
}

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

function validarLote(r, quantidade) {
  const texto = v => typeof v === 'string' && v.trim().length > 0;
  const concreta = v => texto(v) && !/^(registro fotográfico( técnico)?( do item)?|em conformidade visual|bom estado( aparente)?|item vistoriado|sem avarias( visíveis)?|vista (geral|técnica)( do ambiente| do elemento vistoriado)?|constatações limitadas ao registro fotográfico)[.! ]*$/iu.test(v.trim());
  if (!Array.isArray(r?.fotos) || r.fotos.length !== quantidade ||
      !r.fotos.every((f, i) => f?.numero === i + 1 && texto(f.titulo) && texto(f.local) && concreta(f.descricao) && typeof f.avaria === 'boolean') ||
      !Array.isArray(r.elementos) || !r.elementos.length ||
      !r.elementos.every(e => Number.isInteger(e?.foto) && e.foto >= 1 && e.foto <= quantidade &&
        texto(e.elemento) && concreta(e.descricao) && texto(e.funcionamento) && texto(e.classificacao)) ||
      typeof r.introducao !== 'string' || typeof r.ressalvas !== 'string') {
    throw new Error('Análise incompleta ou sem evidência identificada por fotografia.');
  }
  return r;
}

function unificarResultados(lotes) {
  const resultado = { versaoEvidencia: 1, introducao: '', elementos: [], fotos: [], ressalvas: '' };
  for (const lote of lotes) {
    const offset = resultado.fotos.length;
    for (const el of lote.elementos) {
      resultado.elementos.push({ ...el, elemento: el.elemento + ' (foto ' + (offset + el.foto) + ')' });
    }
    for (const f of lote.fotos) {
      resultado.fotos.push({ titulo: f.titulo, avaria: f.avaria, descricao: f.local + ' — ' + f.descricao });
    }
  }
  resultado.introducao = lotes.map(l => l.introducao.trim()).filter(Boolean).join(' ');
  resultado.ressalvas = lotes.map(l => l.ressalvas.trim()).filter(Boolean).join(' ');
  return resultado;
}

// ============================================================================
// OPENROUTER (VISTORIA_OPEN_API_KEY) — PROVEDOR PRINCIPAL
// ============================================================================
async function chamarOpenRouter(apiKey, photosDataUrls, prompt, schema) {
  if (photosDataUrls.length > 3) {
    throw new Error('OpenRouter aceita no máximo 3 imagens por request.');
  }

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

  // Busca modelos disponíveis
  let targetModels = [];
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.models)) {
        targetModels = listData.models
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));
      }
    }
  } catch (_) {}

  // Fallback fixo de modelos
  if (!targetModels.length) {
    targetModels = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro"
    ];
  }

  // Ordena: flash primeiro
  targetModels.sort((a, b) => {
    const af = a.includes('flash') ? 1 : 0;
    const bf = b.includes('flash') ? 1 : 0;
    return bf - af;
  });

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
