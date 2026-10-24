'use strict';
(function(){
 const BUCKET='medicoes-obras',TABLE='medicoes_arquivos',MAX=500*1024*1024;
 const el=id=>document.getElementById(id);
 let rows=[],active='excel',workId=null,busy=false,deleteTarget=null,editTarget=null,seq=0;
 const size=n=>n<1048576?Math.max(1,Math.round(n/1024))+' KB':(n/1048576).toFixed(1)+' MB';
 const date=s=>new Date(s).toLocaleString('pt-BR');
 const ext=name=>name.split('.').pop().toLowerCase();
 const status=(message)=>{el('med-upload-status').textContent=message;};
 const competence=s=>s?new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(s.slice(0,7)+'-01T00:00:00Z')).toUpperCase('pt-BR').replace(' DE ','/'):'Referência não identificada';
 const monthNames={'janeiro':1,'fevereiro':2,'marco':3,'abril':4,'maio':5,'junho':6,'julho':7,'agosto':8,'setembro':9,'outubro':10,'novembro':11,'dezembro':12};
 const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function findMonth(text){
  const s=normalize(text).replace(/\s+/g,' ');
  const near=/(?:periodo|mes|competencia|referencia)\s*(?:de|da|do)?\s*(?:medicao)?\s*[:\-–]?\s*(.{0,110})/g;
  const chunks=[...s.matchAll(near)].map(x=>x[1]);
  const periodDate=/\b(0?[1-9]|[12]\d|3[01])\s*[\/\-.]\s*(0?[1-9]|1[0-2])\s*[\/\-.]\s*(20\d{2})\b/;
  for(const part of chunks){const d=part.match(periodDate);if(d)return d[3]+'-'+d[2].padStart(2,'0');}
  const parse=part=>{
   const words=Object.keys(monthNames).join('|');
   let m=part.match(new RegExp('\\b('+words+')\\s*(?:de|\\/|\\-|\\s)*\\s*(20\\d{2})\\b','i'));
   if(m)return m[2]+'-'+String(monthNames[m[1]]).padStart(2,'0');
   m=part.match(/\b(0?[1-9]|1[0-2])\s*[\/\-.]\s*(20\d{2})\b/);
   if(m)return m[2]+'-'+m[1].padStart(2,'0');
   return null;
  };
  for(const part of chunks){const result=parse(part);if(result)return result;}
  const labelled=s.match(/periodo\s*[:\-–]?\s*(.{0,180})/);if(labelled){const d=labelled[1].match(periodDate);if(d)return d[3]+'-'+d[2].padStart(2,'0');}
  return parse(s);
 }
 async function detectMonth(file,type){
  if(type==='pdf'){
   if(!window.pdfjsLib)throw Error('Leitor de PDF indisponível.');
   const pdfjs=window.pdfjsLib;pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
   const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
   try{const page=await pdf.getPage(1),content=await page.getTextContent();const items=content.items.filter(x=>typeof x.str==='string');const text=items.map(x=>x.str).join(' ');let found=findMonth(text);if(found)return found;
    const positioned=items.map(x=>({text:x.str,y:Math.round((x.transform?.[5]||0)/5),x:x.transform?.[4]||0})).sort((a,b)=>b.y-a.y||a.x-b.x);found=findMonth(positioned.map(x=>x.text).join(' '));return found;
   }finally{await pdf.destroy();}
  }
  if(!window.XLSX)throw Error('Leitor de Excel indisponível.');
  const wb=window.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
  const cover=wb.SheetNames.find(n=>normalize(n).trim()==='capa');
  if(!cover)return null;
  const sheet=wb.Sheets[cover];const cells=Object.keys(sheet).filter(k=>!k.startsWith('!')).sort((a,b)=>{const ca=window.XLSX.utils.decode_cell(a),cb=window.XLSX.utils.decode_cell(b);return ca.r-cb.r||ca.c-cb.c;});
  const values=cells.map(k=>sheet[k].w||sheet[k].v||'').join(' ');return findMonth(values);
 }
 const fmt=f=>f==='pdf'?'PDF':f.toUpperCase();
 const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 async function digest(file){const buffer=await file.arrayBuffer();const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));return [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function render(){
  const excel=rows.filter(x=>x.formato!=='pdf'),pdf=rows.filter(x=>x.formato==='pdf');
  el('med-count-total').textContent=rows.length;el('med-count-excel').textContent=excel.length;el('med-count-pdf').textContent=pdf.length;
  el('med-tab-excel-count').textContent=excel.length;el('med-tab-pdf-count').textContent=pdf.length;
  for(const name of ['excel','pdf']){el('med-tab-'+name).classList.toggle('active',name===active);el('med-tab-'+name).setAttribute('aria-selected',String(name===active));}
  const term=el('med-search').value.trim().toLocaleLowerCase('pt-BR');
  const visible=(active==='excel'?excel:pdf).filter(x=>x.nome_arquivo.toLocaleLowerCase('pt-BR').includes(term));
  el('med-visible-count').textContent=visible.length+' arquivo(s)';
  const list=el('med-file-list');list.replaceChildren();
  if(!visible.length){list.append(make('p','med-empty',term?'Nenhum arquivo corresponde à pesquisa.':'Nenhum arquivo '+(active==='excel'?'Excel':'PDF')+' cadastrado.'));return;}
  for(const row of visible){
   const item=make('div','med-file-row'),icon=make('span','med-file-icon',row.formato==='pdf'?'▤':'▦');
   const info=make('div','med-file-info'),name=make('strong','',row.nome_arquivo),meta=make('small','',fmt(row.formato)+' · '+size(row.tamanho_bytes)+' · '+date(row.created_at));
   info.append(name,meta);const ref=make('div','med-file-competence');ref.append(make('span','','MÊS DE REFERÊNCIA'),make('strong','',competence(row.competencia)));const edit=make('button','med-ref-edit','Editar');edit.type='button';edit.addEventListener('click',()=>editCompetence(row));ref.append(edit);if(!row.competencia){const retry=make('button','med-ref-edit','Identificar novamente');retry.type='button';retry.addEventListener('click',()=>retryCompetence(row));ref.append(retry);}const actions=make('div','med-file-actions');
   if(row.formato==='pdf'){const view=make('button','','Visualizar');view.type='button';view.addEventListener('click',()=>openPdf(row));actions.append(view);}
   const down=make('button','','Baixar');down.type='button';down.addEventListener('click',()=>download(row));actions.append(down);
   const del=make('button','med-delete','Excluir');del.type='button';del.addEventListener('click',()=>askDelete(row));actions.append(del);
   item.append(icon,info,ref,actions);list.append(item);
  }
 }
 async function load(){
  const id=selectedWork?.id,token=++seq;workId=id;rows=[];el('med-search').value='';status('');
  render();if(!id)return;
  const {data,error}=await db.from(TABLE).select('id,obra_id,nome_arquivo,formato,tamanho_bytes,storage_path,checksum_sha256,uploaded_by,created_at,competencia').eq('obra_id',id).order('created_at',{ascending:false});
  if(token!==seq||selectedWork?.id!==id)return;
  if(error){status('Não foi possível consultar a biblioteca: '+error.message);return;}
  rows=data||[];render();
 }
 async function storageUpload(path,file){
  if(file.size<=6*1024*1024)return db.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
  if(!window.tus)return {error:new Error('Módulo de upload de arquivos grandes não carregado.')};
  const {data:session,error:sessionError}=await db.auth.getSession();if(sessionError||!session?.session?.access_token)return {error:sessionError||new Error('Sessão expirada. Entre novamente.')};
  return new Promise(resolve=>{
   const upload=new window.tus.Upload(file,{
    endpoint:'https://nigrecjshlxflczfzssn.storage.supabase.co/storage/v1/upload/resumable',
    retryDelays:[0,3000,5000,10000,20000],chunkSize:6*1024*1024,
    headers:{authorization:'Bearer '+session.session.access_token},
    uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,
    metadata:{bucketName:BUCKET,objectName:path,contentType:file.type||'application/octet-stream',cacheControl:'3600'},
    onError:error=>resolve({error}),onSuccess:()=>resolve({error:null}),
    onProgress:(sent,total)=>status('Enviando '+file.name+': '+Math.round(sent/total*100)+'%')
   });upload.start();
  });
 }
 async function upload(){
  if(busy||!selectedWork)return;
  const files=[...el('med-files').files];if(!files.length){status('Selecione pelo menos um arquivo.');return;}
  const id=selectedWork.id;busy=true;el('med-upload').disabled=true;
  const failures=[],unidentified=[];let added=0;
  try{
   for(let i=0;i<files.length;i++){
    const file=files[i],type=ext(file.name);
    status('Processando '+(i+1)+' de '+files.length+': '+file.name);
    if(!['xls','xlsx','xlsm','pdf'].includes(type)){failures.push(file.name+' — formato não permitido');continue;}
    if(file.size>MAX||file.size===0){failures.push(file.name+' — tamanho inválido (limite 500 MB)');continue;}
    try{
     if(selectedWork?.id!==id)throw Error('A obra selecionada foi alterada.');
     let month=null;try{month=await detectMonth(file,type);}catch(err){console.warn('Leitura automática da capa não concluída:',err);}
     const hash=await digest(file);
     const {data:existing,error:checkError}=await db.from(TABLE).select('id').eq('obra_id',id).eq('checksum_sha256',hash).limit(1);
     if(checkError)throw checkError;
     if(existing?.length){failures.push(file.name+' — arquivo idêntico já cadastrado');continue;}
     const path=id+'/'+crypto.randomUUID()+'.'+type;
     const {error:storageError}=await db.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
     if(storageError)throw storageError;
     const {error:insertError}=await db.from(TABLE).insert({obra_id:id,nome_arquivo:file.name,formato:type,tamanho_bytes:file.size,storage_path:path,checksum_sha256:hash,uploaded_by:currentUser.id,competencia:month?month+'-01':null});
     if(insertError){await db.storage.from(BUCKET).remove([path]);throw insertError;}
     added++;if(!month)unidentified.push(file.name);
    }catch(error){failures.push(file.name+' — '+error.message);}
   }
   el('med-files').value='';
   if(selectedWork?.id===id)await load();
   status((added?added+' arquivo(s) cadastrado(s).':'Nenhum arquivo cadastrado.')+(failures.length?'\nNão cadastrados:\n'+failures.join('\n'):'')+(unidentified.length?'\nReferência não identificada (use Editar): '+unidentified.join(', '):''));
  }finally{busy=false;el('med-upload').disabled=false;}
 }
 async function retryCompetence(row){
  if(busy||selectedWork?.id!==row.obra_id)return;
  busy=true;status('Analisando a capa de '+row.nome_arquivo+'...');
  try{const {data,error}=await db.storage.from(BUCKET).download(row.storage_path);if(error)throw error;
   const file=new File([data],row.nome_arquivo,{type:data.type});const month=await detectMonth(file,row.formato);
   if(!month){status('Não foi possível identificar a referência na capa de '+row.nome_arquivo+'. Se o PDF for digitalizado como imagem, será necessário OCR.');return;}
   const {error:saveError}=await db.from(TABLE).update({competencia:month+'-01'}).eq('id',row.id).eq('obra_id',row.obra_id);if(saveError)throw saveError;
   row.competencia=month+'-01';render();status('Referência identificada: '+competence(row.competencia));
  }catch(error){status('Erro ao analisar a capa: '+error.message);}finally{busy=false;}
 }
 function editCompetence(row){editTarget=row;el('med-edit-file').textContent=row.nome_arquivo;el('med-edit-month').value=row.competencia?.slice(0,7)||'';el('med-edit-status').textContent='';el('med-edit-competence').classList.remove('hidden');}
 function closeEdit(){el('med-edit-competence').classList.add('hidden');editTarget=null;}
 async function saveCompetence(){if(!editTarget||busy)return;const month=el('med-edit-month').value;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){el('med-edit-status').textContent='Informe um mês válido.';return;}const row=editTarget;if(selectedWork?.id!==row.obra_id)return;busy=true;el('med-edit-save').disabled=true;try{const {error}=await db.from(TABLE).update({competencia:month+'-01'}).eq('id',row.id).eq('obra_id',row.obra_id);if(error)throw error;row.competencia=month+'-01';closeEdit();render();status('Referência atualizada.');}catch(error){el('med-edit-status').textContent=error.message;}finally{busy=false;el('med-edit-save').disabled=false;}}
 async function download(row){
  try{
   const {data,error}=await db.storage.from(BUCKET).download(row.storage_path);
   if(error)throw error;
   const url=URL.createObjectURL(data),link=document.createElement('a');
   link.href=url;link.download=row.nome_arquivo;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){status('Não foi possível baixar '+row.nome_arquivo+': '+error.message);}
 }
 async function openPdf(row){
  const tab=window.open('about:blank','_blank');
  try{
   const {data,error}=await db.storage.from(BUCKET).createSignedUrl(row.storage_path,120);
   if(error)throw error;
   if(tab)tab.location.href=data.signedUrl;else window.location.href=data.signedUrl;
  }catch(error){if(tab)tab.close();status('Não foi possível visualizar o PDF: '+error.message);}
 }
 function askDelete(row){deleteTarget=row;el('med-confirm-text').textContent='Deseja excluir definitivamente o arquivo “'+row.nome_arquivo+'”? Esta ação removerá o registro e o arquivo armazenado.';el('med-delete-status').textContent='';el('med-confirm').classList.remove('hidden');}
 function closeDelete(){el('med-confirm').classList.add('hidden');deleteTarget=null;}
 async function confirmDelete(){
  if(!deleteTarget||busy)return;
  const row=deleteTarget,id=selectedWork?.id;
  if(id!==row.obra_id){el('med-delete-status').textContent='A obra selecionada foi alterada.';return;}
  busy=true;el('med-delete-confirm').disabled=true;
  try{
   const {data:removed,error:storageError}=await db.storage.from(BUCKET).remove([row.storage_path]);
   if(storageError)throw storageError;
   if(!removed?.length)throw Error('O arquivo não foi localizado no armazenamento.');
   const {error:dbError}=await db.from(TABLE).delete().eq('id',row.id).eq('obra_id',id);
   if(dbError)throw dbError;
   closeDelete();await load();status('Arquivo excluído com sucesso.');
  }catch(error){el('med-delete-status').textContent='Falha ao excluir: '+error.message;}
  finally{busy=false;el('med-delete-confirm').disabled=false;}
 }
 window.measurementsLoad=load;
 el('med-upload')?.addEventListener('click',upload);
 el('med-tab-excel')?.addEventListener('click',()=>{active='excel';render();});
 el('med-tab-pdf')?.addEventListener('click',()=>{active='pdf';render();});
 el('med-search')?.addEventListener('input',render);
 el('med-cancel')?.addEventListener('click',closeDelete);
 el('med-edit-cancel')?.addEventListener('click',closeEdit);
 el('med-edit-save')?.addEventListener('click',saveCompetence);
 el('med-delete-confirm')?.addEventListener('click',confirmDelete);
})();
