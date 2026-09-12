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

    const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();

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

      await supabaseAdmin
        .from('profiles')
        .upsert({ id: maintenanceUser.id, email: emailManutencao, role: 'admin', subscription_status: 'ativo' });
    } else {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(maintenanceUser.id, {
        password: tempPassword
      });
      if (updateError) throw updateError;
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Vistoria Fácil Pro <onboarding@resend.dev>',
        to: [targetEmail],
        subject: `🔐 Código de Manutenção: ${tempPassword}`,
        html: `
          <div style="font-family: Arial, sans-serif; background:#f4f5f7; padding: 20px; border-radius: 8px;">
            <h2 style="color: #121315;">Acesso de Manutenção Solicitado</h2>
            <p style="font-size: 14px; color: #444;">Utilize o código abaixo para autenticar o acesso único:</p>
            <div style="background: #1e293b; color: #dfba48; padding: 16px; border-radius: 6px; font-size: 26px; font-weight: bold; text-align: center; letter-spacing: 4px; margin: 20px 0;">
              ${tempPassword}
            </div>
            <p style="font-size: 12px; color: #777;">Essa senha substitui qualquer senha anterior deste usuário.</p>
          </div>
        `
      })
    });

    if (!resendResponse.ok) {
      const errBody = await resendResponse.text();
      return res.status(500).json({ error: 'Erro Resend', details: errBody });
    }

    return res.status(200).json({ success: true, message: 'Código enviado por e-mail com sucesso!' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
