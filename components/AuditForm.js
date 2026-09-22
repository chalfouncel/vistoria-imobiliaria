import { useState, useRef } from 'react';

export default function AuditForm() {
  const [photos, setPhotos] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState(null);
  const inputRef = useRef(null);

  const MAX_LADO = 1600;
  const QUALIDADE_JPEG = 0.75;
  const FOTOS_POR_LOTE = 3;

  // Converte arquivo para base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Comprime a imagem mantendo a resolução (só reduz se passar do limite de pixels)
  const compactarImagem = async (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);

        const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Falha ao compactar imagem'));
              return;
            }
            const fileCompactado = new File([blob], file.name, {
              type: 'image/jpeg',
            });
            resolve(fileCompactado);
          },
          'image/jpeg',
          QUALIDADE_JPEG
        );
      };
      img.onerror = reject;
      img.src = url;
    });
  };

  // Agrupa array em lotes menores
  const agruparEmLotes = (array, tamanho) => {
    const lotes = [];
    for (let i = 0; i < array.length; i += tamanho) {
      lotes.push(array.slice(i, i + tamanho));
    }
    return lotes;
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setLoading(true);
    setErro(null);
    setProgresso(0);

    try {
      const compactadas = [];
      for (let i = 0; i < files.length; i++) {
        const compactada = await compactarImagem(files[i]);
        compactadas.push(compactada);
        setProgresso(Math.round(((i + 1) / files.length) * 50));
      }
      setPhotos(compactadas);
    } catch (err) {
      setErro('Erro ao compactar fotos: ' + err.message);
    } finally {
      setLoading(false);
      setProgresso(0);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!photos.length) {
      setErro('Selecione pelo menos uma foto.');
      return;
    }

    setLoading(true);
    setErro(null);
    setResultado(null);

    try {
      // Converte todas as fotos para base64
      const fotosBase64 = await Promise.all(photos.map(fileToBase64));

      // Divide em lotes de até 3 fotos
      const lotes = agruparEmLotes(fotosBase64, FOTOS_POR_LOTE);

      let laudoFinal = '';
      const resultadosParciais = [];

      for (let i = 0; i < lotes.length; i++) {
        setProgresso(Math.round(((i + 1) / lotes.length) * 100));

        const res = await fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photos: lotes[i],
            loteAtual: i + 1,
            totalLotes: lotes.length,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Erro no lote ${i + 1}`);
        }

        const data = await res.json();
        resultadosParciais.push(data.laudo);
      }

      // Junta todos os laudos parciais
      laudoFinal = resultadosParciais.join('\n\n---\n\n');

      setResultado(laudoFinal);
    } catch (err) {
      setErro(err.message || 'Erro ao gerar laudo.');
    } finally {
      setLoading(false);
      setProgresso(0);
    }
  };

  const limpar = () => {
    setPhotos([]);
    setResultado(null);
    setErro(null);
    setProgresso(0);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Laudo de Vistoria</h1>

      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept="image/*"
          multiple
          ref={inputRef}
          onChange={handleFileChange}
          disabled={loading}
        />

        {photos.length > 0 && (
          <p style={{ marginTop: 12 }}>
            <strong>{photos.length}</strong> foto(s) selecionada(s)
          </p>
        )}

        {loading && progresso > 0 && (
          <p>Progresso: <strong>{progresso}%</strong></p>
        )}

        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={loading || photos.length === 0}>
            {loading ? 'Processando...' : 'Gerar Laudo'}
          </button>
          <button type="button" onClick={limpar} disabled={loading} style={{ marginLeft: 12 }}>
            Limpar
          </button>
        </div>
      </form>

      {erro && (
        <div style={{ marginTop: 20, padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6 }}>
          {erro}
        </div>
      )}

      {resultado && (
        <div style={{ marginTop: 24, padding: 16, background: '#f3f4f6', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
          <h2>Laudo Gerado</h2>
          {resultado}
        </div>
      )}
    </div>
  );
}
