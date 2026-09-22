import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
  maxDuration: 120, // 2 minutos (funciona no plano pago da Vercel)
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { photos, loteAtual = 1, totalLotes = 1 } = req.body;

    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'Envie pelo menos uma foto.' });
    }

    if (photos.length > 3) {
      return res.status(400).json({ error: 'Máximo de 3 fotos por requisição.' });
    }

    const prompt = `
Você é um assistente técnico de vistoria veicular.
Analise ${photos.length} foto(s) do veículo e emita um laudo técnico detalhado.
Lote ${loteAtual} de ${totalLotes}.

O laudo deve conter:
- Estado geral observado
- Possíveis avarias, riscos ou amassados visíveis
- Condição da pintura
- Observações relevantes para o processo de vistoria
- Se houver placa ou número legível, informe
- Nível de confiança da análise (baixo, médio, alto)

Responda em português do Brasil, de forma objetiva e técnica.
`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const parts = [{ text: prompt }];

    for (const photo of photos) {
      const base64 = photo.replace(/^data:image\/\w+;base64,/, '');
      const mimeType = photo.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';

      parts.push({
        inlineData: {
          mimeType,
          data: base64,
        },
      });
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
    });

    const response = await result.response;
    const laudo = response.text();

    return res.status(200).json({ laudo });
  } catch (error) {
    console.error('Erro no laudo:', error);
    return res.status(500).json({
      error: 'Erro ao gerar laudo.',
      detalhes: error.message,
    });
  }
}
