'use strict';
(function(){
 const DISC={A:'Arquitetura',B:'Serviços Iniciais, Estudos e Gestão de Contratos',C:'Estrutura de Concreto',D:'Desapropriação e Cadastro',E:'Sistemas Elétricos e Mecânicos',F:'Geometria',G:'Geologia e Geotecnia',H:'Hidrologia, Hidráulica e Drenagem',I:'Interferência e Cadastro',K:'Métodos Construtivos',L:'Paisagismo',M:'Estruturas Metálicas e de Madeira',N:'Meio Ambiente',O:'Comunicação Visual',P:'Pavimentação',Q:'Terraplanagem',S:'Sinalização e Desvio de Tráfego',T:'Topografia e Aerofotogrametria',U:'Urbanismo e Uso e Ocupação do Solo',V:'Vala Técnica e Projeto Aerodinâmico',W:'Conservação e Manutenção',X:'Impermeabilização'};
 const TYPES={DE:'Desenho Técnico',RT:'Relatório Técnico',MC:'Memória de Cálculo'};
 const PHASE={4:'Projeto Básico',5:'Projeto Executivo',6:'As Built'};
 const BUCKET='projetos-spobras', MAX=50*1024*1024;
 let records=[],loadedWork=null,request=0;
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
  filter.replaceChildren(new Option('Selecione uma disciplina',''));
  for(const [code,name] of Object.entries(DISC))filter.add(new Option(code+' — '+name,code));
  filter.value=active;
  el('sp-discipline-count').textContent=new Set(records.map(r=>r.disciplina)).size;
  el('sp-pdf-count').textContent=records.filter(r=>r.formato==='pdf').length;
  el('sp-cad-count').textContent=records.filter(r=>r.formato!=='pdf').length;
  list.replaceChildren();
  if(!active){list.append(make('p','sp-library-footnote','Selecione uma disciplina para consultar os arquivos cadastrados.'));return;}
  let rows=records.filter(r=>r.disciplina===active);
  if(onlyLatest)rows=latestRows(rows);
  
  rows.sort((a,b)=>a.codigo_folha.localeCompare(b.codigo_folha,'pt-BR',{numeric:true})||revisionRank(b.revisao)[0]-revisionRank(a.revisao)[0]||revisionRank(b.revisao)[1]-revisionRank(a.revisao)[1]);
  if(!rows.length){list.append(make('p','sp-library-footnote','Nenhum projeto encontrado para esta disciplina e filtros.'));return;}
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

 let masterReport=null;
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
   masterReport={obra,obraNome:selectedWork?.nome||selectedWork?.codigo||String(obra),file:file.name,date:new Date().toLocaleString('pt-BR'),total:master.size,registered:all.length,obsolete,missing,cancelled};
   const body=el('sp-master-results');body.replaceChildren();
   const summary=make('div','sp-master-summary-grid');
   for(const [label,value] of [['Folhas analisadas',master.size],['Revisões obsoletas',obsolete.length],['Folhas ausentes',missing.length],['Folhas canceladas',cancelled.length]]){
    const card=make('div','sp-master-stat');card.append(make('strong','',String(value)),make('span','',label));summary.append(card);
   }
   body.append(make('p','sp-master-report-meta','Lista: '+file.name+' · Conferência: '+masterReport.date),summary,
    masterTable('1. Revisões obsoletas',['Folha','No SIGEM','Vigente'],obsolete.map(x=>[x.entry.sheet,x.revisions.join(', '),x.entry.rev])),
    masterTable('2. Folhas não cadastradas',['Folha','Revisão vigente'],missing.map(x=>[x.sheet,x.rev])),
    masterTable('3. Projetos cancelados',['Folha','Arquivos','Revisões / Formatos'],cancelled.map(x=>[x.entry.sheet,x.files.length,[...new Set(x.files.map(f=>f.revisao+' / '+f.formato.toUpperCase()))].join(', ')])));
   if(cancelled.length)body.append(make('p','sp-master-alert','Ao clicar em OK, você autoriza a exclusão definitiva de '+cancelled.reduce((n,x)=>n+x.files.length,0)+' arquivo(s) das folhas canceladas acima.'));
   else body.append(make('p','sp-master-note','Nenhum projeto será excluído nesta importação.'));
   el('sp-master-download').disabled=false;
   masterPending={obra,cancelled};
   el('sp-master-ok').disabled=false;
   el('sp-master-ok').textContent='OK';
   masterPopup(true);
   masterNotice('Comparação concluída. Confira os resultados no popup.');
  }catch(e){masterNotice('Lista Mestra não importada: '+e.message,true);}
  finally{masterBusy=false;btn.disabled=false;btn.textContent='↑ Importar e comparar Lista Mestra';}
 }
 async function approveMaster(){
  if(masterBusy||!masterPending)return;
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
 el('sp-master-ok')?.addEventListener('click',()=>approveMaster());
 el('sp-master-download')?.addEventListener('click',()=>downloadMasterReport());

 el('sp-filter')?.addEventListener('change',render);
 el('sp-latest-only')?.addEventListener('change',render);
 try{render();}catch(error){message('Erro ao inicializar a biblioteca de projetos: '+(error?.message||String(error)),true);}
})();