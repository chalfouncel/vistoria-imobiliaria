export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event, payment } = req.body || {};

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      let customerEmail = payment?.customerEmail || payment?.email;

      // Se o email não vier direto no payload, busca na API do Asaas pelo ID do cliente
      if (!customerEmail && payment?.customer) {
        try {
          const asaasRes = await fetch(`https://www.asaas.com/api/v3/customers/${payment.customer}`, {
            headers: {
              'access_token': process.env.ASAAS_API_KEY || ''
            }
          });
          if (asaasRes.ok) {
            const customerData = await asaasRes.json();
            customerEmail = customerData.email;
          }
        } catch (e) {
          console.error('Falha ao consultar cliente Asaas:', e);
        }
      }

      if (!customerEmail) {
        console.warn('Webhook recebido sem email identificável:', payment);
        return res.status(200).json({ received: true, warning: 'Email não encontrado no evento' });
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Atualiza o Supabase via REST API direta (sem depender de bibliotecas externas)
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?email=ilike.${encodeURIComponent(customerEmail.trim())}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          subscription_status: 'ativo',
          subscription_expires_at: expiresAt.toISOString()
        })
      });

      if (!patchRes.ok) {
        const errorText = await patchRes.text();
        console.error('Erro ao atualizar Supabase:', errorText);
        return res.status(500).json({ error: errorText });
      }

      return res.status(200).json({ success: true, activated: customerEmail });
    }

    return res.status(200).json({ received: true, ignoredEvent: event });
  } catch (err) {
    console.error('Erro interno:', err);
    return res.status(500).json({ error: err.message });
  }
}
