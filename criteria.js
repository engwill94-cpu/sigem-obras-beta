'use strict';
(function(){
const BUCKET='criterios-medicao-obras',TABLE='criterios_medicao_arquivos',MAX=500*1024*1024;
const el=id=>document.getElementById(id);
let rows=[],busy=false,request=0,selected=null,previewSeq=0,modalBlobUrl=null;
const msg=s=>{if(el('crit-status'))el('crit-status').textContent=s;};
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const ext=n=>n.split('.').pop().toLowerCase();
async function preparePdf(file){
  if(!window.pdfjsLib||!window.PDFLib||!window.Tesseract)throw Error('Dependências de conversão OCR indisponíveis.');
  const buffer=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(buffer.slice(0))}).promise;
  let converted=null,worker=null,count=0,period=null,font=null;
  try{
   for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n),content=await page.getTextContent();
    const text=content.items.map(x=>x.str||'').join(' ');
    if(n===1)period=findMonth(text);
    if(text.trim().length>35)continue;
    const operators=await page.getOperatorList();
    const hasImage=operators.fnArray.some(op=>op===pdfjsLib.OPS.paintImageXObject||op===pdfjsLib.OPS.paintInlineImageXObject||op===pdfjsLib.OPS.paintImageMaskXObject||op===pdfjsLib.OPS.paintJpegXObject);
    if(!hasImage)continue;
    if(!converted){converted=await PDFLib.PDFDocument.load(buffer,{updateMetadata:false});font=await converted.embedFont(PDFLib.StandardFonts.Helvetica);}
    if(!worker)worker=await Tesseract.createWorker('por');
    msg('OCR: página '+n+' de '+pdf.numPages+' ('+count+' convertida(s)). Não feche esta aba.');
    const viewport=page.getViewport({scale:n===1?1.5:1.15}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    await page.render({canvasContext:ctx,viewport}).promise;
    const result=await worker.recognize(canvas,{}, {text:true,blocks:true});
    canvas.width=0;canvas.height=0;
    if(n===1&&!period)period=findMonth(result.data.text);
    const p=converted.getPage(n-1),{width,height}=p.getSize();
    const lines=result.data.lines||result.data.blocks?.flatMap(b=>b.paragraphs?.flatMap(p=>p.lines||[])||[])||[];
    for(const line of lines){
     const box=line.bbox;if(!box||!line.text?.trim())continue;
     const x=Math.max(0,box.x0/viewport.width*width),y=Math.max(0,height-box.y1/viewport.height*height);
     const fontSize=Math.max(4,Math.min(22,(box.y1-box.y0)/viewport.height*height));
     const safe=line.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'');
     if(!safe.trim())continue;
     p.drawText(safe,{x,y,size:fontSize,font,color:PDFLib.rgb(0,0,0),opacity:0});
    }
    count++;
   }
   if(!converted)return {file:null,period,status:'original_pesquisavel',detail:'Todas as páginas possuem texto pesquisável.'};
   if(!count)throw Error('Não foi possível reconhecer texto nas páginas digitalizadas.');
   msg('Gerando versão PDF pesquisável...');
   const bytes=await converted.save({useObjectStreams:true});
   return {file:new File([bytes],file.name.replace(/\.pdf$/i,'')+'-pesquisavel.pdf',{type:'application/pdf'}),period,status:'convertido',detail:count+' página(s) processada(s) com OCR'};
  }finally{if(worker)await worker.terminate();await pdf.destroy();}
 }


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
  for(const [label,action] of [...(row.ocr_status?[]:[['Aplicar OCR','ocr']]),['Visualizar','view'],['Baixar','download'],['Excluir','delete']]){
   const b=document.createElement('button');b.type='button';b.textContent=label;b.className='secondary';b.onclick=()=>perform(row,action);actions.append(b);
  }
  item.append(actions);item.classList.toggle('active',selected===row.id);item.tabIndex=0;item.setAttribute('role','button');item.setAttribute('aria-label','Selecionar '+row.nome_arquivo+' para visualização rápida');item.onclick=e=>{if(e.target.closest('button'))return;preview(row);};item.onkeydown=e=>{if(e.target===item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();preview(row);}};list.append(item);
 }
}
async function perform(row,action){
 if(action==='ocr'){await applyExistingOcr(row);return;}
 if(action==='delete'){
  if(!confirm('Excluir definitivamente o arquivo "'+row.nome_arquivo+'"?'))return;
  const {error}=await db.from(TABLE).delete().eq('id',row.id).eq('obra_id',row.obra_id);
  if(error){msg('Falha ao excluir: '+error.message);return;}
  const {error:storageError}=await db.storage.from(BUCKET).remove([row.storage_path,...(row.pdf_pesquisavel_path?[row.pdf_pesquisavel_path]:[])]);
  if(storageError)msg('Registro excluído, mas o arquivo precisa ser removido do armazenamento: '+storageError.message);
  if(selected===row.id){selected=null;clearPreview();}await load();return;
 }
 const {data:blob,error:downloadError}=await db.storage.from(BUCKET).download(action==='view'?(row.pdf_pesquisavel_path||row.storage_path):row.storage_path);
 if(downloadError){msg('Erro ao recuperar PDF: '+downloadError.message);return;}
 if(action==='view'){
  const signature=new Uint8Array(await blob.slice(0,5).arrayBuffer());
  if(String.fromCharCode(...signature)!=='%PDF-'){msg('O arquivo recuperado não contém uma assinatura PDF válida.');return;}
  if(modalBlobUrl)URL.revokeObjectURL(modalBlobUrl);
  modalBlobUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));
  const frame=el('crit-modal-frame');frame.src='criteria-viewer.html#'+encodeURIComponent(JSON.stringify({url:modalBlobUrl,name:row.nome_arquivo}));
  el('crit-modal-title').textContent=row.nome_arquivo;el('crit-modal').classList.remove('hidden');el('crit-modal-close').focus();
 }else{
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=row.nome_arquivo;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
}
function clearPreview(){previewSeq++;el('crit-preview-name').textContent='Nenhum documento selecionado';el('crit-preview-frame').removeAttribute('src');el('crit-preview-frame').classList.add('hidden');el('crit-preview-empty').classList.remove('hidden');}
async function preview(row){const token=++previewSeq;selected=row.id;render();el('crit-preview-name').textContent=row.nome_arquivo;el('crit-preview-empty').textContent='Carregando PDF...';el('crit-preview-empty').classList.remove('hidden');el('crit-preview-frame').classList.add('hidden');const {data,error}=await db.storage.from(BUCKET).createSignedUrl(row.pdf_pesquisavel_path||row.storage_path,120);if(token!==previewSeq)return;if(error){msg('Erro ao visualizar: '+error.message);return;}el('crit-preview-frame').src=data.signedUrl+'#toolbar=1';el('crit-preview-frame').classList.remove('hidden');el('crit-preview-empty').classList.add('hidden');}
function closeModal(){el('crit-modal').classList.add('hidden');el('crit-modal-frame').removeAttribute('src');if(modalBlobUrl){URL.revokeObjectURL(modalBlobUrl);modalBlobUrl=null;}}
async function applyExistingOcr(row){
 if(busy)return;busy=true;msg('Preparando OCR de '+row.nome_arquivo+'...');
 try{
  const {data:blob,error}=await db.storage.from(BUCKET).download(row.storage_path);if(error)throw error;
  const file=new File([blob],row.nome_arquivo,{type:'application/pdf'}),processed=await preparePdf(file);
  let searchablePath=null;
  if(processed.file){searchablePath=row.obra_id+'/pesquisaveis/'+crypto.randomUUID()+'.pdf';const {error:uploadError}=await uploadStorage(searchablePath,processed.file);if(uploadError)throw uploadError;}
  const {error:saveError}=await db.from(TABLE).update({pdf_pesquisavel_path:searchablePath,ocr_status:processed.status,ocr_detalhe:processed.detail}).eq('id',row.id).eq('obra_id',row.obra_id);
  if(saveError){if(searchablePath)await db.storage.from(BUCKET).remove([searchablePath]);throw saveError;}
  if(selected===row.id){selected=null;clearPreview();}await load();msg('OCR concluído: '+row.nome_arquivo+'. '+processed.detail);
 }catch(e){msg('Falha no OCR: '+e.message);}finally{busy=false;}
}
async function upload(){
 if(busy||!selectedWork)return;
 const files=[...el('crit-files').files];if(!files.length){msg('Selecione arquivos.');return;}
 const id=selectedWork.id;busy=true;el('crit-upload').disabled=true;
 let added=0;const errors=[];
 try{
  for(const file of files){
   const type=ext(file.name);
   if(type!=='pdf'||file.size===0||file.size>MAX){errors.push(file.name+': apenas arquivos PDF de até 500 MB são permitidos');continue;}
   let path=null,searchablePath=null;
   try{
    const signature=new Uint8Array(await file.slice(0,5).arrayBuffer());if(String.fromCharCode(...signature)!=='%PDF-')throw Error('O conteúdo do arquivo não é um PDF válido.');
    msg('Verificando '+file.name+'...');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const {data:dup,error:checkError}=await db.from(TABLE).select('id').eq('obra_id',id).eq('checksum_sha256',hash).limit(1);
    if(checkError)throw checkError;if(dup?.length){errors.push(file.name+': arquivo idêntico já cadastrado');continue;}
    const processed=await preparePdf(file);
    path=id+'/'+crypto.randomUUID()+'.'+type;
    const {error:storageError}=await uploadStorage(path,file);if(storageError)throw storageError;
    if(processed.file){searchablePath=id+'/pesquisaveis/'+crypto.randomUUID()+'.pdf';const {error:ocrError}=await uploadStorage(searchablePath,processed.file);if(ocrError)throw ocrError;}
    const {error:saveError}=await db.from(TABLE).insert({obra_id:id,nome_arquivo:file.name,storage_path:path,tamanho_bytes:file.size,formato:type,checksum_sha256:hash,uploaded_by:currentUser.id,pdf_pesquisavel_path:searchablePath,ocr_status:processed.status,ocr_detalhe:processed.detail});
    if(saveError)throw saveError;added++;
   }catch(e){errors.push(file.name+': '+e.message);if(path)await db.storage.from(BUCKET).remove([path,...(searchablePath?[searchablePath]:[])]);}
  }
  el('crit-files').value='';await load();msg(added+' arquivo(s) cadastrado(s).'+(errors.length?' Falhas: '+errors.join('; '):''));
 }finally{busy=false;el('crit-upload').disabled=false;}
}
window.criteriaLoad=load;
document.addEventListener('DOMContentLoaded',()=>{el('crit-upload')?.addEventListener('click',upload);el('crit-search')?.addEventListener('input',render);el('crit-modal-close')?.addEventListener('click',closeModal);el('crit-modal')?.addEventListener('click',e=>{if(e.target===el('crit-modal'))closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('crit-modal').classList.contains('hidden'))closeModal();});});
})();