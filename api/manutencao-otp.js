export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    const targetEmail = 'chalfouncel@gmail.com';

    if (!supabaseUrl || !serviceKey || !resendApiKey) {
      return res.status(500).json({ error: 'Variáveis de ambiente incompletas na Vercel.' });
    }

    // 1. Gera senha aleatória única de 6 dígitos
    const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();

    // 2. Calcula expiração para exatamente 30 minutos
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);

    const emailManutencao = 'manutencao@vistoriafacil.com';

    // 3. Localiza ou cria o usuário diretamente via API REST de Admin do Supabase
    const listUsersRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });

    if (!listUsersRes.ok) {
      const errTxt = await listUsersRes.text();
      return res.status(500).json({ error: 'Erro ao consultar usuários no Supabase', details: errTxt });
    }

    const { users } = await listUsersRes.json();
    let maintenanceUser = users.find(u => u.email === emailManutencao);

    if (!maintenanceUser) {
      // Cria o usuário
      const createUserRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: emailManutencao,
          password: tempPassword,
          email_confirm: true
        })
      });

      if (!createUserRes.ok) {
        const errTxt = await createUserRes.text();
        return res.status(500).json({ error: 'Erro ao criar usuário de manutenção', details: errTxt });
      }

      maintenanceUser = await createUserRes.json();
    } else {
      // Atualiza a senha do usuário existente
      const updateUserRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${maintenanceUser.id}`, {
        method: 'PUT',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          password: tempPassword
        })
      });

      if (!updateUserRes.ok) {
        const errTxt = await updateUserRes.text();
        return res.status(500).json({ error: 'Erro ao atualizar senha no Supabase', details: errTxt });
      }
    }

    // 4. Grava na tabela profiles com role 'manutencao' e expiração de 30 min
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        id: maintenanceUser.id,
        email: emailManutencao,
        role: 'manutencao',
        subscription_status: 'ativo',
        subscription_expires_at: expiresAt.toISOString()
      })
    });

    if (!profileRes.ok) {
      const errTxt = await profileRes.text();
      return res.status(500).json({ error: 'Erro ao atualizar profile no Supabase', details: errTxt });
    }

    // 5. Dispara o e-mail via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Vistoria Fácil Pro <onboarding@resend.dev>',
        to: [targetEmail],
        subject: `🔐 Código de Manutenção (30 min): ${tempPassword}`,
        html: `
          <div style="font-family: Arial, sans-serif; background:#f4f5f7; padding: 20px; border-radius: 8px;">
            <h2 style="color: #121315;">Acesso de Manutenção Solicitado</h2>
            <p style="font-size: 14px; color: #444;">Código de utilização única válido por <strong>30 minutos</strong>:</p>
            <div style="background: #1e293b; color: #dfba48; padding: 16px; border-radius: 6px; font-size: 28px; font-weight: bold; text-align: center; letter-spacing: 4px; margin: 20px 0;">
              ${tempPassword}
            </div>
            <p style="font-size: 12px; color: #777;">Expira automaticamente às ${expiresAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>
          </div>
        `
      })
    });

    if (!resendRes.ok) {
      const errTxt = await resendRes.text();
      return res.status(500).json({ error: 'Erro Resend ao enviar e-mail', details: errTxt });
    }

    return res.status(200).json({ success: true, message: 'Código de 30 min enviado com sucesso!' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
