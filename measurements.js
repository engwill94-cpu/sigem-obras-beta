'use strict';
(function(){
 const BUCKET='medicoes-obras',TABLE='medicoes_arquivos',MAX=50*1024*1024;
 const el=id=>document.getElementById(id);
 let rows=[],active='excel',workId=null,busy=false,deleteTarget=null,seq=0;
 const size=n=>n<1048576?Math.max(1,Math.round(n/1024))+' KB':(n/1048576).toFixed(1)+' MB';
 const date=s=>new Date(s).toLocaleString('pt-BR');
 const ext=name=>name.split('.').pop().toLowerCase();
 const status=(message)=>{el('med-upload-status').textContent=message;};
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
   info.append(name,meta);const actions=make('div','med-file-actions');
   if(row.formato==='pdf'){const view=make('button','','Visualizar');view.type='button';view.addEventListener('click',()=>openPdf(row));actions.append(view);}
   const down=make('button','','Baixar');down.type='button';down.addEventListener('click',()=>download(row));actions.append(down);
   const del=make('button','med-delete','Excluir');del.type='button';del.addEventListener('click',()=>askDelete(row));actions.append(del);
   item.append(icon,info,actions);list.append(item);
  }
 }
 async function load(){
  const id=selectedWork?.id,token=++seq;workId=id;rows=[];el('med-search').value='';status('');
  render();if(!id)return;
  const {data,error}=await db.from(TABLE).select('id,obra_id,nome_arquivo,formato,tamanho_bytes,storage_path,checksum_sha256,uploaded_by,created_at').eq('obra_id',id).order('created_at',{ascending:false});
  if(token!==seq||selectedWork?.id!==id)return;
  if(error){status('Não foi possível consultar a biblioteca: '+error.message);return;}
  rows=data||[];render();
 }
 async function upload(){
  if(busy||!selectedWork)return;
  const files=[...el('med-files').files];if(!files.length){status('Selecione pelo menos um arquivo.');return;}
  const id=selectedWork.id;busy=true;el('med-upload').disabled=true;
  const failures=[];let added=0;
  try{
   for(let i=0;i<files.length;i++){
    const file=files[i],type=ext(file.name);
    status('Processando '+(i+1)+' de '+files.length+': '+file.name);
    if(!['xls','xlsx','xlsm','pdf'].includes(type)){failures.push(file.name+' — formato não permitido');continue;}
    if(file.size>MAX||file.size===0){failures.push(file.name+' — tamanho inválido (limite 50 MB)');continue;}
    try{
     if(selectedWork?.id!==id)throw Error('A obra selecionada foi alterada.');
     const hash=await digest(file);
     const {data:existing,error:checkError}=await db.from(TABLE).select('id').eq('obra_id',id).eq('checksum_sha256',hash).limit(1);
     if(checkError)throw checkError;
     if(existing?.length){failures.push(file.name+' — arquivo idêntico já cadastrado');continue;}
     const path=id+'/'+crypto.randomUUID()+'.'+type;
     const {error:storageError}=await db.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
     if(storageError)throw storageError;
     const {error:insertError}=await db.from(TABLE).insert({obra_id:id,nome_arquivo:file.name,formato:type,tamanho_bytes:file.size,storage_path:path,checksum_sha256:hash,uploaded_by:currentUser.id});
     if(insertError){await db.storage.from(BUCKET).remove([path]);throw insertError;}
     added++;
    }catch(error){failures.push(file.name+' — '+error.message);}
   }
   el('med-files').value='';
   if(selectedWork?.id===id)await load();
   status((added?added+' arquivo(s) cadastrado(s).':'Nenhum arquivo cadastrado.')+(failures.length?'\nNão cadastrados:\n'+failures.join('\n'):''));
  }finally{busy=false;el('med-upload').disabled=false;}
 }
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
 el('med-delete-confirm')?.addEventListener('click',confirmDelete);
})();
