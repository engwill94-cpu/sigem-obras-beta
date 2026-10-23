
'use strict';

const $ = id => document.getElementById(id);

const show = id =>
  ['setup', 'login', 'dashboard'].forEach(x =>
    $(x).classList.toggle('hidden', x !== id)
  );

const notice = msg => {
  $('notice').textContent = msg || '';
  $('auth-notice').textContent = msg || '';
};

const statusMap = {
  planejamento: ['Planejamento', 's-planning'],
  em_execucao: ['Em execução', 's-running'],
  paralisada: ['Paralisada', 's-paused'],
  concluida: ['Concluída', 's-done'],
  arquivada: ['Arquivada', 's-archived']
};

let db;
let currentUser = null;
let allWorks = [];
let selectedWork = null;
let workRequest = 0;
let currentWorkTab='overview';
const NAV_KEY='sigem_navigation_v1';
function navSave(){
 try{
  if(!currentUser||!selectedWork)return;
  sessionStorage.setItem(NAV_KEY,JSON.stringify({userId:currentUser.id,obraId:selectedWork.id,tab:currentWorkTab}));
 }catch(_){}
}
function navClear(){try{sessionStorage.removeItem(NAV_KEY);}catch(_){}}
function navRestore(){
 if(selectedWork||!currentUser)return;
 try{
  const saved=JSON.parse(sessionStorage.getItem(NAV_KEY)||'null');
  if(!saved||saved.userId!==currentUser.id)return;
  const work=allWorks.find(w=>w.id===saved.obraId);
  if(!work){navClear();return;}
  const tab=typeof saved.tab==='string'&&document.querySelector('[data-work-tab="'+saved.tab+'"]')?saved.tab:'overview';
  enterWork(work);
  switchWorkTab(tab);
 }catch(_){navClear();}
}


const cfg = window.SIGEM_CONFIG || {};

const configured =
  cfg.supabaseUrl &&
  /^https:\/\/[^/]+\.supabase\.co\/?$/.test(cfg.supabaseUrl) &&
  /^sb_publishable_/.test(cfg.supabasePublishableKey || '');

if (!configured || !window.supabase) {
  show('setup');

  if (!window.supabase) {
    notice('Não foi possível carregar a biblioteca Supabase. Verifique sua conexão.');
  } else {
    notice('Configuração pública do Supabase incompleta.');
  }
} else {
  db = window.supabase.createClient(
    cfg.supabaseUrl,
    cfg.supabasePublishableKey
  );
  initialize();
}

async function initialize() {
  const {
    data: { session },
    error
  } = await db.auth.getSession();

  if (error) {
    notice('Não foi possível verificar a sessão: ' + error.message);
  }

  await updateSession(session);

  db.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    show(currentUser ? 'dashboard' : 'login');

    if (currentUser) {
      queueMicrotask(loadWorks);
    }
  });
}

async function updateSession(session) {
  currentUser = session?.user || null;
  show(currentUser ? 'dashboard' : 'login');

  if (currentUser) {
    await loadWorks();
  }
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();

  if (!db) {
    notice('Conexão não configurada.');
    return;
  }

  notice('');
  $('login-btn').disabled = true;

  const { data, error } = await db.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value
  });

  $('login-btn').disabled = false;
  $('password').value = '';

  if (error) {
    notice('Não foi possível entrar. Confira suas credenciais.');
    return;
  }

  await updateSession(data.session);
});

$('logout').addEventListener('click', async () => {
  const { error } = await db.auth.signOut();

  if (error) {
    notice('Falha ao sair: ' + error.message);
  } else {
    notice('Sessão encerrada.');
    $('editor').classList.add('hidden');
    backToOverview();
    navClear();
    show('login');
  }
});

async function loadWorks() {
  if (!currentUser) return;

  const { data, error } = await db
    .from('obras')
    .select(
      'id,codigo,nome,municipio,uf,status,orgao,endereco,descricao,created_at'
    )
    .order('created_at', { ascending: false });

  if (error) {
    notice('Erro ao carregar obras: ' + error.message);
    return;
  }

  allWorks = data || [];
  updateStats();
  updateCities();
  renderWorks();
  navRestore();
}

