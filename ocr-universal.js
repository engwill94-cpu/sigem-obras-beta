'use strict';
/* Motor comum de OCR do SIGEM: usado por bibliotecas atuais e futuras via sigemIndexarNovoArquivo. */
(function(){
 const LIMIT_BYTES=12*1024*1024,LIMIT_PAGES=80;
 let active=false,queue=Promise.resolve();
 async function ocrDocumento(id,onProgress=()=>{}){
  if(active)return {status:'ocupado'};
  if(!db||!window.pdfjsLib||!window.Tesseract)throw Error('Bibliotecas de OCR indisponíveis.');
  const {data:job,error:lookupError}=await db.from('documento_indexacao').select('id,storage_bucket,storage_path,nome_arquivo,status').eq('id',id).single();
  if(lookupError)throw lookupError;
  if(!['falhou','pendente'].includes(job.status))return {status:'ignorado'};
  if(!job.storage_path.toLowerCase().endsWith('.pdf'))throw Error('OCR disponível somente para PDF.');
  const {data:file,error:downloadError}=await db.storage.from(job.storage_bucket).download(job.storage_path);
  if(downloadError)throw downloadError;
  if(file.size>LIMIT_BYTES)throw Error('PDF acima de 12 MB: aguarda processador de arquivos grandes.');
  active=true;let pdf=null,worker=null;
  try{
   pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
   if(pdf.numPages>LIMIT_PAGES)throw Error('PDF acima de 80 páginas: aguarda processamento por partes.');
   const paginas=[];
   for(let n=1;n<=pdf.numPages;n++){
    onProgress('OCR: página '+n+' de '+pdf.numPages+' — '+job.nome_arquivo);
    const page=await pdf.getPage(n),content=await page.getTextContent();
    let texto=content.items.map(x=>x.str||'').join(' ').trim();
    if(texto.length<35){
     const viewport=page.getViewport({scale:1.3});
     const canvas=document.createElement('canvas');
     canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     try{
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      if(!worker)worker=await Tesseract.createWorker('por');
      const result=await worker.recognize(canvas);
      texto=result.data.text||'';
     }finally{canvas.width=0;canvas.height=0;}
    }
    paginas.push({pagina:n,texto:texto.slice(0,120000)});
    page.cleanup();
   }
   if(!paginas.some(p=>p.texto.trim()))throw Error('Nenhum texto reconhecido pelo OCR.');
   onProgress('Gravando OCR no índice de pesquisa...');
   const {data,error}=await db.functions.invoke('sigem-indexar-documento',{body:{action:'salvar_ocr',id,paginas}});
   if(error){let msg=error.message;try{msg=(await error.context?.json())?.error||msg;}catch{}throw Error(msg);}
   if(data?.status!=='concluido')throw Error(data?.error||'Não foi possível confirmar a indexação OCR.');
   return data;
  }finally{
   if(worker)await worker.terminate();
   if(pdf)await pdf.destroy();
   active=false;
  }
 }
 window.sigemOcrDocumento=(id,onProgress)=>{
  const next=queue.then(()=>ocrDocumento(id,onProgress));
  queue=next.catch(()=>{});
  return next;
 };
})();