const drive = 'https://www.googleapis.com/drive/v3';
const idPattern = /^[A-Za-z0-9_-]{10,160}$/;
let cachedToken;
async function googleToken(env) {
  if (cachedToken?.until > Date.now()) return cachedToken.value;
  const reply = await fetch('https://oauth2.googleapis.com/token', {method:'POST', body:new URLSearchParams({
    client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET,
    refresh_token:env.GOOGLE_REFRESH_TOKEN, grant_type:'refresh_token'
  })});
  if (!reply.ok) throw Error('Revise a autorização Google da conta de envio.');
  const token = await reply.json();
  cachedToken = {value:token.access_token, until:Date.now() + (token.expires_in - 60)*1000};
  return cachedToken.value;
}

export default async function handler(req,res) {
  if(req.method !== 'POST') return res.status(405).end();
  const env = process.env;
  const required = ['SUPABASE_URL','DRIVE_UPLOAD_USER_IDS','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN'];
  if(required.some(key => !env[key]) || !(env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY))
    return res.status(503).json({error:'Configuração do envio ao Drive pendente.'});
  const auth = req.headers.authorization || '';
  if(!auth.startsWith('Bearer ')) return res.status(401).end();
  try {
    const session = await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{Authorization:auth,apikey:env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY}});
    if(!session.ok) return res.status(401).end();
    const user = await session.json();
    if(!env.DRIVE_UPLOAD_USER_IDS.split(',').map(s=>s.trim()).includes(user.id)) return res.status(403).json({error:'Vistoriador sem autorização para enviar ao Drive.'});
    const {folder,id,jpeg,name,job} = req.body || {};
    if(!idPattern.test(folder || '') || !idPattern.test(job || '')) return res.status(400).json({error:'Destino inválido.'});
    const headers = {Authorization:'Bearer '+await googleToken(env)};
    if(!id) {
      const r = await fetch(drive+'/files/generateIds?count=1&space=drive',{headers});
      if(!r.ok) throw Error('Não foi possível reservar o arquivo no Drive.');
      return res.json({id:(await r.json()).ids[0]});
    }
    if(!idPattern.test(id) || typeof name!=='string' || name.length>240 || typeof jpeg!=='string' || !jpeg.startsWith('/9j/') || jpeg.length>4300000)
      return res.status(400).json({error:'JPEG ou identificação inválida.'});
    const meta = {id,name,parents:[folder],appProperties:{vistoriaJob:job,owner:user.id}};
    const boundary = 'vistoria_'+job;
    const body = Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+boundary+'\r\nContent-Type: image/jpeg\r\n\r\n'), Buffer.from(jpeg,'base64'),Buffer.from('\r\n--'+boundary+'--')]);
    const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',{method:'POST',headers:{...headers,'Content-Type':'multipart/related; boundary='+boundary},body});
    if(r.ok) return res.json({id});
    if(r.status===409) {
      const check=await fetch(drive+'/files/'+id+'?supportsAllDrives=true&fields=parents,appProperties,trashed',{headers});
      if(check.ok){ const f=await check.json(); if(!f.trashed && f.parents?.includes(folder) && f.appProperties?.vistoriaJob===job && f.appProperties.owner===user.id) return res.json({id}); }
    }
    throw Error('Confira a pasta do contrato, o espaço disponível e a permissão de edição da conta Google.');
  } catch(err) {return res.status(502).json({error:err.message});}
}
export const config={api:{bodyParser:{sizeLimit:'4.4mb'}}};