function updateStats() {
  const stats = [
    ['stat-total', allWorks.length],
    [
      'stat-running',
      allWorks.filter(w => w.status === 'em_execucao').length
    ],
    [
      'stat-paused',
      allWorks.filter(w => w.status === 'paralisada').length
    ],
    [
      'stat-done',
      allWorks.filter(w => w.status === 'concluida').length
    ]
  ];

  for (const [id, value] of stats) {
    $(id).textContent = value;
  }
}

function updateCities() {
  const sel = $('filter-city');
  const previous = sel.value;

  sel.replaceChildren(new Option('Todos', ''));

  const cities = [
    ...new Set(
      allWorks.map(w => w.municipio).filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  cities.forEach(city => {
    sel.add(new Option(city, city));
  });

  sel.value = previous;
}

function renderWorks() {
  const query = $('search')
    .value.trim()
    .toLocaleLowerCase('pt-BR');

  const status = $('filter-status').value;
  const city = $('filter-city').value;

  let rows = allWorks.filter(w =>
    (!status || w.status === status) &&
    (!city || w.municipio === city) &&
    [w.codigo, w.nome, w.municipio, w.orgao].some(v =>
      (v || '')
        .toLocaleLowerCase('pt-BR')
        .includes(query)
    )
  );

  if ($('sort').value === 'name') {
    rows.sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR')
    );
  }

  if ($('sort').value === 'code') {
    rows.sort((a, b) =>
      a.codigo.localeCompare(b.codigo, 'pt-BR')
    );
  }

  const root = $('works');
  root.replaceChildren();

  $('empty').classList.toggle('hidden', rows.length > 0);

  $('result-count').textContent =
    `Mostrando ${rows.length} de ${allWorks.length} obra(s)`;

  rows.forEach(w => {
    root.append(makeWorkCard(w));
  });
}

function makeWorkCard(w) {
  const card = document.createElement('article');
  card.className = 'work';

  const visual = document.createElement('div');
  visual.className = 'work-visual';
  visual.textContent = '▥';
  visual.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'work-body';

  const title = document.createElement('div');
  title.className = 'work-title';

  const strong = document.createElement('strong');
  strong.textContent = w.codigo + ' — ' + w.nome;

  const badge = document.createElement('span');
  badge.className =
    'status-pill ' +
    (statusMap[w.status]?.[1] || 's-archived');

  badge.textContent =
    statusMap[w.status]?.[0] || w.status;

  title.append(strong, badge);

  const meta = document.createElement('div');
  meta.className = 'work-meta';

  meta.textContent =
    [w.municipio, w.uf].filter(Boolean).join(' - ') +
    (w.orgao ? '  ·  ' + w.orgao : '');

  const desc = document.createElement('div');
  desc.className = 'work-description';

  desc.textContent =
    w.descricao || 'Obra cadastrada no SIGEM Obras';

  const progress = document.createElement('div');
  progress.className = 'progress-placeholder';

  const ptxt = document.createElement('span');
  ptxt.textContent =
    'Evolução física e financeira: aguardando medições';

  const line = document.createElement('div');
  line.className = 'line';

  progress.append(ptxt, line);
  body.append(title, meta, desc, progress);

  const details = document.createElement('div');
  details.className = 'work-details';

  const city = document.createElement('span');
  city.textContent =
    '⌖  ' + (w.municipio || 'Município não informado');

  const org = document.createElement('span');
  org.textContent =
    '▦  ' + (w.orgao || 'Órgão não informado');

  const state = document.createElement('span');
  state.textContent =
    '◷  ' + (statusMap[w.status]?.[0] || w.status);

  details.append(city, org, state);

  const actions = document.createElement('div');
  actions.className = 'work-actions';

  const enter = document.createElement('button');
  enter.type = 'button';
  enter.textContent = '↗  Entrar';

  enter.addEventListener('click', () => enterWork(w));

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary';
  edit.textContent = '✎  Editar';

  edit.addEventListener('click', () => openEditor(w));

  actions.append(enter, edit);
  card.append(visual, body, details, actions);

  return card;
}

function enterWork(w) {
  selectedWork = w;
  currentWorkTab='overview';
  navSave();

  const request = ++workRequest;

  $('editor').classList.add('hidden');
  $('overview').classList.add('hidden');
  $('work-space').classList.remove('hidden');

  document.body.classList.add('inside-mode');

  const st = statusMap[w.status] || [
    w.status || 'Não informado',
    's-archived'
  ];

  $('selected-title').textContent =
    w.codigo + ' — ' + w.nome;

  $('selected-subtitle').textContent =
    [w.municipio, w.orgao].filter(Boolean).join(' · ');

  $('picker-title').textContent =
    w.codigo + ' — ' + w.nome;

  $('picker-meta').textContent =
    [w.municipio, st[0]].filter(Boolean).join(' · ');

  $('sidebar-work-status').textContent = st[0];
  $('kpi-status').textContent = st[0];

  $('hero-title').textContent =
    w.codigo + ' — ' + w.nome;

  $('hero-description').textContent =
    w.descricao || 'Obra pública de infraestrutura';

  $('hero-location').textContent =
    '⌖ ' + [w.municipio, w.uf].filter(Boolean).join(' - ');

  $('hero-agency').textContent =
    '▦ ' + (w.orgao || 'Órgão não informado');

  $('kpi-contract-value').textContent = '—';
  $('current-contract-value').textContent = '—';
  $('kpi-contract-count').textContent = '—';
  $('kpi-contract-caption').textContent =
    'Consultando contratos';

  $('contract-list').replaceChildren();

  $('docs-submenu').classList.add('hidden');
  $('docs-menu-toggle').setAttribute('aria-expanded','false');
  switchWorkTab('overview');

  document.querySelectorAll('[data-top-tab]').forEach(b => {
    b.classList.toggle(
      'active',
      b.dataset.topTab === 'overview'
    );
  });

  window.scrollTo(0, 0);

  loadWorkContracts(w.id, request);
}

function backToOverview() {
  if (typeof docsClearPreview === 'function') docsClearPreview();
  document.body.classList.remove('inside-mode');

  ++workRequest;
  selectedWork = null;
  currentWorkTab='overview';
  navClear();

  $('work-space').classList.add('hidden');
  $('overview').classList.remove('hidden');
}

$('back-overview').addEventListener('click', () => {
  backToOverview();
  $('editor').classList.add('hidden');
});

$('inside-edit').addEventListener('click', () => {
  if (selectedWork) {
    openEditor(selectedWork);
  }
});

const workTabNames = {
  measurements: [
    'Medições',
    'Os registros e os indicadores serão apresentados após integração das medições desta obra.'
  ],
  schedule: [
    'Cronograma',
    'O cronograma físico-financeiro será integrado em uma próxima etapa.'
  ],
  documents: [
    'Documentos',
    'O envio e a análise de documentos serão implementados em uma próxima etapa.'
  ],
  drawings: [
    'Desenhos',
    'Os desenhos técnicos serão organizados neste módulo.'
  ],
  reports: [
    'Relatórios',
    'Os relatórios serão disponibilizados conforme os módulos forem integrados.'
  ],
  amendments: [
    'Aditivos',
    'Os aditivos contratuais desta obra serão apresentados aqui.'
  ],
  items: [
    'Planilhas e itens',
    'As planilhas e os itens contratuais serão apresentados aqui.'
  ],
  audit: [
    'Eventos e auditoria',
    'Os registros de eventos e auditoria serão apresentados aqui.'
  ],
  info: [
    'Informações',
    'Os dados detalhados da obra serão apresentados aqui.'
  ],
  location: [
    'Localização',
    'A localização da obra será apresentada aqui.'
  ],
  team: [
    'Equipe',
    'Os responsáveis pela obra serão apresentados aqui.'
  ],
  history: [
    'Histórico',
    'O histórico de alterações da obra será apresentado aqui.'
  ]
};

function switchWorkTab(tab) {
  if (!selectedWork) return;
  if(tab==='documents')tab='docs-contratual';
  const docsSection=tab.startsWith('docs-')?tab.slice(5):null;
  const projectSection=tab.startsWith('projects-')?tab.slice(9):null;
  const projectNames={spobras:'Projetos SPOBRAS',enel:'Projetos ENEL',telecom:'Projetos Telecom',comgas:'Projetos Comgás',diversos:'Projetos Diversos'};
  if(projectSection&&!projectNames[projectSection])return;
  if(docsSection && !['licitacao','contratual','ambiental','licencas_alvaras'].includes(docsSection))return;
  currentWorkTab=tab;
  navSave();

  const isDocs=!!docsSection;
  const isProjects=!!projectSection;
  $('projects-menu-toggle').classList.toggle('active',isProjects);
  if(isProjects){$('projects-submenu').classList.remove('hidden');$('projects-menu-toggle').setAttribute('aria-expanded','true');}
  $('docs-menu-toggle').classList.toggle('active',isDocs);
  $('docs-menu-toggle').setAttribute('aria-expanded',String(!$('docs-submenu').classList.contains('hidden')));
  if(isDocs){$('docs-submenu').classList.remove('hidden');$('docs-menu-toggle').setAttribute('aria-expanded','true');}
document.querySelectorAll('[data-work-tab]').forEach(b => {
    b.classList.toggle(
      'active',
      b.dataset.workTab === tab
    );
  });

  for (const id of ['overview', 'contracts', 'documents', 'projects', 'coming']) {
    $('work-tab-' + id).classList.add('hidden');
  }

  if (tab === 'overview' || tab === 'contracts' || isDocs || isProjects) {
    $('work-tab-' + (isDocs?'documents':isProjects?'projects':tab)).classList.remove('hidden');
    if(isProjects){$('projects-section-title').textContent=projectNames[projectSection];$('projects-section-description').textContent='Área de projetos da obra selecionada.';}
    if (isDocs && typeof docsSelectSection==='function') docsSelectSection(docsSection);
  } else {
    $('work-tab-coming').classList.remove('hidden');

    $('coming-title').textContent =
      workTabNames[tab]?.[0] || 'Módulo';

    $('coming-text').textContent =
      workTabNames[tab]?.[1] ||
      'Módulo em desenvolvimento.';
  }

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

$('projects-menu-toggle').addEventListener('click',()=>{const menu=$('projects-submenu');const open=!menu.classList.toggle('hidden');$('projects-menu-toggle').setAttribute('aria-expanded',String(open));});

$('docs-menu-toggle').addEventListener('click',()=>{const menu=$('docs-submenu');const open=!menu.classList.toggle('hidden');$('docs-menu-toggle').setAttribute('aria-expanded',String(open));});

document.querySelectorAll('[data-work-tab]').forEach(b => {
  b.addEventListener('click', () => {
    switchWorkTab(b.dataset.workTab);
  });
});

document.querySelectorAll('[data-go-work-tab]').forEach(b => {
  b.addEventListener('click', () => {
    switchWorkTab(b.dataset.goWorkTab);
  });
});

function formatMoney(n) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(n));
}

