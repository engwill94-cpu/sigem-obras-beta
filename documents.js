'use strict';
const docsBucket='documentos-obras';
const docsCategories={contrato:'Contrato',termo_referencia:'Termo de Referência',aditamento:'Termo de Aditamento',pgt:'PGT',outro:'Outro'};
let docsRecords=[],docsSelected=null,docsUrl=null,docsZoom=100,docsRequest=0,docsPdf=null,docsPreviewToken=0;
let docsSection='contratual';
const docsSectionNames={licitacao:'Licitação',contratual:'Contratual',ambiental:'Ambiental',licencas_alvaras:'Licenças e alvarás'};
function docsSelectSection(section){
 if(!docsSectionNames[section])return;
 docsSection=section;
 $('docs-section-title').textContent='Documentos — '+docsSectionNames[section];
 $('docs-section-description').textContent='Envie, visualize e gerencie os arquivos da seção '+docsSectionNames[section]+'.';
 $('docs-file').value='';
 $('docs-search').value='';
 $('docs-filter').value='';
 docsMessage('Até 50 MB por arquivo. O arquivo original será preservado.');
 docsClearPreview();
 loadDocuments();
}

function docsMessage(message,isDuplicate=false){const status=$('docs-upload-status');status.textContent=message;status.classList.toggle('docs-duplicate-warning',isDuplicate);status.style.cssText=isDuplicate?'display:block!important;box-sizing:border-box!important;width:100%!important;padding:12px 14px!important;border:2px solid #dc2626!important;border-radius:6px!important;background:#fff5f5!important;color:#b91c1c!important;font-weight:600!important;line-height:1.55!important;overflow-wrap:anywhere!important;':' ';}
function docsClearPreview(){docsSelected=null;const frame=$('docs-view-frame');if(frame)frame.removeAttribute('src');const container=$('docs-view-container');if(container)container.classList.add('hidden');const empty=$('docs-view-empty');if(empty){empty.classList.remove('hidden');empty.textContent='Selecione um documento na lista para visualizar.';}const title=$('docs-view-name');if(title)title.textContent='Nenhum documento selecionado';}
async function loadDocuments(){
 if(!selectedWork||!db)return;
 const id=selectedWork.id,request=++docsRequest;
 $('docs-rows').textContent='Carregando documentos...';
 const {data,error}=await db.from('documentos').select('id,obra_id,categoria,nome_arquivo,titulo,identificador_externo,mime_type,created_at').eq('obra_id',id).eq('secao_documental',docsSection).eq('provedor','supabase_storage').order('created_at',{ascending:false});
 if(request!==docsRequest||selectedWork?.id!==id)return;
 if(error){$('docs-rows').textContent='Erro ao consultar documentos: '+error.message;return;}
 docsRecords=data||[];renderDocuments();
}
function renderDocuments(){
 const term=$('docs-search').value.toLocaleLowerCase('pt-BR'),category=$('docs-filter').value;
 const rows=docsRecords.filter(d=>(!category||d.categoria===category)&&(d.nome_arquivo||d.titulo||'').toLocaleLowerCase('pt-BR').includes(term));
 const root=$('docs-rows');root.replaceChildren();$('docs-count').textContent=rows.length+' arquivo(s)';
 if(!rows.length){root.textContent='Nenhum documento encontrado.';return;}
 for(const d of rows){
  const row=document.createElement('div');row.className='docs-row';
  const info=document.createElement('div');info.className='docs-file-info';
  const name=document.createElement('strong');name.textContent=d.nome_arquivo||d.titulo;
  const meta=document.createElement('small');meta.textContent=(docsCategories[d.categoria]||d.categoria)+' · '+new Date(d.created_at).toLocaleDateString('pt-BR');
  info.append(name,meta);row.append(info);
  for(const [symbol,title,action,cls] of [['◉','Visualizar',()=>previewDocument(d),''],['↓','Baixar',()=>downloadDocument(d),''],['✕','Excluir',()=>deleteDocument(d),'docs-danger']]){
   const button=document.createElement('button');button.type='button';button.className='docs-action '+cls;button.textContent=symbol;button.title=title;button.setAttribute('aria-label',title);button.addEventListener('click',action);row.append(button);
  }root.append(row);
 }
}
async function docsGetBlob(d){
 if(!d.identificador_externo)throw Error('Arquivo sem referência no armazenamento.');
 const {data,error}=await db.storage.from(docsBucket).download(d.identificador_externo);
 if(error)throw error;return data;
}
async function previewDocument(d){
 docsClearPreview();
 docsSelected=d;
 $('docs-view-name').textContent=d.nome_arquivo||d.titulo;
 const empty=$('docs-view-empty');
 empty.textContent='Carregando documento...';
 if(!(/\\.pdf$/i.test(d.nome_arquivo||'')||d.mime_type==='application/pdf')){
  empty.textContent='A visualização integrada está disponível para PDF. Para Word, utilize o download.';
  return;
 }
 try{
  const {data,error}=await db.storage.from(docsBucket).createSignedUrl(d.identificador_externo,3600);
  if(error)throw error;
  if(!data?.signedUrl)throw Error('Não foi possível gerar o link de leitura.');
  if(docsSelected?.id!==d.id)return;
  $('docs-view-frame').src=data.signedUrl+'#toolbar=0&navpanes=0&view=FitH';
  $('docs-view-container').classList.remove('hidden');
  empty.classList.add('hidden');
 }catch(error){
  if(docsSelected?.id===d.id)empty.textContent='Erro ao abrir: '+(error.message||String(error));
 }
}
async function openDocumentNewWindow(d){
 const w=window.open('','_blank');
 if(!w){docsMessage('O navegador bloqueou a nova janela. Permita pop-ups para visualizar o documento.');return;}
 w.document.title='Abrindo documento';
 w.document.body.textContent='Abrindo documento...';
 try{
  if(!d.identificador_externo)throw Error('Arquivo sem referência no armazenamento.');
  const {data,error}=await db.storage.from(docsBucket).createSignedUrl(d.identificador_externo,3600);
  if(error)throw error;
  if(!data?.signedUrl)throw Error('Não foi possível gerar o link de leitura.');
  w.location.replace(data.signedUrl);
 }catch(error){
  w.document.body.textContent='Não foi possível abrir o documento: '+(error.message||String(error));
 }
}
async function downloadDocument(d){
 try{const blob=await docsGetBlob(d),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=d.nome_arquivo||'documento';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 catch(e){docsMessage('Erro ao baixar: '+e.message);}
}
async function deleteDocument(d){
 if(!selectedWork||!confirm('Excluir permanentemente '+(d.nome_arquivo||d.titulo)+'?'))return;
 const id=selectedWork.id;
 const {error:removeError}=await db.storage.from(docsBucket).remove([d.identificador_externo]);
 if(removeError){docsMessage('Erro ao remover arquivo: '+removeError.message);return;}
 const {error}=await db.from('documentos').delete().eq('id',d.id).eq('obra_id',id);
 if(error){docsMessage('Arquivo removido, mas registro não excluído: '+error.message);return;}
 if(docsSelected?.id===d.id)docsClearPreview();docsMessage('Documento excluído.');await loadDocuments();
}
async function docsFileSha256(file){
 if(!globalThis.crypto?.subtle)throw new Error('Este navegador não oferece verificação criptográfica segura.');
 const bytes=await file.arrayBuffer();
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function docsFindDuplicate(obraId,hash){
 const {data,error}=await docsWithTimeout(()=>db.from('documentos').select('id,nome_arquivo,titulo').eq('obra_id',obraId).eq('checksum_sha256',hash).limit(1),15000);
 if(error)throw error;
 return data?.[0]||null;
}
const DOCS_TIMEOUT_MS = 30000;
function docsWithTimeout(task, ms = DOCS_TIMEOUT_MS) {
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Tempo limite de 30 segundos excedido. Verifique sua conexão e tente novamente.')),ms);
  Promise.resolve().then(task).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
}
$('docs-send').addEventListener('click',async()=>{
 const button=$('docs-send');
 if(button.disabled)return;
 if(!selectedWork||!currentUser){docsMessage('Selecione uma obra e entre novamente no sistema.');return;}
 const files=Array.from($('docs-file').files);
 if(!files.length){docsMessage('Selecione um ou mais arquivos.');return;}
 const obraId=selectedWork.id,category='outro',section=docsSection;
 let count=0,failed=0,duplicateNotice='';
 button.disabled=true;
 button.textContent='Enviando...';
 try {
  for(let i=0;i<files.length;i++){
   const file=files[i],ext=file.name.split('.').pop().toLowerCase();
   if(!['pdf','doc','docx'].includes(ext)||file.size>50*1024*1024||file.size===0){
    failed++;docsMessage('Arquivo inválido, vazio ou maior que 50 MB: '+file.name);continue;
   }
   let hash;
   try{
    docsMessage('Verificando conteúdo de '+file.name+'...');
    hash=await docsFileSha256(file);
    const duplicate=await docsFindDuplicate(obraId,hash);
    if(duplicate){
     failed++;
     duplicateNotice='Documento já cadastrado nesta obra: '+(duplicate.nome_arquivo||duplicate.titulo||file.name)+'. Disponível para consulta; nenhum novo arquivo foi enviado. ⚠️⚠️⚠️';
     docsMessage(duplicateNotice,true);
     continue;
    }
   }catch(error){
    failed++;
    docsMessage('Não foi possível verificar duplicidade de '+file.name+': '+(error.message||String(error))+'. Envio bloqueado por segurança.');
    continue;
   }
   const path=obraId+'/'+crypto.randomUUID()+'/'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
   const mime=ext==='pdf'?'application/pdf':ext==='doc'?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
   docsMessage('Enviando '+(i+1)+' de '+files.length+': '+file.name+' ('+(file.size/1048576).toFixed(1)+' MB)...');
   try{
    const {error:uploadError}=await docsWithTimeout(()=>db.storage.from(docsBucket).upload(path,file,{contentType:mime,upsert:false}));
    if(uploadError)throw uploadError;
    const {error:insertError}=await docsWithTimeout(()=>db.from('documentos').insert({obra_id:obraId,secao_documental:section,categoria:category,titulo:file.name,nome_arquivo:file.name,provedor:'supabase_storage',identificador_externo:path,mime_type:mime,checksum_sha256:hash,uploaded_by:currentUser.id}));
    if(insertError){
     db.storage.from(docsBucket).remove([path]).then(()=>{},()=>{});
     if(insertError.code==='23505')throw new Error('Documento já cadastrado nesta obra. O arquivo está disponível para consulta.');
     throw insertError;
    }
    count++;
    docsMessage('Enviado: '+file.name+' ('+count+' concluído(s)).');
   }catch(error){
    failed++;
    docsMessage('Falha em '+file.name+': '+(error.message||String(error)));
   }
  }
 }catch(error){
  docsMessage('Erro inesperado: '+(error.message||String(error)));
 }finally{
  button.disabled=false;
  button.textContent='↑ Enviar arquivos';
  if(count) {
   $('docs-file').value='';
   docsMessage(count+' documento(s) enviado(s).'+(failed?' '+failed+' não enviado(s); consulte as mensagens de verificação.':''));
  }
  if(selectedWork?.id===obraId&&docsSection===section) {
   try{await docsWithTimeout(()=>loadDocuments(),15000);}catch(error){docsMessage('Envio encerrado, mas a lista demorou a atualizar. Atualize a página.');}
  }
  if(duplicateNotice)docsMessage(duplicateNotice,true);
 }
});
$('docs-search').addEventListener('input',renderDocuments);$('docs-filter').addEventListener('change',renderDocuments);

$('docs-maximize').addEventListener('click',()=>{if(docsSelected)openDocumentNewWindow(docsSelected);});
$('docs-download').addEventListener('click',()=>{if(docsSelected)downloadDocument(docsSelected);});
