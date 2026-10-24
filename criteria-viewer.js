'use strict';
(async function(){
const $=id=>document.getElementById(id),pdfjs=window.pdfjsLib;
let pdf=null,pageNum=1,results=[],matchIndex=-1,renderSeq=0,searchSeq=0,pageTexts=new Map();
const status=s=>$('status').textContent=s;
if(!pdfjs){status('Não foi possível carregar o leitor de PDF.');return;}
pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
let args;try{args=JSON.parse(decodeURIComponent(location.hash.slice(1)));}catch(_){status('Link de visualização inválido.');return;}
let url;try{url=new URL(args.url);if(url.protocol!=='https:'||url.hostname!=='nigrecjshlxflczfzssn.supabase.co'&&url.hostname!=='nigrecjshlxflczfzssn.storage.supabase.co')throw Error();}catch(_){status('Origem do arquivo não autorizada.');return;}
$('filename').textContent=String(args.name||'Critério de medição');
history.replaceState(null,'',location.pathname);
try{pdf=await pdfjs.getDocument({url:url.href}).promise;status('Documento carregado. Use a pesquisa para localizar termos nas páginas.');await render();}catch(e){status('Não foi possível abrir o PDF: '+e.message);return;}
async function render(){
const token=++renderSeq,page=await pdf.getPage(pageNum),viewport=page.getViewport({scale:1.35}),canvas=$('canvas');
if(token!==renderSeq)return;
canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
$('page').style.width=canvas.width+'px';$('page').style.height=canvas.height+'px';
await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
if(token!==renderSeq)return;
$('page-label').textContent=pageNum+' / '+pdf.numPages;
$('prev-page').disabled=pageNum<=1;$('next-page').disabled=pageNum>=pdf.numPages;
const layer=$('highlights');layer.replaceChildren();
const term=$('search').value.trim().toLocaleLowerCase('pt-BR');if(!term)return;
const content=await page.getTextContent();if(token!==renderSeq)return;
for(const item of content.items){
 if(!item.str||!item.str.toLocaleLowerCase('pt-BR').includes(term))continue;
 const tx=pdfjs.Util.transform(viewport.transform,item.transform),width=item.width*viewport.scale,height=Math.max(8,Math.abs(item.height*viewport.scale));
 const mark=document.createElement('div');mark.className='mark';mark.style.left=tx[4]+'px';mark.style.top=(tx[5]-height)+'px';mark.style.width=Math.max(6,width)+'px';mark.style.height=height+'px';layer.append(mark);
}
}
async function find(){
const term=$('search').value.trim().toLocaleLowerCase('pt-BR'),token=++searchSeq;results=[];matchIndex=-1;$('matches').textContent='Pesquisando...';
if(!term){$('matches').textContent='0 resultados';updateButtons();await render();return;}
for(let n=1;n<=pdf.numPages;n++){
 const page=await pdf.getPage(n),content=await page.getTextContent();
 if(token!==searchSeq)return;
 const text=content.items.map(i=>i.str||'').join(' ').toLocaleLowerCase('pt-BR');
 let pos=0;while((pos=text.indexOf(term,pos))!==-1){results.push(n);pos+=Math.max(1,term.length);}
 if(n%10===0)$('matches').textContent='Pesquisando '+n+' / '+pdf.numPages+'...';
}
if(token!==searchSeq)return;
matchIndex=results.length?0:-1;updateButtons();if(results.length)pageNum=results[0];await render();
status(results.length?results.length+' ocorrência(s) encontrada(s) em '+pdf.numPages+' página(s).':'Termo não encontrado. PDFs digitalizados sem OCR podem não conter texto pesquisável.');
}
function updateButtons(){$('matches').textContent=results.length?(matchIndex+1)+' / '+results.length:'0 resultados';$('prev-match').disabled=!results.length;$('next-match').disabled=!results.length;}
function navigate(delta){if(!results.length)return;matchIndex=(matchIndex+delta+results.length)%results.length;pageNum=results[matchIndex];updateButtons();render();}
$('find').onclick=find;$('search').addEventListener('keydown',e=>{if(e.key==='Enter')find();});$('search').addEventListener('input',()=>{searchSeq++;results=[];matchIndex=-1;updateButtons();});
$('prev-match').onclick=()=>navigate(-1);$('next-match').onclick=()=>navigate(1);
$('prev-page').onclick=()=>{if(pageNum>1){pageNum--;render();}};$('next-page').onclick=()=>{if(pageNum<pdf.numPages){pageNum++;render();}};
})();