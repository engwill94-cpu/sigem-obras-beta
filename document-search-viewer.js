'use strict';
/* Visualizador documental SIGEM: resultados por arquivo, ocorrências e navegação. */
(function(){
const el=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,ocrWorkerPromise=null;
async function ocrWorker(){if(!ocrWorkerPromise)ocrWorkerPromise=Tesseract.createWorker('por').catch(e=>{ocrWorkerPromise=null;throw e;});return ocrWorkerPromise;}
function ocrWords(data){if(Array.isArray(data.words)&&data.words.length)return data.words.map(w=>({text:w.text||'',box:w.bbox})).filter(w=>w.box);if(data.tsv){return data.tsv.split(/\r?\n/).slice(1).map(line=>{const c=line.split('\t');return c.length>=12&&c[0]==='5'&&c[11]?.trim()?{text:c.slice(11).join('\t'),box:{x0:+c[6],y0:+c[7],x1:+c[6]+ +c[8],y1:+c[7]+ +c[9]}}:null;}).filter(Boolean);}return [];}

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
 ensure();close();const token={doc,q,hits:[],index:0,pdf:null,url:null,ocrCache:new Map(),renderId:0,workbook:null,sheetCache:new Map()};state=token;
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
  if(ext==='xls'||ext==='xlsx'||ext==='xlsm'){
   if(!window.XLSX)throw Error('Leitor Excel indisponível.');
   el('idx-view-body').textContent='Carregando planilha original. Arquivos grandes podem demorar...';
   const {data:file,error:downloadError}=await db.storage.from(source.storage_bucket).download(source.storage_path);
   if(downloadError)throw downloadError;
   const buffer=await file.arrayBuffer();if(state!==token)return;
   token.workbook=XLSX.read(buffer,{type:'array',cellStyles:true,cellDates:true,cellFormula:true});
  }
  if(state!==token)return;
  updateNav();await render();
 }catch(e){if(state===token)el('idx-view-body').textContent='Não foi possível abrir o documento: '+e.message;}
}
async function move(delta){if(!state||!state.hits.length)return;state.index=(state.index+delta+state.hits.length)%state.hits.length;updateNav();await render();}
function excelCellText(c){if(!c)return '';if(c.w!=null)return String(c.w);if(c.v!=null)return String(c.v);return '';}
function excelStyle(c){
 const style=[];const z=c?.s;if(!z||typeof z!=='object')return '';
 const color=x=>x?.rgb&&/^[A-Fa-f0-9]{6,8}$/.test(x.rgb)?'#'+x.rgb.slice(-6):null;
 const fill=color(z.fgColor||z.bgColor);if(fill)style.push('background-color:'+fill);
 const font=z.font;if(font){if(font.bold)style.push('font-weight:bold');if(font.italic)style.push('font-style:italic');const fc=color(font.color);if(fc)style.push('color:'+fc);if(font.sz&&font.sz>=7&&font.sz<=30)style.push('font-size:'+font.sz+'pt');}
 if(z.alignment?.horizontal&&['left','right','center'].includes(z.alignment.horizontal))style.push('text-align:'+z.alignment.horizontal);
 return style.join(';');
}
function excelRender(s,hit,body){
 const wb=s.workbook,row=hit.row,name=row.aba;
 const sheet=wb.Sheets[name];
 if(!sheet){body.textContent='Aba '+name+' não encontrada no arquivo original.';return;}
 const ref=sheet['!ref'];if(!ref){body.textContent='Aba vazia.';return;}
 const range=XLSX.utils.decode_range(ref),maxCol=Math.min(range.e.c,250),maxRow=range.e.r;
 let target=null;const hinted=row.celula_inicio;
 if(hinted&&/^[A-Z]+\d+$/i.test(hinted)){const pos=XLSX.utils.decode_cell(hinted.toUpperCase());if(matches(excelCellText(sheet[hinted.toUpperCase()]),s.q).length)target=pos;}
 if(!target){
  const candidates=[];
  for(let r=range.s.r;r<=maxRow;r++){
   for(let c=range.s.c;c<=maxCol;c++){
    const cell=sheet[XLSX.utils.encode_cell({r,c})];
    if(matches(excelCellText(cell),s.q).length)candidates.push({r,c});
   }
   if(candidates.length>2000)break;
  }
  const pageHits=s.hits.filter(h=>h.row.aba===name);
  const ordinal=Math.max(0,pageHits.findIndex(h=>h===hit));
  target=candidates[Math.min(ordinal,candidates.length-1)]||null;
 }
 const center=target?.r??Math.min(range.s.r,maxRow),startRow=Math.max(range.s.r,center-25),endRow=Math.min(maxRow,center+35);
 const startCol=range.s.c,endCol=Math.min(maxCol,Math.max(startCol+14,target?.c??startCol+14));
 const panel=document.createElement('div');panel.className='idx-sheet-panel';
 const header=document.createElement('div');header.className='idx-sheet-info';
 header.textContent='Aba: '+name+' · Linhas '+(startRow+1)+'–'+(endRow+1)+' de '+(maxRow+1)+(target?' · Destaque na célula '+XLSX.utils.encode_cell(target):' · Termo não localizado diretamente nas células');
 panel.appendChild(header);
 const scroller=document.createElement('div');scroller.className='idx-sheet-scroll';
 const table=document.createElement('table');table.className='idx-sheet-table';
 const colgroup=document.createElement('colgroup');const col0=document.createElement('col');col0.style.width='48px';colgroup.appendChild(col0);
 for(let c=startCol;c<=endCol;c++){const col=document.createElement('col');const w=sheet['!cols']?.[c];col.style.width=Math.max(55,Math.min(430,Math.round((w?.wpx||((w?.wch||12)*7+8)))))+'px';colgroup.appendChild(col);}table.appendChild(colgroup);
 const head=document.createElement('thead'),hr=document.createElement('tr');hr.appendChild(document.createElement('th'));
 for(let c=startCol;c<=endCol;c++){const th=document.createElement('th');th.textContent=XLSX.utils.encode_col(c);hr.appendChild(th);}head.appendChild(hr);table.appendChild(head);
 const tbody=document.createElement('tbody');
 const merged=sheet['!merges']||[],covered=new Set(),merges=new Map();
 for(const m of merged){if(m.s.r<startRow||m.e.r>endRow||m.s.c<startCol||m.e.c>endCol)continue;merges.set(m.s.r+':'+m.s.c,m);for(let rr=m.s.r;rr<=m.e.r;rr++)for(let cc=m.s.c;cc<=m.e.c;cc++)if(rr!==m.s.r||cc!==m.s.c)covered.add(rr+':'+cc);}
 for(let r=startRow;r<=endRow;r++){
  const tr=document.createElement('tr'),rh=document.createElement('th');rh.textContent=r+1;tr.appendChild(rh);
  const h=sheet['!rows']?.[r];if(h?.hpx)tr.style.height=Math.max(17,Math.min(130,h.hpx))+'px';
  for(let c=startCol;c<=endCol;c++){
   if(covered.has(r+':'+c))continue;
   const td=document.createElement('td'),addr=XLSX.utils.encode_cell({r,c}),cell=sheet[addr],merge=merges.get(r+':'+c);
   if(merge){td.rowSpan=merge.e.r-merge.s.r+1;td.colSpan=merge.e.c-merge.s.c+1;}
   const value=excelCellText(cell);td.innerHTML=highlighted(value,s.q);
   const style=excelStyle(cell);if(style)td.setAttribute('style',style);
   if(target&&r===target.r&&c===target.c){td.classList.add('idx-sheet-selected');td.id='idx-sheet-focus';}
   td.title=addr;tr.appendChild(td);
  }tbody.appendChild(tr);
 }
 table.appendChild(tbody);scroller.appendChild(table);panel.appendChild(scroller);body.appendChild(panel);
 const focus=panel.querySelector('#idx-sheet-focus');if(focus)focus.scrollIntoView({block:'center',inline:'center'});
 const note=document.createElement('p');note.className='idx-sheet-note';note.textContent='Pré-visualização da planilha original com formatação parcial. Exibindo uma região da aba para manter a navegação rápida; gráficos e imagens incorporados não são reproduzidos nesta versão.';body.appendChild(note);
}
async function render(){
 const s=state;if(!s)return;const renderId=++s.renderId;const body=el('idx-view-body');body.textContent='';
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
  const text=await page.getTextContent();if(state!==s||renderId!==s.renderId)return;
  const items=text.items.filter(item=>item.str&&item.str.trim());
  const searchable=items.map(item=>item.str).join(' ');
  const hasNativeMatch=matches(searchable,s.q).length>0;
  if(hasNativeMatch){
   for(const item of items){
    const tr=pdfjsLib.Util.transform(viewport.transform,item.transform);
    const span=document.createElement('span');span.className='idx-pdf-text';
    span.style.left=tr[4]+'px';span.style.top=(tr[5]-Math.hypot(tr[2],tr[3]))+'px';
    span.style.fontSize=Math.hypot(tr[2],tr[3])+'px';span.textContent=item.str;
    if(matches(item.str,s.q).length){span.innerHTML=highlighted(item.str,s.q,true);span.classList.add('idx-pdf-hit');}
    layer.appendChild(span);
   }
  }else{
   const notice=document.createElement('div');notice.className='idx-ocr-notice';notice.textContent='Página sem texto pesquisável correspondente. Localizando a palavra na imagem por OCR...';body.appendChild(notice);
   try{
    let words=s.ocrCache.get(row.pagina);
    if(!words){
     if(!window.Tesseract)throw Error('Motor OCR indisponível');
     const worker=await ocrWorker();
     const result=await worker.recognize(canvas,{}, {text:true,tsv:true});
     words=ocrWords(result.data);
     s.ocrCache.set(row.pagina,words);
    }
    if(state!==s||renderId!==s.renderId)return;
    notice.remove();
    const selectedWords=words.filter(w=>matches(w.text,s.q).length);
    for(const w of selectedWords){
     const span=document.createElement('span');span.className='idx-ocr-box';
     span.style.left=w.box.x0+'px';span.style.top=w.box.y0+'px';
     span.style.width=Math.max(2,w.box.x1-w.box.x0)+'px';
     span.style.height=Math.max(3,w.box.y1-w.box.y0)+'px';
     layer.appendChild(span);
    }
    const pageHits=s.hits.filter(h=>h.row.pagina===row.pagina);
    const ordinal=Math.max(0,pageHits.findIndex(h=>h===hit));
    const active=selectedWords[Math.min(ordinal,selectedWords.length-1)];
    if(active&&layer.children.length){
     const target=layer.children[Math.min(ordinal,layer.children.length-1)];
     target.classList.add('idx-ocr-box-active');
     target.scrollIntoView({block:'center',behavior:'smooth'});
    }else{
     const note=document.createElement('div');note.className='idx-ocr-notice';
     note.textContent='O OCR indexado encontrou o termo, mas não foi possível determinar sua posição nesta imagem. Confira o trecho destacado abaixo.';
     body.appendChild(note);
    }
   }catch(e){if(state!==s||renderId!==s.renderId)return;notice.textContent='Não foi possível localizar visualmente o termo nesta página: '+e.message+'. Consulte o trecho indexado abaixo.';}
  }
  const excerpt=document.createElement('div');excerpt.className='idx-view-excerpt';excerpt.innerHTML='<strong>Trecho indexado · página '+row.pagina+'</strong><p>'+highlighted(row.conteudo,s.q,true)+'</p>';body.appendChild(excerpt);
  if(hasNativeMatch){
   const marked=[...layer.querySelectorAll('mark')];
   const pageHits=s.hits.filter(h=>h.row.pagina===row.pagina);
   const ordinal=pageHits.findIndex(h=>h===hit);
   const mark=marked[Math.min(Math.max(0,ordinal),Math.max(0,marked.length-1))];
   if(mark){layer.querySelectorAll('mark').forEach(m=>m.classList.remove('idx-mark-active'));mark.classList.add('idx-mark-active');mark.scrollIntoView({block:'center',behavior:'smooth'});}
  }
 }else if(s.workbook){
  excelRender(s,hit,body);
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