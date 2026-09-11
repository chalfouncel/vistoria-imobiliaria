import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event, payment } = req.body;

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const customerEmail = payment?.customerEmail || payment?.email;

      if (!customerEmail) {
        return res.status(400).json({ error: 'E-mail do pagador não encontrado' });
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const { data, error } = await supabase
        .from('profiles')
        .update({
          subscription_status: 'ativo',
          subscription_expires_at: expiresAt.toISOString()
        })
        .ilike('email', customerEmail.trim());

      if (error) {
        console.error('Erro ao atualizar status no Supabase:', error);
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ success: true, message: `Assinatura ativada para ${customerEmail}` });
    }

    return res.status(200).json({ received: true, message: `Evento ${event} ignorado` });
  } catch (err) {
    console.error('Erro no webhook:', err);
    return res.status(500).json({ error: err.message });
  }
}
