'use strict';
(function(){
 const MAX_PDF=120*1024*1024,MAX_PAGES=1000,MAX_EXCEL=250*1024*1024;
 let queue=Promise.resolve();
 function chunks(text,max=2500){const out=[];let s=String(text||'').replace(/\s+/g,' ').trim();while(s.length){let n=Math.min(max,s.length);if(n<s.length){const i=s.lastIndexOf(' ',n);if(i>max/2)n=i;}out.push(s.slice(0,n).trim());s=s.slice(n).trim();}return out.filter(Boolean);}
 async function invoke(body){
  const {data,error}=await db.functions.invoke('sigem-indexar-documento',{body:{action:'lote_grande',...body}});
  if(error){let message=error.message;try{message=(await error.context?.json())?.error||message;}catch{}throw Error(message);}
  if(data?.error)throw Error(data.error);
  return data;
 }
 async function run(id,notify=()=>{}){
  if(!db)throw Error('Banco indisponível.');
  const {data:job,error:lookupError}=await db.from('documento_indexacao').select('id,storage_bucket,storage_path,nome_arquivo,status').eq('id',id).single();
  if(lookupError)throw lookupError;
  if(!['pendente','falhou'].includes(job.status))return {status:'ignorado'};
  const name=job.nome_arquivo||job.storage_path,ext=name.split('.').pop().toLowerCase();
  if(!['pdf','xlsx','xls','xlsm'].includes(ext))throw Error('Formato não suportado para indexação.');
  const {data:file,error:downloadError}=await db.storage.from(job.storage_bucket).download(job.storage_path);
  if(downloadError)throw downloadError;
  if(ext==='pdf'&&file.size>MAX_PDF)throw Error('PDF acima de 120 MB.');
  if(ext!=='pdf'&&file.size>MAX_EXCEL)throw Error('Planilha acima de 250 MB.');
  let pdf=null,worker=null,started=false,count=0,pages=0,method=ext==='pdf'?'pdf':'excel',lastPulse=0;
  const buffer=[];
  async function pulse(){if(Date.now()-lastPulse>45000){await invoke({fase:'pulso',id});lastPulse=Date.now();}}
  async function flush(){
   if(!buffer.length)return;
   const batch=buffer.splice(0,buffer.length);
   const result=await invoke({fase:'parte',id,inicio:count,trechos:batch,metodo:method});
   count=result.trechos;
  }
  function append(text,location){
   for(const piece of chunks(text))buffer.push({...location,texto:piece});
  }
  try{
   if(ext==='pdf'){
    if(!window.pdfjsLib||!window.Tesseract)throw Error('Leitor PDF/OCR indisponível.');
    notify('Abrindo PDF: '+name);
    pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),disableAutoFetch:true}).promise;
    pages=pdf.numPages;
    if(pages>MAX_PAGES)throw Error('PDF acima de 1.000 páginas.');
   }else{
    if(!window.XLSX)throw Error('Leitor Excel indisponível.');
   }
   await invoke({fase:'iniciar',id});started=true;lastPulse=Date.now();
   if(pdf){
    for(let n=1;n<=pages;n++){
     notify('PDF: página '+n+' de '+pages+' — '+name+' · '+count+' trechos gravados');
     const page=await pdf.getPage(n),content=await page.getTextContent();
     let text=content.items.map(x=>x.str||'').join(' ').trim();
     if(text.length<35){
      const viewport=page.getViewport({scale:1.25}),canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try{
       await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
       if(!worker)worker=await Tesseract.createWorker('por');
       text=(await worker.recognize(canvas)).data.text||'';
      }finally{canvas.width=0;canvas.height=0;}
     }
     append(text,{pagina:n});
     page.cleanup();
     if(buffer.length>=60||n===pages)await flush();
     await pulse();

    }
   }else{
    notify('Lendo estrutura Excel: '+name);
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',dense:true,cellDates:false,cellFormula:true});
    pages=workbook.SheetNames.length;
    if(!pages)throw Error('Planilha sem abas.');
    for(let k=0;k<workbook.SheetNames.length;k++){
     const sheetName=workbook.SheetNames[k],sheet=workbook.Sheets[sheetName];
     notify('Excel: aba '+(k+1)+' de '+pages+' — '+sheetName+' · '+count+' trechos');
     if(!sheet?.['!ref'])continue;
     const range=XLSX.utils.decode_range(sheet['!ref']);
     if(range.e.r-range.s.r>1000000)throw Error('Aba excede um milhão de linhas.');
     for(let r=range.s.r;r<=range.e.r;r++){
      const row=[];
      for(let c=range.s.c;c<=range.e.c;c++){
       const cell=sheet[XLSX.utils.encode_cell({r,c})];
       if(!cell)continue;
       const addr=XLSX.utils.encode_cell({r,c});
       const val=cell.w??cell.v;
       if(val!==undefined&&val!==null&&String(val)!=='')row.push(addr+': '+String(val)+(cell.f?' [fórmula: '+cell.f+']':''));
      }
      if(row.length)append(row.join(' | '),{aba:sheetName,celula:XLSX.utils.encode_cell({r,c:range.s.c})});
      if(buffer.length>=60)await flush();
      if(r%100===0)await pulse();
     }
     await flush();await pulse();
    }
   }
   if(!count)throw Error('Arquivo sem conteúdo textual extraível.');
   const done=await invoke({fase:'concluir',id,total_paginas:pages,metodo:method});
   notify('Indexação concluída: '+count+' trechos.');
   return done;
  }catch(e){
   if(started){try{await invoke({fase:'falhar',id,erro:e.message});}catch(err){console.warn('Falha ao registrar interrupção:',err);}}
   throw e;
  }finally{if(worker)await worker.terminate();if(pdf)await pdf.destroy();}
 }
 window.sigemProcessarArquivoGrande=(id,notify)=>{
  const next=queue.then(()=>run(id,notify));
  queue=next.catch(()=>{});
  return next;
 };
})();