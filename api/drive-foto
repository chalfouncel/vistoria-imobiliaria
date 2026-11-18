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
  if (!env.SUPABASE_URL?.trim() || !(env.SUPABASE_ANON_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim()))
    return res.status(503).json({error:'Falta configurar SUPABASE_URL ou a chave do Supabase na Vercel.'});
  const auth = req.headers.authorization || '';
  if(!auth.startsWith('Bearer ')) return res.status(401).end();
  try {
    const session = await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{Authorization:auth,apikey:env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY}});
    if(!session.ok) return res.status(401).json({error:'A sessão do Supabase expirou. Entre novamente para retomar a fila.'});
    const user = await session.json();
    if(!user.email_confirmed_at || user.email?.toLowerCase() !== 'chalfouncorretor@gmail.com') return res.status(403).json({error:'Vistoriador sem autorização para enviar ao Drive.'});
    const missing = ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN'].filter(key=>!env[key]?.trim());
    if (missing.length) return res.status(503).json({error:'Variáveis ausentes na Vercel: '+missing.join(', ')+'.'});
    const {folder,id,jpeg,name,job} = req.body || {};
    if(!idPattern.test(folder || '') || !idPattern.test(job || '')) return res.status(400).json({error:'Destino inválido.'});
    const headers = {Authorization:'Bearer '+await googleToken(env)};
    if(!id) {
      const r = await fetch(drive+'/files/generateIds?count=1&space=drive',{headers});
      if(!r.ok) throw Error('Não foi possível reservar o arquivo no Drive.');
      return res.json({id:(await r.json()).ids[0]});
    }
    if (req.body.action) {
      const {action,total,upload,offset,encoded}=req.body;
      const mime = req.body.mime || 'application/pdf';
      const allowed = mime === 'application/pdf' || mime === 'application/octet-stream' || /^image\/[a-z0-9.+-]+$/i.test(mime);
      if (!allowed || !idPattern.test(id) || !Number.isSafeInteger(total) || total<=0 || typeof name!=='string' || !name.length || name.length>240 || (mime==='application/pdf' && !name.toLowerCase().endsWith('.pdf'))) return res.status(400).end();
      if (action==='start') {
        const destination=await fetch(drive+'/files/'+folder+'?supportsAllDrives=true&fields=mimeType,trashed,capabilities(canAddChildren)',{headers});
        if (!destination.ok) throw Error('A conta Google da integração não conseguiu abrir a pasta do contrato (Drive HTTP '+destination.status+').');
        const info=await destination.json();
        if (info.trashed || info.mimeType!=='application/vnd.google-apps.folder' || !info.capabilities?.canAddChildren)
          throw Error('A conta Google da integração precisa ter permissão para adicionar arquivos à pasta do contrato.');

        const existing=await fetch(drive+'/files/'+id+'?supportsAllDrives=true&fields=parents,appProperties,trashed',{headers});
        if (existing.ok) {
          const file=await existing.json();
          if (!file.trashed && file.parents?.includes(folder) && file.appProperties?.vistoriaJob===job && file.appProperties?.owner===user.id) return res.json({done:true});
          return res.status(409).end();
        }
        if(existing.status!==404) throw Error('Falha ao verificar o arquivo no Drive.');
        const start=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(total)},body:JSON.stringify({id,name,parents:[folder],mimeType:mime,appProperties:{vistoriaJob:job,owner:user.id}})});
        if(!start.ok || !start.headers.get('location')) throw Error('O Drive recusou iniciar o envio (HTTP '+start.status+').');
        return res.json({upload:start.headers.get('location')});
      }
      const url=new URL(upload);
      if(url.origin!=='https://www.googleapis.com' || url.pathname!=='/upload/drive/v3/files' || !url.searchParams.has('upload_id') || !['chunk','status'].includes(action)) return res.status(400).end();
      const chunk=action==='chunk' ? Buffer.from(encoded || '', 'base64') : Buffer.alloc(0);
      if(action==='chunk' && (!Number.isSafeInteger(offset)||offset<0||!chunk.length||chunk.length>1048576||offset+chunk.length>total)) return res.status(400).end();
      const range=action==='status' ? 'bytes */'+total : 'bytes '+offset+'-'+(offset+chunk.length-1)+'/'+total;
      const reply=await fetch(url,{method:'PUT',redirect:'manual',headers:{'Content-Length':String(chunk.length),'Content-Range':range,'Content-Type':mime},body:chunk});
      if(reply.status===200 || reply.status===201) return res.json({done:true});
      if(reply.status===404 || reply.status===410) return res.json({expired:true});
      if(reply.status===308) return res.json({offset:Number(reply.headers.get('range')?.match(/-(\d+)$/)?.[1] ?? -1)+1});
      throw Error('O Drive recusou os dados do arquivo (HTTP '+reply.status+'). O original continua na fila.');
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
