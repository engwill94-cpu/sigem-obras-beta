'use strict';
(function(){
 const names=['Arquitetura','Estrutura','Fundações','Elétrica','Hidráulica','Drenagem','Pavimentação','Geometria','Sinalização','Paisagismo','Outros'];
 const list=document.getElementById('sp-discipline-list');
 const search=document.getElementById('sp-search');
 const filter=document.getElementById('sp-filter');
 function render(){
  if(!list)return;
  const term=(search.value||'').trim().toLocaleLowerCase('pt-BR');
  const selected=filter.value;
  list.replaceChildren();
  for(const name of names){
   if(selected&&name!==selected)continue;
   if(term&&!name.toLocaleLowerCase('pt-BR').includes(term))continue;
   const details=document.createElement('details');
   details.className='sp-discipline-item';
   if(selected)details.open=true;
   const summary=document.createElement('summary');
   const label=document.createElement('span');label.className='sp-discipline-label';label.textContent='▤  '+name;
   const count=document.createElement('span');count.className='sp-count';count.textContent='0 projetos';
   summary.append(label,count);details.append(summary);
   for(const [title,description] of [['Arquivos PDF','Nenhum PDF cadastrado nesta disciplina.'],['Arquivos DWG / DXF','Nenhum arquivo CAD cadastrado nesta disciplina.']]){
    const section=document.createElement('div');section.className='sp-format';
    const heading=document.createElement('strong');heading.textContent=title;
    const message=document.createElement('p');message.textContent=description;
    section.append(heading,message);details.append(section);
   }
   list.append(details);
  }
  if(!list.childElementCount){const p=document.createElement('p');p.className='sp-library-footnote';p.textContent='Nenhuma disciplina corresponde à pesquisa.';list.append(p);}
 }
 search?.addEventListener('input',render);
 filter?.addEventListener('change',render);
 document.getElementById('sp-upload-button')?.addEventListener('click',()=>{
  const notice=document.getElementById('sp-upload-notice');
  notice.textContent='O layout está disponível para avaliação. O cadastro e armazenamento dos projetos ainda não foram ativados.';
  notice.style.color='#9a651c';
 });
 render();
})();