function makeContractRow(c) {
  const el = document.createElement('article');
  el.className = 'contract-row';

  const top = document.createElement('div');
  top.className = 'contract-row-top';

  const title = document.createElement('strong');
  title.textContent =
    'Contrato ' + (c.numero || 'sem número');

  const status = document.createElement('span');
  status.className = 'soft-tag';

  status.textContent = ({
    vigente: 'Vigente',
    suspenso: 'Suspenso',
    encerrado: 'Encerrado'
  })[c.status] || c.status || 'Situação não informada';

  top.append(title, status);

  const desc = document.createElement('p');
  desc.textContent = c.objeto || 'Objeto não informado';

  const foot = document.createElement('div');
  foot.className = 'contract-row-foot';

  const company = document.createElement('span');
  company.textContent =
    'Contratada: ' + (c.contratada || 'Não informada');

  const value = document.createElement('strong');
  value.textContent =
    c.valor_inicial == null
      ? 'Valor não informado'
      : formatMoney(c.valor_inicial);

  foot.append(company, value);
  el.append(top, desc, foot);

  return el;
}

async function loadWorkContracts(obraId, request) {
  const { data, error } = await db
    .from('contratos')
    .select(
      'id,numero,contratada,objeto,valor_inicial,status'
    )
    .eq('obra_id', obraId)
    .order('created_at', { ascending: false });

  if (
    request !== workRequest ||
    selectedWork?.id !== obraId
  ) {
    return;
  }

  const list = $('contract-list');
  list.replaceChildren();

  if (error) {
    $('kpi-contract-caption').textContent =
      'Consulta indisponível';

    $('kpi-contract-count').textContent = '—';
    $('kpi-contract-value').textContent = '—';
    $('current-contract-value').textContent = '—';

    list.textContent =
      'Não foi possível consultar os contratos desta obra. Verifique as permissões e a conexão.';

    return;
  }

  const contracts = data || [];

  $('kpi-contract-count').textContent =
    String(contracts.length);

  $('kpi-contract-caption').textContent =
    contracts.length + ' contrato(s) cadastrado(s)';

  if (!contracts.length) {
    $('kpi-contract-value').textContent = '—';
    $('current-contract-value').textContent = '—';

    list.textContent =
      'Nenhum contrato cadastrado para esta obra.';

    return;
  }

  const valid = contracts.filter(
    c =>
      c.valor_inicial !== null &&
      c.valor_inicial !== undefined
  );

  $('kpi-contract-value').textContent =
    valid.length === contracts.length
      ? formatMoney(
          valid.reduce(
            (sum, c) => sum + Number(c.valor_inicial),
            0
          )
        )
      : '—';

  if (valid.length !== contracts.length) {
    $('kpi-contract-caption').textContent =
      'Há contratos sem valor inicial';
  }

  $('current-contract-value').textContent =
    $('kpi-contract-value').textContent;

  contracts.forEach(c => {
    list.append(makeContractRow(c));
  });
}

