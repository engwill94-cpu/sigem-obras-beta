'use strict';
const $ = (id) => document.getElementById(id);
const show = (id) => ['setup','login','dashboard'].forEach(x => $(x).classList.toggle('hidden', x !== id));
const notice = (message) => { $('notice').textContent = message || ''; };
let db;
let currentUser = null;
const cfg = window.SIGEM_CONFIG || {};
const configured = cfg.supabaseUrl && /^https:\/\/[^/]+\.supabase\.co\/?$/.test(cfg.supabaseUrl) && /^sb_publishable_/.test(cfg.supabasePublishableKey || '');
if (!configured || !window.supabase) {
  show('setup');
  if (!window.supabase) notice('Não foi possível carregar a biblioteca Supabase. Verifique sua conexão.');
} else {
  db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
  initialize();
}
async function initialize() {
  const {data:{session},error} = await db.auth.getSession();
  if (error) notice('Não foi possível verificar a sessão: ' + error.message);
  await updateSession(session);
  db.auth.onAuthStateChange((_event,session) => {
    // Evitar consultas assíncronas ao Supabase dentro do callback de autenticação.
    currentUser = session?.user || null;
    show(currentUser ? 'dashboard' : 'login');
    if (currentUser) queueMicrotask(loadWorks);
  });
}
async function updateSession(session) {
  currentUser = session?.user || null;
  show(currentUser ? 'dashboard' : 'login');
  if (currentUser) await loadWorks();
}
$('login-form').addEventListener('submit',async(e)=>{
  e.preventDefault(); notice('');
  $('login-btn').disabled = true;
  const {data,error} = await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
  $('login-btn').disabled = false;
  $('password').value = '';
  if (error) { notice('Não foi possível entrar. Confira suas credenciais.'); return; }
  await updateSession(data.session);
});
$('logout').addEventListener('click',async()=>{
  const {error} = await db.auth.signOut();
  if (error) notice('Falha ao sair: '+error.message);
  else {notice('Sessão encerrada.'); $('editor').classList.add('hidden'); show('login');}
});
async function loadWorks() {
  if (!currentUser) return;
  const {data,error} = await db.from('obras').select('id,codigo,nome,municipio,uf,status,orgao,endereco,descricao').order('created_at',{ascending:false});
  if (error) { notice('Erro ao carregar obras: '+error.message); return; }
  const works = $('works'); works.replaceChildren();
  $('empty').classList.toggle('hidden',data.length !== 0);
  data.forEach(w => {
    const item=document.createElement('div'); item.className='work';
    const info=document.createElement('div');
    const title=document.createElement('strong'); title.textContent=w.codigo+' — '+w.nome;
    const sub=document.createElement('small'); sub.textContent=[w.municipio,w.uf,w.status].filter(Boolean).join(' • ');
    info.append(title,sub);
    const edit=document.createElement('button'); edit.className='secondary'; edit.textContent='Editar'; edit.addEventListener('click',()=>openEditor(w));
    item.append(info,edit); works.append(item);
  });
}
function openEditor(w=null) {
  $('work-form').reset();
  for (const key of ['id','codigo','nome','orgao','municipio','uf','status','endereco','descricao']) {
    const id=key==='id'?'work-id':key;
    if (w && $(id)) $(id).value=w[key] ?? '';
  }
  $('form-title').textContent=w?'Editar obra':'Nova obra';
  $('editor').classList.remove('hidden');
  $('editor').scrollIntoView({behavior:'smooth'});
}
$('new-btn').addEventListener('click',()=>openEditor());
$('cancel-btn').addEventListener('click',()=>$('editor').classList.add('hidden'));
$('work-form').addEventListener('submit',async(e)=>{
  e.preventDefault(); notice('');
  const values={codigo:$('codigo').value.trim(),nome:$('nome').value.trim(),orgao:$('orgao').value.trim()||null,municipio:$('municipio').value.trim()||null,uf:$('uf').value.trim().toUpperCase()||null,endereco:$('endereco').value.trim()||null,descricao:$('descricao').value.trim()||null,status:$('status').value};
  if(!values.codigo||!values.nome){notice('Informe código e nome.');return;}
  const id=$('work-id').value;
  $('save-btn').disabled=true;
  const {error}=id ? await db.from('obras').update(values).eq('id',id) : await db.from('obras').insert(values);
  $('save-btn').disabled=false;
  if(error){notice('Não foi possível salvar: '+error.message);return;}
  $('editor').classList.add('hidden'); notice('Obra salva com sucesso.'); await loadWorks();
});
