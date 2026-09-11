export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event, payment } = req.body || {};

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      let customerEmail = payment?.customerEmail || payment?.email;

      // Se o email não estiver no payload, consulta os dados do cliente no Asaas
      if (!customerEmail && payment?.customer) {
        const apiKey = process.env.ASAAS_API_KEY ? process.env.ASAAS_API_KEY.trim() : '';
        const asaasUrl = `https://api.asaas.com/v3/customers/${payment.customer}`;

        const asaasRes = await fetch(asaasUrl, {
          method: 'GET',
          headers: {
            'access_token': apiKey,
            'User-Agent': 'VistoriaApp'
          }
        });

        if (asaasRes.ok) {
          const customerData = await asaasRes.json();
          customerEmail = customerData?.email;
        } else {
          const errStatus = asaasRes.status;
          const errBody = await asaasRes.text();
          return res.status(500).json({ error: 'Erro ao consultar cliente Asaas', status: errStatus, details: errBody });
        }
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Email não encontrado para o cliente', customer: payment?.customer });
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Atualiza o perfil correspondente no Supabase
      const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';

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
        return res.status(500).json({ error: 'Erro Supabase', details: errorText });
      }

      const updatedData = await patchRes.json();
      return res.status(200).json({ success: true, activated: customerEmail, updatedRows: updatedData.length });
    }

    return res.status(200).json({ received: true, ignoredEvent: event });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