function openEditor(w = null) {
  backToOverview();

  $('work-form').reset();
  $('work-id').value = '';

  for (const key of [
    'id',
    'codigo',
    'nome',
    'orgao',
    'municipio',
    'uf',
    'status',
    'endereco',
    'descricao'
  ]) {
    const el = $(key === 'id' ? 'work-id' : key);

    if (w && el) {
      el.value = w[key] ?? '';
    }
  }

  $('form-title').textContent =
    w ? 'Editar obra' : 'Nova obra';

  $('editor').classList.remove('hidden');
  $('editor').scrollIntoView({ behavior: 'smooth' });
}

$('new-btn').addEventListener('click', () => openEditor());

$('side-new').addEventListener('click', () => openEditor());

$('cancel-btn').addEventListener('click', () => {
  $('editor').classList.add('hidden');
});

$('work-form').addEventListener('submit', async e => {
  e.preventDefault();

  notice('');

  const values = {
    codigo: $('codigo').value.trim(),
    nome: $('nome').value.trim(),
    orgao: $('orgao').value.trim() || null,
    municipio: $('municipio').value.trim() || null,
    uf: $('uf').value.trim().toUpperCase() || null,
    endereco: $('endereco').value.trim() || null,
    descricao: $('descricao').value.trim() || null,
    status: $('status').value
  };

  if (!values.codigo || !values.nome) {
    notice('Informe código e nome.');
    return;
  }

  const id = $('work-id').value;

  $('save-btn').disabled = true;

  const { error } = id
    ? await db.from('obras').update(values).eq('id', id)
    : await db.from('obras').insert(values);

  $('save-btn').disabled = false;

  if (error) {
    notice('Não foi possível salvar: ' + error.message);
    return;
  }

  $('editor').classList.add('hidden');

  notice('Obra salva com sucesso.');

  await loadWorks();
});

for (const id of [
  'search',
  'filter-status',
  'filter-city',
  'sort'
]) {
  $(id).addEventListener(
    id === 'search' ? 'input' : 'change',
    renderWorks
  );
}

document.querySelectorAll('[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => {
    backToOverview();
    $('editor').classList.add('hidden');

    if (btn.dataset.nav !== 'panel') {
      notice(
        'Este módulo será desenvolvido em uma próxima etapa.'
      );
    } else {
      notice('');
    }
  });
});

$('work-picker').addEventListener('click', backToOverview);

document.querySelectorAll('[data-top-tab]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-top-tab]').forEach(x => {
      x.classList.toggle('active', x === b);
    });

    switchWorkTab(b.dataset.topTab);
  });
});
