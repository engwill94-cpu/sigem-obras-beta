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
 function render(){
  const list=el('sp-discipline-list'),filter=el('sp-filter'),term=el('sp-search').value.trim().toLocaleLowerCase('pt-BR');
  if(!list)return;
  const active=filter.value;filter.replaceChildren(new Option('Todas as disciplinas',''));
  Object.entries(DISC).forEach(([code,name])=>filter.add(new Option(code+' — '+name,code)));
  filter.value=active;
  el('sp-discipline-count').textContent=new Set(records.map(r=>r.disciplina)).size;
  el('sp-pdf-count').textContent=records.filter(r=>r.formato==='pdf').length;
  el('sp-cad-count').textContent=records.filter(r=>r.formato!=='pdf').length;
  list.replaceChildren();
  for(const [letter,title] of Object.entries(DISC)){
   if(active&&active!==letter)continue;
   const rows=records.filter(r=>r.disciplina===letter&&(!term||[r.nome_arquivo,r.codigo_folha,r.folha,r.revisao,r.formato,title,PHASE[r.fase],TYPES[r.codigo_folha.slice(0,2)]].some(v=>String(v).toLocaleLowerCase('pt-BR').includes(term))));
   if(!rows.length)continue;
   const details=make('details','sp-discipline-item');details.open=!!active||!!term;
   const summary=make('summary');summary.append(make('span','sp-discipline-label',letter+' — '+title),make('span','sp-count',rows.length+' arquivo(s)'));details.append(summary);
   for(const [format,label] of [['pdf','Arquivos PDF'],['cad','Arquivos DWG / DXF']]){
    const section=make('div','sp-format');section.append(make('strong','',label));
    const group=rows.filter(r=>format==='pdf'?r.formato==='pdf':r.formato!=='pdf');
    if(!group.length)section.append(make('p','','Nenhum arquivo neste formato.'));
    for(const record of group){
     const row=make('div','sp-project-row'),info=make('div','sp-project-name'),actions=make('div','sp-project-actions');
     info.append(make('strong','',record.nome_arquivo),make('small','',(TYPES[record.codigo_folha.slice(0,2)]||'Documento técnico')+' · '+PHASE[record.fase]+' · Folha '+record.folha+'' · Rev. '+record.revisao));
     if(record.formato==='pdf'){
      const view=make('button','','◉ Visualizar');view.type='button';view.addEventListener('click',()=>openPdf(record));actions.append(view);
     }
     const download=make('button','','↓ Download');download.type='button';download.addEventListener('click',()=>downloadFile(record));actions.append(download);
     row.append(info,actions);section.append(row);
    }
    details.append(section);
   }
   list.append(details);
  }
  if(!list.children.length)list.append(make('p','sp-library-footnote',records.length?'Nenhum projeto corresponde à pesquisa.':'Nenhum projeto cadastrado nesta obra.'));
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
  const obra=selectedWork.id;let success=0,fail=0,warnings=[];
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
     if(related.length)warnings.push(file.name+': mesma folha em outra revisão; comparação gráfica de carimbo e desenho não realizada automaticamente.');
     path=obra+'/'+crypto.randomUUID()+'/'+file.name;
     const mime=parsed.formato==='pdf'?'application/pdf':'application/octet-stream';
     message('Enviando '+file.name+'...');
     const {error:uploadError}=await timeout(db.storage.from(BUCKET).upload(path,file,{contentType:mime,upsert:false}),60000);
     if(uploadError)throw uploadError;
     const {error:insertError}=await timeout(db.from('projetos_spobras').insert({...parsed,obra_id:obra,nome_arquivo:file.name,storage_path:path,checksum_sha256:digest,uploaded_by:currentUser.id}));
     if(insertError)throw insertError;
     path=null;success++;
    }catch(e){
     fail++;warnings.push(file.name+': '+e.message);
     if(path)await db.storage.from(BUCKET).remove([path]).catch(()=>{});
    }
   }
  }finally{
   btn.disabled=false;btn.textContent='↑ Verificar e cadastrar projetos';
   el('sp-files').value='';
   if(selectedWork?.id===obra)await load();
   message(success+' projeto(s) cadastrado(s); '+fail+' não cadastrado(s). '+(warnings.join(' | ')||'Arquivos classificados automaticamente.'),fail>0);
  }
 }
 el('sp-upload-button')?.addEventListener('click',upload);
 el('sp-search')?.addEventListener('input',render);
 el('sp-filter')?.addEventListener('change',render);
 render();
})();