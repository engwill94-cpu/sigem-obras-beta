'use strict';
(function(){
const el=id=>document.getElementById(id);
const names={documentos:'Documentos',projetos_spobras:'Projetos SPOBRAS',medicoes_arquivos:'Medições',criterios_medicao_arquivos:'Critérios de medição',aditamentos_arquivos:'Aditamento',prateleiras_arquivos:'Prateleiras'};
let records=[],busy=false,batchRunning=false,batchStop=false,watchdogBusy=false;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message){el('idx-status').textContent=message||'';}
async function load(showFeedback=false){
 if(!selectedWork?.id||!db)return;
 const {data,error}=await db.from('documento_indexacao').select('id,origem_tabela,nome_arquivo,status,total_paginas,total_trechos,erro').eq('obra_id',selectedWork.id).order('criado_em',{ascending:true});
 if(error){status('Não foi possível consultar a fila: '+error.message);return;}
 records=data||[];
 const counts={};for(const r of records)counts[r.status]=(counts[r.status]||0)+1;
 el('idx-counts').textContent=records.length+' arquivo(s) · '+(counts.concluido||0)+' concluído(s) · '+(counts.pendente||0)+' pendente(s) · '+(counts.falhou||0)+' falha(s) · '+(counts.processando||0)+' processando';
 if(showFeedback)status('Situação atualizada às '+new Date().toLocaleTimeString('pt-BR')+'.');
 el('idx-list').innerHTML=records.length?records.map(r=>'<div class="idx-item"><div><strong>'+escape(r.nome_arquivo)+'</strong><small>'+escape(names[r.origem_tabela]||r.origem_tabela)+' · '+escape(r.status)+(r.total_paginas?' · '+r.total_paginas+' página(s)':'')+(r.total_trechos?' · '+r.total_trechos+' trecho(s)':'')+'</small>'+(r.erro?'<small class="idx-error">'+escape(r.erro)+'</small>':'')+'</div>'+(r.status==='pendente'?'<button type="button" data-index-id="'+escape(r.id)+'">Processar</button>':r.status==='falhou'&&/OCR necessário|sem camada textual/i.test(r.erro||'')?'<button type="button" data-ocr-id="'+escape(r.id)+'">Aplicar OCR</button>':'')+'</div>').join(''):'Nenhum documento cadastrado na fila desta obra.';
 el('idx-list').querySelectorAll('[data-index-id]').forEach(b=>b.addEventListener('click',()=>process(b.dataset.indexId)));
 el('idx-list').querySelectorAll('[data-ocr-id]').forEach(b=>b.addEventListener('click',()=>aplicarOcr(b.dataset.ocrId)));
}
async function aplicarOcr(id){
 if(busy||batchRunning)return;
 busy=true;el('idx-next').disabled=true;el('idx-batch').disabled=true;
 try{
  const result=await window.sigemOcrDocumento(id,status);
  status(result?.status==='concluido'?'OCR concluído: '+result.trechos+' trechos pesquisáveis.':'OCR não realizado: '+(result?.status||'indisponível'));
 }catch(e){status('OCR não concluído: '+(e.message||e));}
 finally{busy=false;el('idx-next').disabled=false;el('idx-batch').disabled=false;await load();}
}

async function process(id){
 if(busy)return;
 busy=true;el('idx-next').disabled=true;status('Processando documento. Aguarde...');
 try{
  const {data,error}=await db.functions.invoke('sigem-indexar-documento',{body:id?{id}:{}});
  if(error){let detail=error.message;try{const body=await error.context?.json();detail=body?.error||body?.message||detail;}catch{}throw Error(detail);}
  if(data?.status==='falhou'&&/OCR necessário|sem camada textual/i.test(data.erro||'')){
   const result=await window.sigemOcrDocumento(id||data.id,status);
   status(result?.status==='concluido'?'OCR concluído: '+result.trechos+' trechos.':'OCR pendente.');
   return;
  }
  status(data?.status==='concluido'?'Documento indexado: '+data.trechos+' trechos.':data?.status==='falhou'?'Processamento não concluído: '+data.erro:data?.status==='sem_pendencias'?'Não há documentos pendentes.':'Resultado: '+(data?.status||'indisponível'));
 }catch(e){status('Falha ao chamar o processador: '+(e.message||e));}
 finally{busy=false;el('idx-next').disabled=false;await load();}
}
async function search(){
 const term=el('idx-query').value.trim();if(!term){status('Digite um termo para pesquisar.');return;}
 if(term.length>120){status('Use uma consulta com até 120 caracteres.');return;}
 status('Pesquisando...');el('idx-results').textContent='';
 const {data,error}=await db.from('documento_trechos').select('indexacao_id,pagina,aba,conteudo').eq('obra_id',selectedWork.id).textSearch('busca',term,{type:'websearch',config:'portuguese'}).limit(30);
 if(error){status('Pesquisa indisponível: '+error.message);return;}
 const byId=new Map(records.map(r=>[r.id,r]));
 el('idx-results').innerHTML=(data||[]).length?data.map(t=>'<article class="idx-result"><strong>'+escape(byId.get(t.indexacao_id)?.nome_arquivo||'Documento')+'</strong><small>'+(t.pagina?'Página '+t.pagina:t.aba?'Aba '+escape(t.aba):'Referência documental')+'</small><p>'+escape(t.conteudo.slice(0,700))+'</p></article>').join(''):'Nenhum trecho encontrado nos documentos já indexados.';
 status((data||[]).length+' resultado(s). Somente documentos já processados participam da pesquisa.');
}

async function verificarTravados(){
 if(watchdogBusy||!selectedWork?.id)return false;
 watchdogBusy=true;
 try{
  const {data,error}=await db.functions.invoke('sigem-indexar-documento',{body:{action:'parar_travado',obra_id:selectedWork.id}});
  if(error)throw error;
  if(data?.interrompidos?.length){
   batchStop=true;
   await load();
   status('Processamento interrompido: '+data.interrompidos.join(', ')+'. O conteúdo parcial foi removido. Clique em "Processar pendentes em lote" novamente para continuar os demais arquivos.');
   return true;
  }
  return false;
 }catch(e){console.warn('Verificação de documentos travados:',e);return false;}
 finally{watchdogBusy=false;}
}
setInterval(()=>{if(selectedWork?.id)verificarTravados();},30000);

async function batch(){
 if(busy||batchRunning||!selectedWork?.id)return;
 batchRunning=true;batchStop=false;
 const obra=selectedWork.id;
 el('idx-batch').disabled=true;
 el('idx-pause').disabled=false;
 el('idx-next').disabled=true;
 let completed=0,failed=0;
 try{
  await verificarTravados();
  if(batchStop)return;
  await load();
  const pending=records.filter(r=>r.status==='pendente');
  const total=pending.length;
  for(let i=0;i<pending.length;i++){
   if(batchStop||selectedWork?.id!==obra)break;
   const item=pending[i];
   status('Processamento em lote: '+(i+1)+' de '+total+' — '+item.nome_arquivo+' (concluídos: '+completed+', falhas: '+failed+').');
   try{
    const {data,error}=await db.functions.invoke('sigem-indexar-documento',{body:{id:item.id}});
    if(error){let message=error.message;try{message=(await error.context?.json())?.error||message;}catch{}throw Error(message);}
    if(data?.status==='concluido')completed++;
    else if(data?.status==='falhou'){
     if(/OCR necessário|sem camada textual/i.test(data.erro||'')){
      try{const ocr=await window.sigemOcrDocumento(item.id,status);if(ocr?.status==='concluido')completed++;else failed++;}
      catch(e){failed++;console.warn('OCR pendente:',item.nome_arquivo,e);}
     }else failed++;
    }
   }catch(e){
    failed++;
    console.warn('Falha no lote:',item.nome_arquivo,e);
    status('Falha de comunicação ao processar '+item.nome_arquivo+': '+e.message+'. Lote interrompido para evitar repetições.');
    break;
   }
   await load();
   if(await verificarTravados())break;
  }
  if(!batchStop)status('Lote '+(batchStop?'pausado':'finalizado/interrompido')+': '+completed+' concluído(s), '+failed+' falha(s). Documentos pendentes permanecem na fila.');
 }finally{
  batchRunning=false;el('idx-batch').disabled=false;el('idx-pause').disabled=true;el('idx-next').disabled=false;await load();
 }
}
el('idx-batch').addEventListener('click',batch);
el('idx-pause').addEventListener('click',()=>{batchStop=true;status('Pausa solicitada. O documento atual terminará antes da interrupção.');});

window.sigemIndexarNovoArquivo=async function(table,obra){
 try{
  const {data:jobs,error}=await db.from('documento_indexacao').select('id').eq('obra_id',obra).eq('origem_tabela',table).eq('status','pendente').order('criado_em',{ascending:false}).limit(1);
  if(error||!jobs?.length)return;
  const id=jobs[0].id;
  const {data:result,error:callError}=await db.functions.invoke('sigem-indexar-documento',{body:{id}});
  if(callError){console.warn('Indexação pendente para processamento:',callError.message);return;}
  if(result?.status==='falhou'&&/OCR necessário|sem camada textual/i.test(result.erro||'')){
   try{await window.sigemOcrDocumento(id,()=>{});}catch(e){console.warn('OCR pendente:',e);}
  }else if(result?.status==='falhou')console.warn('Indexação falhou:',result.erro);
 }catch(e){console.warn('Indexação pendente:',e);}
};
async function limparBibliotecas(){
 if(busy||batchRunning||!selectedWork?.id)return;
 if(!confirm('ATENÇÃO: excluir definitivamente todos os documentos das seis bibliotecas desta obra, inclusive arquivos sem registro? A capa e os cadastros administrativos serão preservados.'))return;
 busy=true;el('idx-clean').disabled=true;el('idx-next').disabled=true;
 const obra=selectedWork.id;
 const buckets=['documentos-obras','projetos-spobras','medicoes-obras','criterios-medicao-obras','aditamentos-obras','prateleiras-obras'];
 try{
  let total=0;
  for(const bucket of buckets){
   status('Excluindo arquivos: '+bucket+'...');
   const {data,error}=await db.functions.invoke('sigem-limpar-bibliotecas',{body:{obra_id:obra,bucket}});
   if(error){let detail=error.message;try{detail=(await error.context?.json())?.error||detail;}catch{}throw Error(detail);}
   total+=data?.removed||0;
  }
  status('Arquivos removidos. Limpando cadastros e índices...');
  const {error}=await db.functions.invoke('sigem-limpar-bibliotecas',{body:{obra_id:obra,finalizar:true}});
  if(error){let detail=error.message;try{detail=(await error.context?.json())?.error||detail;}catch{}throw Error(detail);}
  status('Limpeza concluída: '+total+' arquivo(s) removido(s), registros e índices eliminados. A capa foi preservada.');
  await load();
 }catch(e){status('Limpeza interrompida: '+e.message+'. Não inicie novos uploads antes de concluir a limpeza.');}
 finally{busy=false;el('idx-clean').disabled=false;el('idx-next').disabled=false;}
}
el('idx-clean')?.addEventListener('click',limparBibliotecas);

window.indexacaoLoad=()=>{status('');el('idx-results').textContent='';load().then(verificarTravados);};
el('idx-refresh').addEventListener('click',async()=>{await load(true);await verificarTravados();});
el('idx-next').addEventListener('click',()=>process(null));
el('idx-find').addEventListener('click',search);
el('idx-query').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
})();