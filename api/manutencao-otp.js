import { createClient } from '@supabase/supabase-js';

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
      return res.status(500).json({ error: 'Variáveis de ambiente incompletas.' });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // 1. Gera código numérico de uso único de 6 dígitos
    const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();

    // 2. Define a expiração para exatamente 30 minutos a partir de agora
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);

    const emailManutencao = 'manutencao@vistoriafacil.com';
    const { data: usersData, error: userError } = await supabaseAdmin.auth.admin.listUsers();
    if (userError) throw userError;

    let maintenanceUser = usersData.users.find(u => u.email === emailManutencao);

    if (!maintenanceUser) {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: emailManutencao,
        password: tempPassword,
        email_confirm: true
      });
      if (createError) throw createError;
      maintenanceUser = newUser.user;
    } else {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(maintenanceUser.id, {
        password: tempPassword
      });
      if (updateError) throw updateError;
    }

    // 3. Atualiza o perfil para ativo por 30 minutos com role 'manutencao'
    await supabaseAdmin
      .from('profiles')
      .upsert({
        id: maintenanceUser.id,
        email: emailManutencao,
        role: 'manutencao',
        subscription_status: 'ativo',
        subscription_expires_at: expiresAt.toISOString()
      });

    // 4. Dispara e-mail com o código
    const resendResponse = await fetch('https://api.resend.com/emails', {
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

    if (!resendResponse.ok) {
      const errBody = await resendResponse.text();
      return res.status(500).json({ error: 'Erro Resend', details: errBody });
    }

    return res.status(200).json({ success: true, message: 'Código de 30 min enviado com sucesso!' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
