'use strict';
(function(){
const el=id=>document.getElementById(id);
const isExcel=r=>/\.(xls|xlsx|xlsm)$/i.test(r.nome_arquivo||'');
const names={documentos:'Documentos',projetos_spobras:'Projetos SPOBRAS',medicoes_arquivos:'Medições',criterios_medicao_arquivos:'Critérios de medição',aditamentos_arquivos:'Aditamento',prateleiras_arquivos:'Prateleiras'};
let records=[],busy=false,batchRunning=false,batchStop=false,watchdogBusy=false;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message){el('idx-status').textContent=message||'';}
async function load(showFeedback=false){
 if(!selectedWork?.id||!db)return;
 const {data,error}=await db.from('documento_indexacao').select('id,origem_tabela,nome_arquivo,status,total_paginas,total_trechos,checkpoint_unidade,checkpoint_total,erro').eq('obra_id',selectedWork.id).order('criado_em',{ascending:true});
 if(error){status('Não foi possível consultar a fila: '+error.message);return;}
 records=data||[];
 const counts={};for(const r of records)counts[r.status]=(counts[r.status]||0)+1;
 el('idx-counts').textContent=records.length+' arquivo(s) · '+(counts.concluido||0)+' concluído(s) · '+(counts.pendente||0)+' pendente(s) · '+(counts.falhou||0)+' falha(s) · '+(counts.processando||0)+' processando';
 if(showFeedback)status('Situação atualizada às '+new Date().toLocaleTimeString('pt-BR')+'.');
 el('idx-list').innerHTML=records.length?records.map(r=>'<div class="idx-item"><div><strong>'+escape(r.nome_arquivo)+'</strong><small>'+escape(names[r.origem_tabela]||r.origem_tabela)+' · '+escape(r.status)+(r.total_paginas?' · '+r.total_paginas+(isExcel(r)?' aba(s)':' página(s)'):'')+(r.total_trechos?' · '+r.total_trechos+' trecho(s)':'')+(r.checkpoint_total?' · '+r.checkpoint_unidade+'/'+r.checkpoint_total+' '+(isExcel(r)?'abas':'páginas'):'')+'</small>'+(r.erro?'<small class="idx-error">'+escape(r.erro)+'</small>':'')+'</div>'+(r.status==='pendente'?'<button type="button" data-index-id="'+escape(r.id)+'">Processar</button>':r.status==='falhou'?'<button type="button" data-ocr-id="'+escape(r.id)+'">Reprocessar</button>':'')+'</div>').join(''):'Nenhum documento cadastrado na fila desta obra.';
 el('idx-list').querySelectorAll('[data-index-id]').forEach(b=>b.addEventListener('click',()=>process(b.dataset.indexId)));
 el('idx-list').querySelectorAll('[data-ocr-id]').forEach(b=>b.addEventListener('click',()=>aplicarOcr(b.dataset.ocrId)));
}
async function aplicarOcr(id){
 if(busy||batchRunning)return;
 busy=true;el('idx-next').disabled=true;el('idx-batch').disabled=true;
 try{
  const result=await window.sigemProcessarArquivoGrande(id,status);
  status(result?.status==='concluido'?'Indexação concluída: '+result.trechos+' trechos pesquisáveis.':'Indexação não concluída: '+(result?.status||'indisponível'));
 }catch(e){status('Indexação interrompida: '+(e.message||e)+'. Se houver checkpoint, clique em Reprocessar para continuar do último ponto confirmado.');}
 finally{busy=false;el('idx-next').disabled=false;el('idx-batch').disabled=false;await load();}
}

async function process(id){
 if(busy)return;
 busy=true;el('idx-next').disabled=true;status('Processando documento. Aguarde...');
 try{
  if(id){const result=await window.sigemProcessarArquivoGrande(id,status);status('Documento indexado: '+result.trechos+' trechos.');return;}
  const {data,error}=await db.functions.invoke('sigem-indexar-documento',{body:{}});
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
 const term=el('idx-query').value.trim();
 if(!term){status('Digite um termo para pesquisar.');return;}
 if(term.length>120){status('Use uma consulta com até 120 caracteres.');return;}
 if(!selectedWork?.id){status('Selecione uma obra.');return;}
 try{await window.sigemPesquisaDocumental.list(term,records,status);}
 catch(e){status('Pesquisa indisponível: '+e.message);}
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
   status('Processamento interrompido: '+data.interrompidos.join(', ')+'. Os checkpoints confirmados foram preservados quando disponíveis. Clique em "Processar pendentes em lote" novamente para continuar os demais arquivos.');
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
    const data=await window.sigemProcessarArquivoGrande(item.id,status);
    if(data?.status==='concluido')completed++;
    else failed++;
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
  await window.sigemProcessarArquivoGrande(jobs[0].id,()=>{});
 }catch(e){console.warn('Indexação pendente ou com falha:',e);}
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