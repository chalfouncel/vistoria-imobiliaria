export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '15mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chave GEMINI_API_KEY não configurada na Vercel.' });

  const { roomName, photosDataUrls } = req.body;
  if (!photosDataUrls || !photosDataUrls.length) {
    return res.status(400).json({ error: 'Nenhuma fotografia enviada.' });
  }

  const prompt = `Você é perito de vistoria imobiliária. Analise TODAS as fotos do ambiente "${roomName}" em conjunto. 
Compare as imagens, mas descreva cada foto apenas pelo que está visível nela. 
Não invente funcionamento, medidas, marcas, materiais, cores exatas ou avarias. 
Não trate sombra, reflexo ou sujeira como dano sem evidência. 
Quando funcionamento não puder ser testado, escreva "Não verificável por fotografia". 
A coluna DESCRIÇÃO E ESTADO DE CONSERVAÇÃO deve ser detalhada. 
Retorne exatamente ${photosDataUrls.length} itens em fotos, na ordem recebida. 
Use classificações: BOM ESTADO APARENTE, REGULAR/ATENÇÃO, AVARIA VISÍVEL ou NÃO CONCLUSIVO.`;

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

  // Lista com modelos alternativos se um estiver com alta demanda
  const models = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.8-flash"
  ];

  let lastError = "";

  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });

      const data = await response.json();
      if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const resultText = data.candidates[0].content.parts[0].text;
        return res.status(200).json(JSON.parse(resultText));
      }

      lastError = data.error?.message || `Erro HTTP ${response.status} no modelo ${model}`;
    } catch (err) {
      lastError = err.message;
    }
  }

  res.status(500).json({ error: `Servidores do Gemini ocupados no momento: ${lastError}` });
}
