export const config = {
  maxDuration: 120,
  api: { bodyParser: { sizeLimit: '15mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const samba2ApiKey = process.env.SAMBA2_API_KEY;
  const groq2ApiKey = process.env.GROQ2_API_KEY;

  if (!geminiApiKey && !samba2ApiKey && !groq2ApiKey) {
    return res.status(500).json({ error: 'Nenhuma chave de API (GEMINI_API_KEY, SAMBA2_API_KEY ou GROQ2_API_KEY) foi configurada na Vercel.' });
  }

  const { roomName, photosDataUrls, isMeterReading } = req.body;
  if (!photosDataUrls || !photosDataUrls.length) {
    return res.status(400).json({ error: 'Nenhuma fotografia enviada.' });
  }

  let prompt = `Você é perito de vistoria imobiliária. Analise TODAS as fotos do ambiente ou item "${roomName}" em conjunto. 
Compare as imagens, mas descreva cada foto apenas pelo que está visível nela. 
Não invente funcionamento, medidas, marcas, materiais, cores exatas ou avarias. 
Não trate sombra, reflexo ou sujeira como dano sem evidência. 
Quando funcionamento não puder ser testado, escreva "Não verificável por fotografia". 
A coluna DESCRIÇÃO E ESTADO DE CONSERVAÇÃO deve ser detalhada. 
Retorne exatamente ${photosDataUrls.length} itens em fotos, na ordem recebida. 
Use classificações: BOM ESTADO APARENTE, REGULAR/ATENÇÃO, AVARIA VISÍVEL ou NÃO CONCLUSIVO.`;

  if (isMeterReading) {
    prompt += ` ATENÇÃO ESPECIAL: Este item é um medidor técnico ("${roomName}"). Identifique obrigatoriamente nos visores das fotografias o número de série/identificação do aparelho e a leitura numérica atual do consumo, informando-os claramente na descrição e nos elementos técnicos.`;
  }

  const parts = [{ text: prompt }];
  photosDataUrls.forEach((dataUrl, idx) => {
    const b64 = dataUrl.split(',')[1];
    parts.push({ text: `FOTO ${idx + 1} DE ${photosDataUrls.length}` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  });

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
          required: ["elemento","descricao","funcionamento","classificacao"]
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
          required: ["titulo","descricao","avaria"]
        }
      },
      ressalvas: { type: "string" }
    },
    required: ["introducao","elementos","fotos","ressalvas"]
  };

  const payload = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      maxOutputTokens: 3600
    }
  });

  const provedores = [];

  // 1. Groq (disparado em paralelo)
  if (groq2ApiKey) {
    provedores.push(
      fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groq2ApiKey}`
        },
        body: JSON.stringify({
          model: "llama-3.2-90b-vision-preview",
          messages: [{ role: "user", content: prompt }]
        })
      }).then(async (groqRes) => {
        if (!groqRes.ok) throw new Error(`Groq HTTP ${groqRes.status}`);
        const groqData = await groqRes.json();
        const contentText = groqData.choices?.[0]?.message?.content;
        if (!contentText) throw new Error('Groq respondeu sem conteúdo.');
        return JSON.parse(contentText);
      })
    );
  }

  // 2. SambaNova (disparado em paralelo)
  if (samba2ApiKey) {
    provedores.push(
      fetch('https://api.sambanova.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${samba2ApiKey}`
        },
        body: JSON.stringify({
          model: "Meta-Llama-3.1-405B-Instruct",
          messages: [{ role: "user", content: prompt }]
        })
      }).then(async (sambaRes) => {
        if (!sambaRes.ok) throw new Error(`SambaNova HTTP ${sambaRes.status}`);
        const sambaData = await sambaRes.json();
        const contentText = sambaData.choices?.[0]?.message?.content;
        if (!contentText) throw new Error('SambaNova respondeu sem conteúdo.');
        return JSON.parse(contentText);
      })
    );
  }

  // 3. Gemini (disparado em paralelo, com fallback interno de modelos)
  if (geminiApiKey) {
    provedores.push(chamarGemini(geminiApiKey, payload, schema));
  }

  if (provedores.length === 0) {
    return res.status(500).json({ error: 'Nenhum provedor de IA pôde ser acionado.' });
  }

  try {
    // Pega a PRIMEIRA IA que responder com sucesso
    const resultado = await Promise.any(provedores);
    return res.status(200).json(resultado);
  } catch (error) {
    const erros = error.errors?.map(e => e.message) || [error.message];
    return res.status(500).json({ error: 'Nenhum provedor ou modelo de IA disponível respondeu com sucesso.', details: erros });
  }
}

async function chamarGemini(geminiApiKey, payload, schema) {
  let targetModels = [];
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.models)) {
        targetModels = listData.models
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''))
          .sort((a, b) => (a.includes('flash') ? -1 : 1));
      }
    }
  } catch (_) {}

  if (!targetModels.length) {
    targetModels = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro",
      "gemini-3.6-flash",
      "gemini-3.8-flash"
    ];
  }

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
