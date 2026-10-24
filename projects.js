'use strict';
(function(){
 const DISC={A:'Arquitetura',B:'Serviços Iniciais, Estudos e Gestão de Contratos',C:'Estrutura de Concreto',D:'Desapropriação e Cadastro',E:'Sistemas Elétricos e Mecânicos',F:'Geometria',G:'Geologia e Geotecnia',H:'Hidrologia, Hidráulica e Drenagem',I:'Interferência e Cadastro',K:'Métodos Construtivos',L:'Paisagismo',M:'Estruturas Metálicas e de Madeira',N:'Meio Ambiente',O:'Comunicação Visual',P:'Pavimentação',Q:'Terraplanagem',S:'Sinalização e Desvio de Tráfego',T:'Topografia e Aerofotogrametria',U:'Urbanismo e Uso e Ocupação do Solo',V:'Vala Técnica e Projeto Aerodinâmico',W:'Conservação e Manutenção',X:'Impermeabilização'};
 const TYPES={DE:'Desenho Técnico',RT:'Relatório Técnico',MC:'Memória de Cálculo'};
 const PHASE={4:'Projeto Básico',5:'Projeto Executivo',6:'As Built'};
 const BUCKET='projetos-spobras', MAX=50*1024*1024;
 let records=[],loadedWork=null,request=0,visibleRows=[],zipBusy=false;
 const el=id=>document.getElementById(id);
 function message(s,warning=false){const n=el('sp-upload-notice');n.textContent=s;n.classList.toggle('sp-warning',warning);}
 function parse(name){
  const m=/^(DE|RT|MC)-(VM)-(TV)-(01)-([456])([A-Z])-(00)-([0-9]+)-([A-Z]|[1-9][0-9]*)\.(pdf|dwg|dxf)$/i.exec(name);
  if(!m)throw Error('NOMENCLATURA INVÁLIDA — arquivo bloqueado e não enviado: '+name+'. Padrão obrigatório: DE, RT ou MC-VM-TV-01-5A-00-104-1.pdf (ou DWG/DXF).');
  const disc=m[6].toUpperCase(),phase=Number(m[5]),ext=m[10].toLowerCase(),rev=m[9].toUpperCase(),sheet=m[8];
  if(!DISC[disc])throw Error('NOMENCLATURA INVÁLIDA — disciplina reservada ou inválida ('+disc+'). Arquivo bloqueado e não enviado: '+name);
  return {codigo_base:m[1].toUpperCase()+'-VM-TV-01-'+phase+disc+'-00',codigo_folha:m[1].toUpperCase()+'-VM-TV-01-'+phase+disc+'-00-'+sheet,fase:phase,disciplina:disc,folha:sheet,revisao:rev,formato:ext};
 }
 async function hash(file){
  if(!crypto?.subtle)throw Error('Navegador sem suporte a SHA-256 seguro.');
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 }
 function timeout(p,ms=35000){return Promise.race([Promise.resolve(p),new Promise((_,reject)=>setTimeout(()=>reject(Error('Tempo limite excedido.')),ms))]);}
 function make(tag,cls,content){const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;}
 function revisionRank(rev){
  if(/^[1-9][0-9]*$/.test(rev))return [1,Number(rev)];
  return [0,rev.toUpperCase().charCodeAt(0)];
 }
 function latestRows(rows){
  const latest=new Map();
  for(const record of rows){
   // Cada folha mantém uma revisão vigente por formato (PDF, DWG ou DXF).
   const key=record.codigo_folha+'|'+record.formato;
   const previous=latest.get(key);
   if(!previous){latest.set(key,record);continue;}
   const currentRank=revisionRank(record.revisao),oldRank=revisionRank(previous.revisao);
   if(currentRank[0]>oldRank[0]||(currentRank[0]===oldRank[0]&&currentRank[1]>oldRank[1]))latest.set(key,record);
  }
  return [...latest.values()];
 }
 function render(){
  const list=el('sp-discipline-list'),filter=el('sp-filter');
  if(!list||!filter)return;
  const active=filter.value;
  const onlyLatest=!!el('sp-latest-only')?.checked;
  const available=new Set(records.map(r=>r.disciplina));
  filter.replaceChildren(new Option('Selecione uma disciplina',''));
  for(const [code,name] of Object.entries(DISC)){
   if(available.has(code))filter.add(new Option(code+' — '+name,code));
  }
  filter.value=available.has(active)?active:'';
  el('sp-discipline-count').textContent=new Set(records.map(r=>r.disciplina)).size;
  el('sp-pdf-count').textContent=records.filter(r=>r.formato==='pdf').length;
  el('sp-cad-count').textContent=records.filter(r=>r.formato!=='pdf').length;
  list.replaceChildren();
  visibleRows=[];
  const zipButton=el('sp-download-all');if(zipButton){zipButton.disabled=true;zipButton.hidden=true;}
  if(!filter.value){list.append(make('p','sp-library-footnote','Selecione uma disciplina para consultar os arquivos cadastrados.'));return;}
  let rows=records.filter(r=>r.disciplina===filter.value);
  if(onlyLatest)rows=latestRows(rows);
  
  rows.sort((a,b)=>a.codigo_folha.localeCompare(b.codigo_folha,'pt-BR',{numeric:true})||revisionRank(b.revisao)[0]-revisionRank(a.revisao)[0]||revisionRank(b.revisao)[1]-revisionRank(a.revisao)[1]);
  if(!rows.length){list.append(make('p','sp-library-footnote','Nenhum projeto encontrado para esta disciplina e filtros.'));return;}
  visibleRows=rows.slice();
  if(zipButton){zipButton.hidden=false;zipButton.disabled=zipBusy;zipButton.textContent=zipBusy?'Preparando ZIP...':'↓ Baixar todos (.zip)';}
  list.append(make('p','sp-library-result',rows.length+' arquivo(s) · '+active+' — '+DISC[active]));
  for(const [format,label] of [['pdf','Arquivos PDF'],['cad','Arquivos DWG / DXF']]){
   const group=rows.filter(r=>format==='pdf'?r.formato==='pdf':r.formato!=='pdf');
   if(!group.length)continue;
   const section=make('div','sp-format sp-result-section');
   section.append(make('strong','',label+' ('+group.length+')'));
   for(const record of group){
    const row=make('div','sp-project-row'),info=make('div','sp-project-name'),actions=make('div','sp-project-actions');
    info.append(make('strong','',record.nome_arquivo),make('small','',(TYPES[record.codigo_folha.slice(0,2)]||'Documento técnico')+' · '+PHASE[record.fase]+' · Folha '+record.folha+' · Rev. '+record.revisao));
    if(record.formato==='pdf'){
     const view=make('button','','◉ Visualizar');view.type='button';view.addEventListener('click',()=>openPdf(record));actions.append(view);
    }
    const download=make('button','','↓ Download');download.type='button';download.addEventListener('click',()=>downloadFile(record));actions.append(download);
    row.append(info,actions);section.append(row);
   }
   list.append(section);
  }
 }
 async function load(){
  if(!db||!selectedWork)return;
  const obra=selectedWork.id,seq=++request;
  loadedWork=obra;el('sp-discipline-list').textContent='Carregando projetos...';
  const {data,error}=await db.from('projetos_spobras').select('id,obra_id,codigo_folha,fase,disciplina,folha,revisao,formato,nome_arquivo,storage_path,checksum_sha256,created_at').eq('obra_id',obra).order('created_at',{ascending:false});
  if(seq!==request||selectedWork?.id!==obra)return;
  if(error){message('Não foi possível consultar projetos: '+error.message);return;}
  records=data||[];render();
 }
 window.spobrasLoad=load;
 async function openPdf(record){
  const w=window.open('','_blank');
  if(!w){message('O navegador bloqueou a nova aba.');return;}
  w.document.body.textContent='Abrindo PDF...';
  try{
   const {data,error}=await db.storage.from(BUCKET).createSignedUrl(record.storage_path,600);
   if(error)throw error;
   w.location.replace(data.signedUrl);
  }catch(e){w.document.body.textContent='Falha ao abrir PDF: '+e.message;}
 }
 async function downloadFile(record){
  try{
   const {data,error}=await db.storage.from(BUCKET).download(record.storage_path);
   if(error)throw error;
   const url=URL.createObjectURL(data),a=document.createElement('a');
   a.href=url;a.download=record.nome_arquivo;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){message('Falha ao baixar '+record.nome_arquivo+': '+e.message);}
 }
 async function downloadAllVisible(){
  if(zipBusy||!visibleRows.length)return;
  const btn=el('sp-download-all'),notice=el('sp-zip-notice');
  if(typeof JSZip==='undefined'){notice.textContent='Gerador ZIP indisponível. Atualize a página.';return;}
  const selected=visibleRows.slice(),obra=selectedWork?.id,discipline=el('sp-filter')?.value;
  zipBusy=true;btn.disabled=true;btn.textContent='Preparando ZIP...';notice.textContent='Iniciando download de '+selected.length+' arquivo(s)...';
  try{
   const zip=new JSZip(),failures=[];
   for(let i=0;i<selected.length;i++){
    const record=selected[i];
    if(selectedWork?.id!==obra)throw Error('A obra selecionada foi alterada. Operação interrompida.');
    notice.textContent='Preparando ZIP: '+(i+1)+' de '+selected.length+' — '+record.nome_arquivo;
    try{
     const {data,error}=await timeout(db.storage.from(BUCKET).download(record.storage_path),90000);
     if(error)throw error;
     zip.file(record.nome_arquivo,data);
    }catch(error){failures.push(record.nome_arquivo+': '+error.message);}
   }
   if(failures.length)throw Error('Não foi possível baixar todos os arquivos. '+failures.length+' falha(s): '+failures.slice(0,3).join('; ')+'. Nenhum ZIP parcial foi gerado.');
   notice.textContent='Compactando '+selected.length+' arquivo(s)...';
   const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}},metadata=>{notice.textContent='Compactando: '+Math.round(metadata.percent)+'%';});
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download='SPOBRAS_'+discipline+'_'+(el('sp-latest-only')?.checked?'ultimas_revisoes':'todas_revisoes')+'.zip';
   document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   notice.textContent='ZIP gerado com '+selected.length+' arquivo(s).';
  }catch(error){notice.textContent='Falha ao gerar ZIP: '+error.message;}
  finally{zipBusy=false;btn.disabled=!visibleRows.length;btn.textContent='↓ Baixar todos (.zip)';}
 }
 el('sp-download-all')?.addEventListener('click',()=>downloadAllVisible());
 async function upload(){
  const btn=el('sp-upload-button'),files=Array.from(el('sp-files').files||[]);
  if(!selectedWork||!currentUser){message('Selecione uma obra e entre no sistema.');return;}
  if(!files.length){message('Selecione os arquivos para cadastro.');return;}
  const obra=selectedWork.id;let success=0,fail=0,rejected=[];
  btn.disabled=true;btn.textContent='Verificando arquivos...';
  try{
   for(const file of files){
    let path=null;
    try{
     if(!file.size||file.size>MAX)throw Error('Arquivo vazio ou maior que 50 MB.');
     message('Validando nomenclatura de '+file.name+'...');
     const parsed=parse(file.name);
     message('Verificando duplicidade de '+file.name+'...');
     const digest=await hash(file);
     const {data:matches,error:lookupError}=await timeout(db.from('projetos_spobras').select('id,nome_arquivo,codigo_folha,revisao,formato,checksum_sha256').eq('obra_id',obra).eq('checksum_sha256',digest).limit(1));
     if(lookupError)throw lookupError;
     if(matches?.length)throw Error('DUPLICADO: conteúdo digital idêntico ao arquivo '+matches[0].nome_arquivo+'. ⚠️⚠️⚠️');
     const {data:sheetRows,error:sheetError}=await timeout(db.from('projetos_spobras').select('nome_arquivo,revisao,formato,checksum_sha256').eq('obra_id',obra).eq('codigo_folha',parsed.codigo_folha));
     if(sheetError)throw sheetError;
     if(sheetRows.some(r=>r.revisao===parsed.revisao&&r.formato===parsed.formato))throw Error('DUPLICADO: mesma folha, revisão e formato já cadastrados. É necessária conferência gráfica antes de substituir. ⚠️⚠️⚠️');
     const related=sheetRows.filter(r=>r.formato===parsed.formato);
     // Revisões distintas permanecem cadastráveis; comparação gráfica avançada ainda não disponível.
     path=obra+'/'+crypto.randomUUID()+'/'+file.name;
     const mime=parsed.formato==='pdf'?'application/pdf':'application/octet-stream';
     message('Enviando '+file.name+'...');
     const {error:uploadError}=await timeout(db.storage.from(BUCKET).upload(path,file,{contentType:mime,upsert:false}),60000);
     if(uploadError)throw uploadError;
     const {error:insertError}=await timeout(db.from('projetos_spobras').insert({...parsed,obra_id:obra,nome_arquivo:file.name,storage_path:path,checksum_sha256:digest,uploaded_by:currentUser.id}));
     if(insertError)throw insertError;
     window.sigemIndexarNovoArquivo?.('projetos_spobras',obra);
     path=null;success++;
    }catch(e){
     fail++;rejected.push(file.name);
     if(path)await db.storage.from(BUCKET).remove([path]).catch(()=>{});
    }
   }
  }finally{
   btn.disabled=false;btn.textContent='↑ Verificar e cadastrar projetos';
   el('sp-files').value='';
   if(selectedWork?.id===obra){try{await load();}catch(error){console.error('Falha ao atualizar biblioteca SPOBRAS',error);}}
   message(rejected.length?'Arquivos não enviados:\n'+rejected.join('\n'):success+' arquivo(s) cadastrado(s) com sucesso.',rejected.length>0);
  }
 }
 el('sp-upload-button')?.addEventListener('click',()=>{message('Iniciando verificação dos arquivos...');upload().catch(error=>{const btn=el('sp-upload-button');btn.disabled=false;btn.textContent='↑ Verificar e cadastrar projetos';message('Não foi possível concluir a verificação: '+(error?.message||String(error)),true);});});
 

 // LISTA MESTRA SPOBRAS — coluna A: código vigente; coluna J: Status.
 let masterBusy=false,masterPending=null;
 function masterCode(raw){
  const s=String(raw??'').trim().toUpperCase().replace(/\.(PDF|DWG|DXF)$/,'').replace(/\s+/g,'');
  const m=/^(DE|RT|MC)-VM-TV-01-([456])([A-Z])-00-([0-9]+)-([A-Z]|[1-9][0-9]*)$/.exec(s);
  if(!m||!DISC[m[3]])return null;
  return {sheet:m[1]+'-VM-TV-01-'+m[2]+m[3]+'-00-'+m[4],rev:m[5],code:s};
 }
 function masterPopup(show){el('sp-master-modal')?.classList.toggle('hidden',!show);}
 function masterNotice(text,isError=false){const n=el('sp-master-notice');if(n){n.textContent=text;n.classList.toggle('sp-warning',isError);}}
 function masterSection(title,items,describe){
  const wrap=make('section','sp-master-section'),head=make('h4','',title);wrap.append(head);
  if(!items.length){wrap.append(make('p','','Nenhuma ocorrência.'));return wrap;}
  const ul=make('ul','sp-master-items');
  for(const item of items){ul.append(make('li','',describe(item)));}
  wrap.append(ul);return wrap;
 }

 let masterReport=null,masterHistoryId=null;
 async function latestMasterHistory(){
  if(!selectedWork)throw Error('Selecione uma obra.');
  const {data,error}=await db.from('spobras_lista_mestra_historico').select('id,dados,importado_em,arquivo_nome,exclusao_confirmada_em,exclusao_resultado').eq('obra_id',selectedWork.id).order('importado_em',{ascending:false}).limit(1);
  if(error)throw error;
  return data?.[0]||null;
 }
 function showMasterReport(report,readOnly=false,history=null){
  masterReport=report;
  const body=el('sp-master-results');body.replaceChildren();
  const summary=make('div','sp-master-summary-grid');
  for(const [label,value] of [['Folhas analisadas',report.total],['Revisões obsoletas',report.obsolete.length],['Folhas ausentes',report.missing.length],['Folhas canceladas',report.cancelled.length]]){
   const card=make('div','sp-master-stat');card.append(make('strong','',String(value)),make('span','',label));summary.append(card);
  }
  body.append(make('p','sp-master-report-meta','Lista: '+report.file+' · Conferência: '+report.date),summary,
   masterTable('1. Revisões obsoletas',['Folha','No SIGEM','Vigente'],report.obsolete.map(x=>[x.entry.sheet,x.revisions.join(', '),x.entry.rev])),
   masterTable('2. Folhas não cadastradas',['Folha','Revisão vigente'],report.missing.map(x=>[x.sheet,x.rev])),
   masterTable('3. Projetos cancelados',['Folha','Arquivos','Revisões / Formatos'],report.cancelled.map(x=>[x.entry.sheet,x.files.length,[...new Set(x.files.map(f=>f.revisao+' / '+f.formato.toUpperCase()))].join(', ')])));
  if(readOnly){
   body.append(make('p','sp-master-note','Histórico da última importação. A consulta não executa exclusões.'));
   if(history?.exclusao_confirmada_em)body.append(make('p','sp-master-note','Exclusão confirmada em '+new Date(history.exclusao_confirmada_em).toLocaleString('pt-BR')+'. Arquivos removidos: '+(history.exclusao_resultado?.removed??0)+'.'));
   el('sp-master-ok').textContent='Fechar';
  }else{
   body.append(make('p',report.cancelled.length?'sp-master-alert':'sp-master-note',report.cancelled.length?'Ao clicar em OK, você autoriza a exclusão definitiva de '+report.cancelled.reduce((n,x)=>n+x.files.length,0)+' arquivo(s) das folhas canceladas acima.':'Nenhum projeto será excluído nesta importação.'));
   el('sp-master-ok').textContent='OK';
  }
  el('sp-master-download').disabled=false;el('sp-master-ok').disabled=false;
  masterPopup(true);
 }
 async function openLastMaster(){
  try{
   const history=await latestMasterHistory();
   if(!history){alert('Ainda não existe uma Lista Mestra salva para esta obra. Importe uma planilha para iniciar o histórico.');return;}
   masterPending=null;masterHistoryId=null;
   showMasterReport(history.dados,true,history);
  }catch(error){alert('Não foi possível consultar a última atualização: '+error.message);}
 }
 function managerPdf(){
  if(!selectedWork){alert('Selecione uma obra.');return;}
  if(!window.jspdf?.jsPDF){alert('Gerador PDF indisponível. Atualize a página.');return;}
  const generate=async()=>{
   const history=await latestMasterHistory(),doc=new window.jspdf.jsPDF({unit:'mm',format:'a4'});
   if(typeof doc.autoTable!=='function')throw Error('Módulo de tabelas indisponível.');
   const clean=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
   const data=records.slice(),disciplines=[...new Set(data.map(r=>r.disciplina))].sort(),files=data.length;
   const sheets=new Set(data.map(r=>r.codigo_folha));
   const formats={pdf:data.filter(r=>r.formato==='pdf').length,dwg:data.filter(r=>r.formato==='dwg').length,dxf:data.filter(r=>r.formato==='dxf').length};
   const bySheet=new Map();for(const r of data){if(!bySheet.has(r.codigo_folha))bySheet.set(r.codigo_folha,[]);bySheet.get(r.codigo_folha).push(r);}
   const revised=[...bySheet].filter(([,items])=>new Set(items.map(r=>r.revisao)).size>1);
   doc.setFillColor(12,47,72);doc.rect(0,0,210,39,'F');doc.setTextColor(255);doc.setFontSize(17);doc.setFont('helvetica','bold');doc.text('SIGEM OBRAS | SPOBRAS',15,18);doc.setFontSize(11);doc.text('RELATORIO GERENCIAL DE PROJETOS',15,28);
   doc.setTextColor(35,61,77);doc.setFontSize(9);doc.setFont('helvetica','normal');
   doc.text(doc.splitTextToSize(clean('Obra: '+(selectedWork.nome||selectedWork.codigo||selectedWork.id)),180),15,47);
   doc.text('Emitido em: '+new Date().toLocaleString('pt-BR'),15,56);
   doc.autoTable({startY:64,head:[['Indicador','Quantidade']],body:[['Arquivos cadastrados',files],['Folhas distintas',sheets.size],['Disciplinas com projetos',disciplines.length],['Arquivos PDF',formats.pdf],['Arquivos DWG',formats.dwg],['Arquivos DXF',formats.dxf],['Folhas com multiplas revisoes',revised.length]],theme:'grid',headStyles:{fillColor:[17,77,99]},styles:{fontSize:9}});
   const table=(title,head,body)=>{let y=(doc.lastAutoTable?.finalY||65)+12;if(y>252){doc.addPage();y=22;}doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(12,47,72);doc.text(clean(title),15,y);doc.autoTable({startY:y+4,head:[head],body:body.length?body:[['Nenhum registro',...head.slice(1).map(()=>'')]],theme:'grid',headStyles:{fillColor:[17,77,99]},styles:{fontSize:8,overflow:'linebreak'},margin:{left:15,right:15,bottom:18}});};
   table('Projetos por disciplina',['Disciplina','Arquivos','Folhas'],disciplines.map(d=>[clean(d+' - '+DISC[d]),data.filter(r=>r.disciplina===d).length,new Set(data.filter(r=>r.disciplina===d).map(r=>r.codigo_folha)).size]));
   table('Distribuicao por fase',['Fase','Arquivos','Folhas'],[4,5,6].map(f=>[clean(PHASE[f]),data.filter(r=>r.fase===f).length,new Set(data.filter(r=>r.fase===f).map(r=>r.codigo_folha)).size]));
   table('Folhas com mais de uma revisao',['Folha','Revisoes cadastradas'],revised.sort((a,b)=>a[0].localeCompare(b[0],'pt-BR',{numeric:true})).map(([sheet,items])=>[sheet,[...new Set(items.map(r=>r.revisao))].sort().join(', ')]));
   if(history){
    const x=history.dados;
    table('Ultima Lista Mestra: '+history.arquivo_nome,['Indicador','Resultado'],[['Importada em',new Date(history.importado_em).toLocaleString('pt-BR')],['Folhas na lista',x.total],['Revisoes obsoletas na comparacao',x.obsolete.length],['Folhas ausentes na comparacao',x.missing.length],['Folhas canceladas na comparacao',x.cancelled.length],['Exclusao confirmada',history.exclusao_confirmada_em?'Sim':'Nao']]);
    table('Pendencias de revisao da ultima conferencia',['Folha','SIGEM na importacao','Revisao vigente'],x.obsolete.map(o=>[o.entry.sheet,o.revisions.join(', '),o.entry.rev]));
    table('Folhas ausentes na ultima conferencia',['Folha','Revisao vigente'],x.missing.map(o=>[o.sheet,o.rev]));
    table('Cancelamentos identificados na ultima conferencia',['Folha','Arquivos identificados'],x.cancelled.map(o=>[o.entry.sheet,o.files.length]));
   }else table('Lista Mestra',['Situacao','Informacao'],[['Sem importacao registrada','Importe uma Lista Mestra para analisar revisoes vigentes']]);
   const pages=doc.internal.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(100);doc.text('SIGEM Obras - SPOBRAS | Pagina '+i+' de '+pages,15,290);}
   doc.save('SIGEM_SPOBRAS_Relatorio_Gerencial_'+new Date().toISOString().slice(0,10)+'.pdf');
  };
  generate().catch(e=>alert('Não foi possível gerar o relatório: '+e.message));
 }
 function masterTable(title,headers,rows){
  const section=make('section','sp-master-section'),heading=make('h4','',title);section.append(heading);
  if(!rows.length){section.append(make('p','sp-master-empty','Nenhuma ocorrência identificada.'));return section;}
  const container=make('div','sp-master-table-wrap'),table=make('table','sp-master-table'),thead=make('thead'),tr=make('tr');
  for(const header of headers)tr.append(make('th','',header));
  thead.append(tr);table.append(thead);
  const tbody=make('tbody');
  for(const row of rows){const line=make('tr');for(const cell of row)line.append(make('td','',String(cell??'')));tbody.append(line);}
  table.append(tbody);container.append(table);section.append(container);return section;
 }
 function downloadMasterReport(){
  if(!masterReport)return;
  if(!window.jspdf?.jsPDF){
   masterNotice('Gerador de PDF indisponível. Atualize a página e tente novamente.',true);
   return;
  }
  try{
   const r=masterReport,doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
   if(typeof doc.autoTable!=='function')throw Error('Módulo de tabelas PDF indisponível.');
   const margin=15,pageWidth=210,contentWidth=180;
   const plain=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
   const section=(title,heads,rows)=>{
    let y=doc.lastAutoTable?.finalY||78;
    if(y>253){doc.addPage();y=23;}
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(15,54,76);
    doc.text(plain(title),margin,y+9);
    doc.autoTable({
     startY:y+13,margin:{left:margin,right:margin,bottom:18},
     head:[heads.map(plain)],
     body:(rows.length?rows:[['Nenhuma ocorrencia identificada.',...heads.slice(1).map(()=>'')]]).map(row=>row.map(plain)),
     theme:'grid',styles:{font:'helvetica',fontSize:8,cellPadding:2.7,overflow:'linebreak',valign:'top'},
     headStyles:{fillColor:[17,77,99],textColor:[255,255,255],fontStyle:'bold'},
     alternateRowStyles:{fillColor:[245,249,251]},
     columnStyles:{0:{cellWidth:87}},didDrawPage:()=>{}
    });
   };
   doc.setFillColor(12,47,72);doc.rect(0,0,pageWidth,34,'F');
   doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(17);
   doc.text('SIGEM OBRAS | SPOBRAS',margin,17);
   doc.setFont('helvetica','normal');doc.setFontSize(10);
   doc.text('Relatorio de conferencia da Lista Mestra de Projetos',margin,25);
   doc.setTextColor(40,66,82);doc.setFontSize(9);
   doc.text(doc.splitTextToSize(plain('Empreendimento: '+r.obraNome),contentWidth),margin,43);
   doc.text(doc.splitTextToSize(plain('Lista Mestra: '+r.file+' | Data: '+r.date),contentWidth),margin,51);
   doc.setFillColor(233,244,248);doc.roundedRect(margin,59,contentWidth,19,2,2,'F');
   doc.setFont('helvetica','bold');doc.setFontSize(9);
   doc.text('Folhas: '+r.total+'    Obsoletas: '+r.obsolete.length+'    Ausentes: '+r.missing.length+'    Canceladas: '+r.cancelled.length,margin+5,70);
   doc.lastAutoTable={finalY:80};
   section('1. REVISOES OBSOLETAS',['Codigo da folha','Revisoes no SIGEM','Vigente'],r.obsolete.map(x=>[x.entry.sheet,x.revisions.join(', '),x.entry.rev]));
   section('2. FOLHAS NAO CADASTRADAS',['Codigo da folha','Revisao vigente'],r.missing.map(x=>[x.sheet,x.rev]));
   section('3. PROJETOS CANCELADOS',['Codigo da folha','Arquivos','Revisoes e formatos'],r.cancelled.map(x=>[x.entry.sheet,x.files.length,[...new Set(x.files.map(f=>f.revisao+' / '+f.formato.toUpperCase()))].join(', ')]));
   section('4. ARQUIVOS SUJEITOS A EXCLUSAO',['Codigo da folha','Nome do arquivo'],r.cancelled.flatMap(x=>x.files.map(f=>[x.entry.sheet,f.nome_arquivo])));
   let y=(doc.lastAutoTable?.finalY||40)+9;
   if(y>265){doc.addPage();y=24;}
   doc.setFont('helvetica','italic');doc.setFontSize(8);doc.setTextColor(95,105,115);
   doc.text(plain('Relatorio da comparacao anterior a confirmacao de exclusao. Baixar nao remove arquivos.'),margin,y);
   const pages=doc.internal.getNumberOfPages();
   for(let i=1;i<=pages;i++){
    doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,115,125);
    doc.text('SIGEM Obras - SPOBRAS | Pagina '+i+' de '+pages,margin,289);
   }
   doc.save('SIGEM_SPOBRAS_Conferencia_Lista_Mestra_'+new Date().toISOString().slice(0,10)+'.pdf');
  }catch(error){masterNotice('Nao foi possivel gerar o relatorio PDF: '+error.message,true);}
 }
 async function importMaster(){
  if(masterBusy)return;
  if(!selectedWork||!currentUser){masterNotice('Selecione uma obra e entre no sistema.',true);return;}
  const input=el('sp-master-file'),file=input?.files?.[0];
  if(!file){masterNotice('Selecione a Lista Mestra em Excel.',true);return;}
  if(!/\.(xls|xlsx)$/i.test(file.name)){masterNotice('Formato inválido. Selecione .xls ou .xlsx.',true);return;}
  if(file.size>15*1024*1024){masterNotice('A planilha excede 15 MB.',true);return;}
  if(typeof XLSX==='undefined'){masterNotice('Leitor de Excel indisponível. Recarregue a página.',true);return;}
  const btn=el('sp-master-import');masterBusy=true;btn.disabled=true;btn.textContent='Comparando projetos...';
  try{
   masterReport=null;el('sp-master-download').disabled=true;
   const obra=selectedWork.id;
   const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
   const sheet=wb.Sheets[wb.SheetNames[0]];
   if(!sheet)throw Error('A planilha não contém uma aba válida.');
   const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false});
   const master=new Map(),invalid=[],conflicts=[];
   let candidates=0;
   for(let i=0;i<rows.length;i++){
    const row=rows[i],a=String(row[0]??'').trim();
    if(!a)continue;
    const parsed=masterCode(a);
    if(!parsed){if(/^(DE|RT|MC)-/i.test(a))invalid.push('Linha '+(i+1)+': '+a);continue;}
    candidates++;
    const status=String(row[9]??'').trim().toLocaleLowerCase('pt-BR');
    const canceled=status==='cancelado';
    const prev=master.get(parsed.sheet);
    if(prev&&(prev.rev!==parsed.rev||prev.canceled!==canceled))conflicts.push(parsed.sheet+' (linhas '+prev.line+' e '+(i+1)+')');
    else master.set(parsed.sheet,{...parsed,canceled,line:i+1});
   }
   if(!candidates)throw Error('Nenhum código válido foi encontrado na coluna A da primeira aba.');
   if(invalid.length||conflicts.length)throw Error('Importação bloqueada por inconsistências na Lista Mestra. '+(invalid.length?'Códigos inválidos: '+invalid.slice(0,6).join('; ')+'. ':'')+(conflicts.length?'Folhas conflitantes: '+conflicts.slice(0,6).join('; '):''));
   // Consulta completa, inclusive quando houver mais de mil arquivos.
   let all=[],offset=0;
   while(true){
    const {data,error}=await db.from('projetos_spobras').select('id,codigo_folha,revisao,formato,nome_arquivo,storage_path').eq('obra_id',obra).range(offset,offset+999);
    if(error)throw error;
    all.push(...(data||[]));if(!data||data.length<1000)break;offset+=1000;
   }
   if(selectedWork?.id!==obra)throw Error('A obra foi alterada. Importe novamente.');
   const bySheet=new Map();
   for(const r of all){if(!bySheet.has(r.codigo_folha))bySheet.set(r.codigo_folha,[]);bySheet.get(r.codigo_folha).push(r);}
   const obsolete=[],missing=[],cancelled=[];
   for(const [sheet,entry] of master){
    const registered=bySheet.get(sheet)||[];
    if(entry.canceled){if(registered.length)cancelled.push({entry,files:registered});continue;}
    if(!registered.length){missing.push(entry);continue;}
    const revisions=[...new Set(registered.map(r=>r.revisao))];
    if(!revisions.includes(entry.rev))obsolete.push({entry,revisions});
    else if(revisions.some(r=>r!==entry.rev))obsolete.push({entry,revisions:revisions.filter(r=>r!==entry.rev)});
   }
   // Ordenação comum ao popup e ao relatório PDF: disciplina A-Z, depois folha crescente.
   const orderMaster=(a,b)=>{
    const ca=a.entry?.sheet||a.sheet,cb=b.entry?.sheet||b.sheet;
    const pa=ca.match(/-([456])([A-Z])-00-([0-9]+)$/),pb=cb.match(/-([456])([A-Z])-00-([0-9]+)$/);
    if(!pa||!pb)return ca.localeCompare(cb,'pt-BR',{numeric:true});
    return pa[2].localeCompare(pb[2],'pt-BR')||
      Number(pa[3])-Number(pb[3])||
      Number(pa[1])-Number(pb[1])||
      ca.localeCompare(cb,'pt-BR',{numeric:true});
   };
   obsolete.sort(orderMaster);
   missing.sort(orderMaster);
   cancelled.sort(orderMaster);
   masterReport={obra,obraNome:selectedWork?.nome||selectedWork?.codigo||String(obra),file:file.name,date:new Date().toLocaleString('pt-BR'),total:master.size,registered:all.length,obsolete,missing,cancelled};
   const snapshot={...masterReport,cancelled:cancelled.map(x=>({entry:x.entry,files:x.files.map(f=>({id:f.id,nome_arquivo:f.nome_arquivo,formato:f.formato,revisao:f.revisao,storage_path:f.storage_path}))}))};
   const {data:saved,error:saveError}=await db.from('spobras_lista_mestra_historico').insert({obra_id:obra,arquivo_nome:file.name,importado_por:currentUser.id,dados:snapshot}).select('id').single();
   if(saveError)throw Error('Não foi possível salvar a última Lista Mestra: '+saveError.message);
   masterHistoryId=saved.id;
   showMasterReport(masterReport,false);
   masterPending={obra,cancelled};
   el('sp-master-ok').disabled=false;
   el('sp-master-ok').textContent='OK';
   masterPopup(true);
   masterNotice('Comparação concluída. Confira os resultados no popup.');
  }catch(e){masterNotice('Lista Mestra não importada: '+e.message,true);}
  finally{masterBusy=false;btn.disabled=false;btn.textContent='↑ Importar e comparar Lista Mestra';}
 }
 async function approveMaster(){
  if(masterBusy)return;
  if(!masterPending){masterPopup(false);return;}
  const pending=masterPending,btn=el('sp-master-ok'),body=el('sp-master-results');
  if(selectedWork?.id!==pending.obra){body.append(make('p','sp-master-error','A obra selecionada mudou. A exclusão foi bloqueada.'));return;}
  masterBusy=true;btn.disabled=true;btn.textContent='Excluindo cancelados...';
  const failures=[];let removed=0;
  try{
   for(const item of pending.cancelled){
    // Nova consulta impede apagar registros adicionados depois da comparação sem revisão.
    const {data:current,error:lookupError}=await db.from('projetos_spobras').select('id,storage_path').eq('obra_id',pending.obra).eq('codigo_folha',item.entry.sheet);
    if(lookupError){failures.push(item.entry.sheet+': '+lookupError.message);continue;}
    const approvedIds=new Set(item.files.map(f=>f.id));
    if(current.some(r=>!approvedIds.has(r.id))){failures.push(item.entry.sheet+': novos arquivos detectados; importe a lista novamente.');continue;}
    for(const r of current){
     try{
      // Remover primeiro o objeto físico e depois o registro; falhas ficam visíveis.
      const {data:storageResult,error:storageError}=await db.storage.from(BUCKET).remove([r.storage_path]);
      if(storageError)throw storageError;
      if(!storageResult?.some(o=>o.name===r.storage_path||r.storage_path.endsWith('/'+o.name)))throw Error('Exclusão do arquivo não confirmada no armazenamento.');
      const {data:deleted,error:deleteError}=await db.from('projetos_spobras').delete().eq('obra_id',pending.obra).eq('id',r.id).select('id');
      if(deleteError)throw deleteError;
      if(deleted?.length!==1)throw Error('Registro não removido do banco.');
      removed++;
     }catch(e){failures.push(r.storage_path+': '+e.message);}
    }
   }
   if(masterHistoryId){
    const {error:historyError}=await db.from('spobras_lista_mestra_historico').update({exclusao_confirmada_em:new Date().toISOString(),exclusao_resultado:{removed,failures}}).eq('id',masterHistoryId).eq('obra_id',pending.obra);
    if(historyError)body.append(make('p','sp-master-error','Atenção: não foi possível registrar a confirmação no histórico: '+historyError.message));
   }
   if(failures.length){
    body.append(make('p','sp-master-error','Exclusão parcial: '+removed+' arquivo(s) removido(s). Falhas: '+failures.length+'.'));
    const list=make('ul','sp-master-items');for(const f of failures)list.append(make('li','',f));body.append(list);
    masterNotice('Algumas exclusões falharam. Confira o popup e tente nova importação.',true);
    // Não fechar em caso de erro; evitar executar exclusões novamente a partir de resultado antigo.
    masterPending=null;btn.textContent='Falhas na exclusão — reimporte';btn.disabled=true;
   }else{
    masterPending=null;masterPopup(false);masterNotice('Lista Mestra conferida. '+removed+' arquivo(s) cancelado(s) removido(s) após confirmação.');
   }
   await load();
  }catch(e){body.append(make('p','sp-master-error','Erro ao concluir: '+e.message));masterNotice('Falha na exclusão.',true);}
  finally{masterBusy=false;if(masterPending){btn.disabled=false;btn.textContent='OK';}}
 }
 el('sp-master-import')?.addEventListener('click',()=>importMaster());
 el('sp-manager-report')?.addEventListener('click',managerPdf);
 el('sp-last-master')?.addEventListener('click',openLastMaster);
 el('sp-master-ok')?.addEventListener('click',()=>approveMaster());
 el('sp-master-download')?.addEventListener('click',()=>downloadMasterReport());

 el('sp-filter')?.addEventListener('change',render);
 el('sp-latest-only')?.addEventListener('change',render);
 try{render();}catch(error){message('Erro ao inicializar a biblioteca de projetos: '+(error?.message||String(error)),true);}
})();