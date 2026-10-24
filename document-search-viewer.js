'use strict';
/* Visualizador documental SIGEM: resultados por arquivo, ocorrências e navegação. */
(function(){
const el=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null;
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function matches(s,q){const hay=fold(s),needle=fold(q);if(!needle)return [];const out=[];let pos=0;while((pos=hay.indexOf(needle,pos))>=0){out.push(pos);pos+=Math.max(1,needle.length);}return out;}
function highlighted(s,q,selected=false){const hits=matches(s,q);if(!hits.length)return esc(s);let out='',pos=0;for(const n of hits){out+=esc(s.slice(pos,n))+'<mark class="'+(selected?'idx-mark-active':'')+'">'+esc(s.slice(n,n+q.length))+'</mark>';pos=n+q.length;}return out+esc(s.slice(pos));}
function ensure(){
 if(el('idx-viewer'))return;
 const div=document.createElement('div');div.id='idx-viewer';div.className='idx-viewer hidden';
 div.setAttribute('role','dialog');div.setAttribute('aria-modal','true');div.setAttribute('aria-label','Visualizador documental');
 div.innerHTML='<div class="idx-view-shell"><header class="idx-view-header"><strong id="idx-view-title"></strong><button type="button" id="idx-view-close" class="secondary">✕ Fechar</button></header><nav class="idx-view-nav"><button type="button" id="idx-view-prev" class="secondary">← Anterior</button><span id="idx-view-counter" aria-live="polite"></span><button type="button" id="idx-view-next" class="secondary">Próximo →</button><span id="idx-view-position"></span></nav><div id="idx-view-body" class="idx-view-body"></div></div>';
 document.body.appendChild(div);
 el('idx-view-close').onclick=close;
 el('idx-view-prev').onclick=()=>move(-1);
 el('idx-view-next').onclick=()=>move(1);
 div.addEventListener('click',e=>{if(e.target===div)close();});
 document.addEventListener('keydown',e=>{if(!state)return;if(e.key==='Escape')close();if(e.key==='F3'){e.preventDefault();move(e.shiftKey?-1:1);}});
}
function close(){if(state?.url)URL.revokeObjectURL(state.url);if(state?.pdf)state.pdf.destroy().catch(()=>{});state=null;el('idx-viewer')?.classList.add('hidden');}
function updateNav(){if(!state)return;const n=state.hits.length;el('idx-view-counter').textContent=n?(state.index+1)+' de '+n+' ocorrência(s)':'Nenhuma ocorrência';el('idx-view-prev').disabled=!n;el('idx-view-next').disabled=!n;}
async function fetchMatches(id,q){
 const rows=[];for(let from=0;from<20000;from+=500){
  const {data,error}=await db.from('documento_trechos').select('ordem,pagina,aba,celula_inicio,conteudo').eq('indexacao_id',id).textSearch('busca',q,{type:'websearch',config:'portuguese'}).order('ordem',{ascending:true}).range(from,from+499);
  if(error)throw error;rows.push(...(data||[]));if(!data||data.length<500)break;
 }return rows;
}
async function list(q,records,status){
 const result=el('idx-results');result.textContent='Pesquisando documentos...';
 const completed=records.filter(r=>r.status==='concluido');const map=new Map(completed.map(r=>[r.id,r]));
 const found=new Map();
 for(let offset=0;offset<20000;offset+=500){
  const {data,error}=await db.from('documento_trechos').select('indexacao_id,conteudo').eq('obra_id',selectedWork.id).textSearch('busca',q,{type:'websearch',config:'portuguese'}).range(offset,offset+499);
  if(error)throw error;
  for(const t of data||[]){if(!map.has(t.indexacao_id))continue;const item=found.get(t.indexacao_id)||{rows:0,occurrences:0};item.rows++;item.occurrences+=matches(t.conteudo,q).length;found.set(t.indexacao_id,item);}
  if(!data||data.length<500)break;
 }
 const docs=[...found].map(([id,counts])=>({...map.get(id),counts})).sort((a,b)=>a.nome_arquivo.localeCompare(b.nome_arquivo,'pt-BR'));
 result.innerHTML=docs.length?'<p class="idx-search-summary">'+docs.length+' arquivo(s) encontrado(s). Clique em um documento para visualizar e navegar pelos termos destacados.</p>'+docs.map(r=>'<div class="idx-doc-result"><button type="button" class="idx-doc-open" data-open-doc="'+esc(r.id)+'">'+esc(r.nome_arquivo)+'</button><small>'+esc(r.origem_tabela)+' · '+r.counts.rows+' trecho(s) localizado(s)'+(r.counts.occurrences?' · '+r.counts.occurrences+' ocorrência(s) textuais':'')+'</small></div>').join(''):'Nenhum documento concluído contém o termo pesquisado.';
 result.querySelectorAll('[data-open-doc]').forEach(btn=>btn.onclick=()=>open(map.get(btn.dataset.openDoc),q));
 status(docs.length+' documento(s) encontrado(s).');
}
async function open(doc,q){
 ensure();close();const token={doc,q,hits:[],index:0,pdf:null,url:null};state=token;
 el('idx-viewer').classList.remove('hidden');el('idx-view-title').textContent=doc.nome_arquivo;
 el('idx-view-body').textContent='Localizando ocorrências no documento...';updateNav();
 try{
  const rows=await fetchMatches(doc.id,q);if(state!==token)return;
  token.rows=rows;
  for(const row of rows){for(const pos of matches(row.conteudo,q))token.hits.push({row,pos});}
  // Em buscas por palavras flexionadas, preservar ao menos a navegação pelos trechos retornados pelo índice.
  if(!token.hits.length)for(const row of rows)token.hits.push({row,pos:-1});
  const {data:source,error}=await db.from('documento_indexacao').select('storage_bucket,storage_path').eq('id',doc.id).single();
  if(error)throw error;
  const ext=doc.nome_arquivo.split('.').pop().toLowerCase();token.ext=ext;
  if(ext==='pdf'){
   el('idx-view-body').textContent='Abrindo PDF original...';
   const {data:file,error:downloadError}=await db.storage.from(source.storage_bucket).download(source.storage_path);
   if(downloadError)throw downloadError;
   token.url=URL.createObjectURL(file);
   if(!window.pdfjsLib)throw Error('Leitor de PDF indisponível.');
   token.pdf=await pdfjsLib.getDocument({url:token.url}).promise;
  }
  if(state!==token)return;
  updateNav();await render();
 }catch(e){if(state===token)el('idx-view-body').textContent='Não foi possível abrir o documento: '+e.message;}
}
async function move(delta){if(!state||!state.hits.length)return;state.index=(state.index+delta+state.hits.length)%state.hits.length;updateNav();await render();}
async function render(){
 const s=state;if(!s)return;const body=el('idx-view-body');body.textContent='';
 const hit=s.hits[s.index];if(!hit){body.textContent='Nenhum trecho correspondente foi encontrado.';return;}
 const row=hit.row;
 el('idx-view-position').textContent=s.ext==='pdf'?'Página '+row.pagina:'Aba '+row.aba+(row.celula_inicio?' · '+row.celula_inicio:'');
 if(s.ext==='pdf'&&s.pdf){
  const page=await s.pdf.getPage(row.pagina||1);if(state!==s)return;
  const viewport=page.getViewport({scale:1.25});
  const wrap=document.createElement('div');wrap.className='idx-pdf-page';
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);wrap.appendChild(canvas);body.appendChild(wrap);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;if(state!==s)return;
  const layer=document.createElement('div');layer.className='idx-pdf-textlayer';layer.style.width=viewport.width+'px';layer.style.height=viewport.height+'px';wrap.appendChild(layer);
  const text=await page.getTextContent();
  for(const item of text.items){if(!item.str)continue;const tr=pdfjsLib.Util.transform(viewport.transform,item.transform);const span=document.createElement('span');span.className='idx-pdf-text';span.style.left=tr[4]+'px';span.style.top=(tr[5]-Math.hypot(tr[2],tr[3]))+'px';span.style.fontSize=Math.hypot(tr[2],tr[3])+'px';span.textContent=item.str;const has=matches(item.str,s.q).length;if(has){span.innerHTML=highlighted(item.str,s.q,true);span.classList.add('idx-pdf-hit');}layer.appendChild(span);}
  const excerpt=document.createElement('div');excerpt.className='idx-view-excerpt';excerpt.innerHTML='<strong>Trecho indexado · página '+row.pagina+'</strong><p>'+highlighted(row.conteudo,s.q,true)+'</p>';body.appendChild(excerpt);
  const mark=layer.querySelector('mark');if(mark)mark.scrollIntoView({block:'center',behavior:'smooth'});
 }else{
  const card=document.createElement('article');card.className='idx-excel-hit';
  card.innerHTML='<strong>Aba: '+esc(row.aba||'Não identificada')+' · Célula: '+esc(row.celula_inicio||'—')+'</strong><p>'+highlighted(row.conteudo,s.q,true)+'</p>';
  body.appendChild(card);
  const nearby=s.rows.filter(r=>r.aba===row.aba&&r.ordem!==row.ordem).slice(0,30);
  if(nearby.length){const heading=document.createElement('h4');heading.textContent='Outros registros encontrados nesta aba';body.appendChild(heading);for(const item of nearby){const p=document.createElement('p');p.className='idx-excel-row';p.innerHTML='<small>'+esc(item.celula_inicio||'')+'</small> '+highlighted(item.conteudo,s.q);body.appendChild(p);}}
 }
}
window.sigemPesquisaDocumental={list,close};
})();