'use strict';
(function(){
const BUCKET='criterios-medicao-obras',TABLE='criterios_medicao_arquivos',MAX=500*1024*1024;
const el=id=>document.getElementById(id);
let rows=[],busy=false,request=0,selected=null,previewSeq=0;
const msg=s=>{if(el('crit-status'))el('crit-status').textContent=s;};
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const ext=n=>n.split('.').pop().toLowerCase();
async function uploadStorage(path,file){
 if(file.size<=6*1024*1024)return db.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
 if(!window.tus)throw Error('Envio de arquivos grandes indisponível.');
 const {data,error}=await db.auth.getSession();if(error||!data.session)throw Error('Sessão expirada.');
 return new Promise(resolve=>{
  new tus.Upload(file,{endpoint:'https://nigrecjshlxflczfzssn.storage.supabase.co/storage/v1/upload/resumable',chunkSize:6*1024*1024,retryDelays:[0,3000,5000,10000],headers:{authorization:'Bearer '+data.session.access_token},uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,metadata:{bucketName:BUCKET,objectName:path,contentType:file.type||'application/octet-stream'},onError:error=>resolve({error}),onSuccess:()=>resolve({error:null}),onProgress:(sent,total)=>msg('Enviando '+file.name+': '+Math.round(sent/total*100)+'%')}).start();
 });
}
async function load(){
 if(!selectedWork)return;const id=selectedWork.id,token=++request;
 const {data,error}=await db.from(TABLE).select('*').eq('obra_id',id).order('created_at',{ascending:false});
 if(token!==request||selectedWork?.id!==id)return;
 if(error){msg('Erro ao carregar biblioteca: '+error.message);return;}
 rows=data||[];if(selected&&!rows.some(r=>r.id===selected)){selected=null;clearPreview();}render();
}
function render(){
 const q=(el('crit-search')?.value||'').toLocaleLowerCase('pt-BR');
 const filtered=rows.filter(r=>r.nome_arquivo.toLocaleLowerCase('pt-BR').includes(q));
 el('crit-count').textContent=rows.length+' arquivo(s) cadastrado(s)';
 const list=el('crit-list');list.replaceChildren();
 if(!filtered.length){const p=document.createElement('p');p.textContent='Nenhum critério de medição encontrado.';list.append(p);return;}
 for(const row of filtered){
  const item=document.createElement('div');item.className='med-file-row';
  const info=document.createElement('div');info.className='med-file-info';
  const name=document.createElement('strong');name.textContent=row.nome_arquivo;
  const detail=document.createElement('small');detail.textContent=ext(row.nome_arquivo).toUpperCase()+' · '+size(row.tamanho_bytes)+' · '+new Date(row.created_at).toLocaleString('pt-BR');
  info.append(name,detail);item.append(info);
  const actions=document.createElement('div');actions.className='med-file-actions';
  for(const [label,action] of [['Visualizar','view'],['Baixar','download'],['Excluir','delete']]){
   const b=document.createElement('button');b.type='button';b.textContent=label;b.className='secondary';b.onclick=()=>perform(row,action);actions.append(b);
  }
  item.append(actions);item.classList.toggle('active',selected===row.id);item.tabIndex=0;item.setAttribute('role','button');item.setAttribute('aria-label','Selecionar '+row.nome_arquivo+' para visualização rápida');item.onclick=e=>{if(e.target.closest('button'))return;preview(row);};item.onkeydown=e=>{if(e.target===item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();preview(row);}};list.append(item);
 }
}
async function perform(row,action){
 if(action==='delete'){
  if(!confirm('Excluir definitivamente o arquivo "'+row.nome_arquivo+'"?'))return;
  const {error}=await db.from(TABLE).delete().eq('id',row.id).eq('obra_id',row.obra_id);
  if(error){msg('Falha ao excluir: '+error.message);return;}
  const {error:storageError}=await db.storage.from(BUCKET).remove([row.storage_path]);
  if(storageError)msg('Registro excluído, mas o arquivo precisa ser removido do armazenamento: '+storageError.message);
  if(selected===row.id){selected=null;clearPreview();}await load();return;
 }
 const popup=action==='view'?window.open('about:blank','_blank'):null;
 const {data,error}=await db.storage.from(BUCKET).createSignedUrl(row.storage_path,120);
 if(error){if(popup)popup.close();msg('Erro ao abrir: '+error.message);return;}
 if(action==='view'){if(popup)popup.location.replace(data.signedUrl);else msg('O navegador bloqueou a nova aba. Permita pop-ups para visualizar o PDF.');}
 else{const {data:blob,error:downloadError}=await db.storage.from(BUCKET).download(row.storage_path);
  if(downloadError){msg('Erro no download: '+downloadError.message);return;}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=row.nome_arquivo;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
}
function clearPreview(){previewSeq++;el('crit-preview-name').textContent='Nenhum documento selecionado';el('crit-preview-frame').removeAttribute('src');el('crit-preview-frame').classList.add('hidden');el('crit-preview-empty').classList.remove('hidden');}
async function preview(row){const token=++previewSeq;selected=row.id;render();el('crit-preview-name').textContent=row.nome_arquivo;el('crit-preview-empty').textContent='Carregando PDF...';el('crit-preview-empty').classList.remove('hidden');el('crit-preview-frame').classList.add('hidden');const {data,error}=await db.storage.from(BUCKET).createSignedUrl(row.storage_path,120);if(token!==previewSeq)return;if(error){msg('Erro ao visualizar: '+error.message);return;}el('crit-preview-frame').src=data.signedUrl+'#toolbar=1';el('crit-preview-frame').classList.remove('hidden');el('crit-preview-empty').classList.add('hidden');}
async function upload(){
 if(busy||!selectedWork)return;
 const files=[...el('crit-files').files];if(!files.length){msg('Selecione arquivos.');return;}
 const id=selectedWork.id;busy=true;el('crit-upload').disabled=true;
 let added=0;const errors=[];
 try{
  for(const file of files){
   const type=ext(file.name);
   if(type!=='pdf'||file.size===0||file.size>MAX){errors.push(file.name+': apenas arquivos PDF de até 500 MB são permitidos');continue;}
   let path=null;
   try{
    const signature=new Uint8Array(await file.slice(0,5).arrayBuffer());if(String.fromCharCode(...signature)!=='%PDF-')throw Error('O conteúdo do arquivo não é um PDF válido.');
    msg('Verificando '+file.name+'...');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const {data:dup,error:checkError}=await db.from(TABLE).select('id').eq('obra_id',id).eq('checksum_sha256',hash).limit(1);
    if(checkError)throw checkError;if(dup?.length){errors.push(file.name+': arquivo idêntico já cadastrado');continue;}
    path=id+'/'+crypto.randomUUID()+'.'+type;
    const {error:storageError}=await uploadStorage(path,file);if(storageError)throw storageError;
    const {error:saveError}=await db.from(TABLE).insert({obra_id:id,nome_arquivo:file.name,storage_path:path,tamanho_bytes:file.size,formato:type,checksum_sha256:hash,uploaded_by:currentUser.id});
    if(saveError)throw saveError;added++;
   }catch(e){errors.push(file.name+': '+e.message);if(path)await db.storage.from(BUCKET).remove([path]);}
  }
  el('crit-files').value='';await load();msg(added+' arquivo(s) cadastrado(s).'+(errors.length?' Falhas: '+errors.join('; '):''));
 }finally{busy=false;el('crit-upload').disabled=false;}
}
window.criteriaLoad=load;
document.addEventListener('DOMContentLoaded',()=>{el('crit-upload')?.addEventListener('click',upload);el('crit-search')?.addEventListener('input',render);});
})();