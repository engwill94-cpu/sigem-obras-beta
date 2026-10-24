'use strict';
(function(){
const el=id=>document.getElementById(id);
const names={documentos:'Documentos',projetos_spobras:'Projetos SPOBRAS',medicoes_arquivos:'Medições',criterios_medicao_arquivos:'Critérios de medição',aditamentos_arquivos:'Aditamento',prateleiras_arquivos:'Prateleiras'};
let records=[],busy=false;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message){el('idx-status').textContent=message||'';}
async function load(){
 if(!selectedWork?.id||!db)return;
 const {data,error}=await db.from('documento_indexacao').select('id,origem_tabela,nome_arquivo,status,total_paginas,total_trechos,erro').eq('obra_id',selectedWork.id).order('criado_em',{ascending:true});
 if(error){status('Não foi possível consultar a fila: '+error.message);return;}
 records=data||[];
 const counts={};for(const r of records)counts[r.status]=(counts[r.status]||0)+1;
 el('idx-counts').textContent=records.length+' arquivo(s) · '+(counts.concluido||0)+' concluído(s) · '+(counts.pendente||0)+' pendente(s) · '+(counts.falhou||0)+' falha(s)';
 el('idx-list').innerHTML=records.length?records.map(r=>'<div class="idx-item"><div><strong>'+escape(r.nome_arquivo)+'</strong><small>'+escape(names[r.origem_tabela]||r.origem_tabela)+' · '+escape(r.status)+(r.total_paginas?' · '+r.total_paginas+' página(s)':'')+(r.total_trechos?' · '+r.total_trechos+' trecho(s)':'')+'</small>'+(r.erro?'<small class="idx-error">'+escape(r.erro)+'</small>':'')+'</div>'+(r.status==='pendente'?'<button type="button" data-index-id="'+escape(r.id)+'">Processar</button>':'')+'</div>').join(''):'Nenhum documento cadastrado na fila desta obra.';
 el('idx-list').querySelectorAll('[data-index-id]').forEach(b=>b.addEventListener('click',()=>process(b.dataset.indexId)));
}
async function process(id){
 if(busy)return;
 busy=true;el('idx-next').disabled=true;status('Processando documento. Aguarde...');
 try{
  const {data,error}=await db.functions.invoke('sigem-indexar-documento',{body:id?{id}:{}});
  if(error)throw error;
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
window.indexacaoLoad=()=>{status('');el('idx-results').textContent='';load();};
el('idx-refresh').addEventListener('click',load);
el('idx-next').addEventListener('click',()=>process(null));
el('idx-find').addEventListener('click',search);
el('idx-query').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
})();