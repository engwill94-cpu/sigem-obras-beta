'use strict';
const docsBucket='documentos-obras';
const docsCategories={contrato:'Contrato',termo_referencia:'Termo de Referência',aditamento:'Termo de Aditamento',pgt:'PGT',outro:'Outro'};
let docsRecords=[],docsSelected=null,docsUrl=null,docsZoom=100,docsRequest=0;
function docsMessage(message){$('docs-upload-status').textContent=message;}
function docsClearPreview(){docsSelected=null;$('docs-view-frame').removeAttribute('src');if(docsUrl)URL.revokeObjectURL(docsUrl);docsUrl=null;$('docs-view-container').classList.add('hidden');$('docs-view-empty').classList.remove('hidden');$('docs-view-empty').textContent='Selecione um documento na lista para visualizar.';$('docs-view-name').textContent='Nenhum documento selecionado';}
async function loadDocuments(){
 if(!selectedWork||!db)return;
 const id=selectedWork.id,request=++docsRequest;
 $('docs-rows').textContent='Carregando documentos...';
 const {data,error}=await db.from('documentos').select('id,obra_id,categoria,nome_arquivo,titulo,identificador_externo,mime_type,created_at').eq('obra_id',id).eq('provedor','supabase_storage').order('created_at',{ascending:false});
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
 docsClearPreview();docsSelected=d;$('docs-view-name').textContent=d.nome_arquivo||d.titulo;
 $('docs-view-empty').textContent='Carregando documento...';
 if(!(/\.pdf$/i.test(d.nome_arquivo||'')||d.mime_type==='application/pdf')){$('docs-view-empty').textContent='Arquivo Word: pré-visualização indisponível nesta etapa. Utilize o download.';return;}
 try{const blob=await docsGetBlob(d);if(docsSelected?.id!==d.id)return;docsUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));$('docs-view-frame').src=docsUrl+'#toolbar=0&zoom='+docsZoom;$('docs-view-container').classList.remove('hidden');$('docs-view-empty').classList.add('hidden');}
 catch(e){$('docs-view-empty').textContent='Erro ao abrir: '+e.message;}
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
$('docs-send').addEventListener('click',async()=>{
 if(!selectedWork||!currentUser)return;
 const files=Array.from($('docs-file').files);if(!files.length){docsMessage('Selecione arquivos.');return;}
 const obraId=selectedWork.id,category=$('docs-category').value,button=$('docs-send');button.disabled=true;let count=0;
 for(const file of files){
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['pdf','doc','docx'].includes(ext)||file.size>50*1024*1024){docsMessage('Arquivo inválido ou maior que 50 MB: '+file.name);continue;}
  const path=obraId+'/'+crypto.randomUUID()+'/'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  docsMessage('Enviando '+file.name+'...');
  const mime=ext==='pdf'?'application/pdf':ext==='doc'?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const {error:uploadError}=await db.storage.from(docsBucket).upload(path,file,{contentType:mime,upsert:false});
  if(uploadError){docsMessage('Falha no upload: '+uploadError.message);continue;}
  const {error}=await db.from('documentos').insert({obra_id:obraId,categoria,titulo:file.name,nome_arquivo:file.name,provedor:'supabase_storage',identificador_externo:path,mime_type:mime,uploaded_by:currentUser.id});
  if(error){await db.storage.from(docsBucket).remove([path]);docsMessage('Falha no registro: '+error.message);continue;}count++;
 }
 button.disabled=false;$('docs-file').value='';if(count)docsMessage(count+' documento(s) enviado(s).');if(selectedWork?.id===obraId)await loadDocuments();
});
$('docs-search').addEventListener('input',renderDocuments);$('docs-filter').addEventListener('change',renderDocuments);
$('docs-download').addEventListener('click',()=>{if(docsSelected)downloadDocument(docsSelected);});
$('docs-maximize').addEventListener('click',()=>{
 if(!docsUrl){docsMessage('Leitura ampliada disponível para PDF selecionado.');return;}
 const w=window.open('','_blank');if(!w){docsMessage('Permita janelas pop-up para ampliar a leitura.');return;}
 w.document.title='Leitura de documento';w.document.body.style.margin='0';
 const frame=w.document.createElement('iframe');frame.src=docsUrl;frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0';w.document.body.append(frame);
});
function docsChangeZoom(step){docsZoom=Math.max(50,Math.min(200,docsZoom+step));$('docs-zoom-label').textContent=docsZoom+'%';if(docsUrl)$('docs-view-frame').src=docsUrl+'#toolbar=0&zoom='+docsZoom;}
$('docs-zoom-in').addEventListener('click',()=>docsChangeZoom(25));$('docs-zoom-out').addEventListener('click',()=>docsChangeZoom(-25));
