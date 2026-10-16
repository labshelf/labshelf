document.querySelector('.tsw').addEventListener('click',e=>{const b=e.target.closest('[data-th]');if(!b)return;
  b.dataset.th?document.documentElement.dataset.theme=b.dataset.th:delete document.documentElement.dataset.theme;
  b.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));});

document.addEventListener('keydown',e=>{if(/^(Tab|Arrow|Home|End)/.test(e.key))document.documentElement.classList.add('kbd');},true);
document.addEventListener('pointerdown',()=>document.documentElement.classList.remove('kbd'),true);

const C=2*Math.PI*5;
const arc=p=>p<=0?'<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="2.5" fill="currentColor" opacity=".7"/></svg>':`<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25"/>${p>0?`<circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="${(Math.min(p,1)*C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 6 6)"/>`:''}</svg>`;
const tone=p=>p>=1?'ok':p>0?'accent':'';
const NAME=p=>p>=1?'Done':p>0?'Reading':'Unread';
const mk=p=>`<i class="mk" ${tone(p)?`data-t="${tone(p)}"`:''}>${arc(p)}</i>`;
const I=(d,cls='i')=>`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const CHEV='<path d="m6 9 6 6 6-6"/>',COPY='<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',CHEVR='<path d="m9 18 6-6-6-6"/>';
const BOOK='<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>';
const PFOLD='<path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"/><path d="M15 2v3a1 1 0 0 0 1 1h4"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/><path d="M10.5 10h5"/><path d="M10.5 13.5h5"/>';
const TY={pdf:'PDF',md:'MD',dir:I('<path d="m9 18 6-6-6-6"/>'),add:I('<path d="M5 12h14"/><path d="M12 5v14"/>')};
const ty=k=>`<span class="ty" data-k="${k}" aria-hidden="true">${TY[k]}</span>`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const key=x=>(x[1][0].split(' ').pop()+x[2]).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g,'');

let sel=0,scope='all',q='',sort={col:'read',dir:'descending'},open=new Set([0]),tab='details',cfmt='BibTeX',showAll=false,hlFilter=null,adding=false;
const folded=new Set(),gfold=new Set();
const closed=new Set(['cited','cite','file']);

const fi=i=>FOLD.findIndex(f=>f[0]===P[i][9]);
const headless=()=>scope.startsWith('f:')&&!FOLD.some(f=>f[0].startsWith(scope.slice(2)+'/'));
const isFolded=f=>!headless()&&gfold.has(f);
function visible(){
  let v=P.map((x,i)=>i).filter(i=>{const x=P[i];
    if(scope.startsWith('s:')&&String(x[7])!==scope.slice(2).replace(/^\./,'0.')&&!(scope==='s:.5'&&x[7]===.5))return false;
    if(scope.startsWith('f:')&&x[9]!==scope.slice(2)&&!x[9].startsWith(scope.slice(2)+'/'))return false;
    return !q||(x[0]+x[1].join(' ')+x[2]+x[3]+x[10].join(' ')+x[11].join(' ')).toLowerCase().includes(q);});
  const get={title:x=>x[0].toLowerCase(),authors:x=>x[1][0].split(' ').pop(),year:x=>x[2],read:x=>-x[6],status:x=>x[7]}[sort.col];
  v.sort((a,b)=>{const A=get(P[a]),B=get(P[b]);return fi(a)-fi(b)||(A>B?1:A<B?-1:0)*(sort.dir==='ascending'?1:-1);});
  return v;
}
function heads(){
  document.getElementById('heads').innerHTML='<span></span>'+COLS.map(([k,n,r])=>`<button class="${r||''}" data-sort="${k}" aria-sort="${sort.col===k?sort.dir:'none'}" title="Sort by ${n}">${n}${I(CHEV)}</button>`).join('');
}
function crumb(){
  const label=scope==='all'?'All papers':scope.startsWith('s:')?NAME(+scope.slice(2)):scope.slice(2).split('/').pop();
  const segs=scope.slice(2).split('/'),total=parseInt(document.querySelector(`[data-scope="${scope}"]`).querySelector('.d').textContent),shown=visible().length;
  const sep=`<span class="sep" aria-hidden="true">${I(CHEVR)}</span>`;
  const path=scope.startsWith('f:')?['Library',...segs.slice(0,-1)].map((n,k)=>`<button class="up" data-up="${k?esc('f:'+segs.slice(0,k).join('/')):'all'}" title="${k?'Open '+esc(n):'All papers'}">${esc(n)}</button>${sep}`).join(''):'';
  document.getElementById('crumb').innerHTML=`<nav aria-label="Folder path" style="display:contents">${path}<b aria-current="page">${esc(label)}</b></nav><span class="count">${q?shown+' / ':''}${total}</span>`;
}
// Section header: the folder path relative to the scope (the scope itself shows its own name); more than three segments keep the first and last two.
function groupHead(f,n){
  const full=f.split('/'),sp=scope.startsWith('f:')?scope.slice(2):'',skip=!sp?0:f===sp?full.length-1:sp.split('/').length,c=isFolded(f);
  let it=full.slice(skip).map((name,k)=>({name,to:full.slice(0,skip+k+1).join('/')}));
  if(it.length>3)it=[it[0],{name:'…'},...it.slice(-2)];
  const gsep=`<span class="gsep" aria-hidden="true">${I(CHEVR)}</span>`;
  return `<div class="gh" role="row" data-g="${esc(f)}" title="${esc(full.join(' › '))}"><button class="tw" aria-expanded="${!c}" tabindex="-1" aria-label="${c?'Expand':'Collapse'} ${esc(full.at(-1))}">${I(CHEV)}</button><div class="gl">${it.map((s,k)=>(k?gsep:'')+(s.to?`<button class="gs${k===it.length-1?' lf':''}" data-folder="${esc(s.to)}">${esc(s.name)}</button>`:`<span class="gs">${s.name}</span>`)).join('')}<span class="gc">${n}</span></div></div>`;
}
function rowHtml(i,z){const x=P[i],exp=open.has(i);
  return `<div class="row${i===sel?' sel':''}${z?' z':''}${exp?' op':''}" role="row" tabindex="${i===sel?0:-1}" aria-selected="${i===sel}" aria-expanded="${exp}" data-i="${i}" title="${esc(x[0])}">
      <button class="tw" aria-expanded="${exp}" tabindex="-1" title="${exp?'Hide':'Show'} files" aria-label="${exp?'Hide':'Show'} files">${I(CHEV)}</button>
      <span class="cell title"><span class="t">${esc(x[0])}</span></span>
      <span class="cell m">${esc(x[1][0].split(' ').pop())}${x[1].length>1?' et al.':''}</span>
      <span class="cell m n l">${x[2]}</span>
      <span class="cell m n l">${x[5]||'–'}</span>
      <span class="c"><button class="stat" tabindex="-1" data-cycle="${i}" title="${NAME(x[7])}. Click to change (Alt 1, 2, 3)" aria-label="Status: ${NAME(x[7])}">${mk(x[7])}</button></span></div>`+(exp?files(x,i,z):'');
}
// A scope's own papers come first, unlabelled and flush: the path above already names their folder.
const own=f=>scope==='f:'+f;
function render(){
  heads();crumb();
  const v=visible(),hl=headless(),counts={};let html='',cur=null,k=0;
  v.forEach(i=>counts[P[i][9]]=(counts[P[i][9]]||0)+1);
  v.forEach(i=>{const f=P[i][9];
    if(f!==cur){html+=(cur===null?'':'</div>')+(own(f)||hl?'<div class="grp" role="rowgroup">':'<div class="grp ind" role="rowgroup">'+groupHead(f,counts[f]));cur=f;k=0;}
    if(!isFolded(f))html+=rowHtml(i,k++%2===0);});
  html+=cur===null?'':'</div>';
  document.getElementById('tbl').classList.toggle('ind',!hl&&!v.some(i=>own(P[i][9])));
  document.getElementById('rows').innerHTML=html||`<div class="empty">No papers match “${esc(q)}”. <button class="lnk" id="clearq">Clear search</button></div>`;
  detail();sideMarks();
}
const ROLE=(n,k)=>k==='dir'?'Folder':k==='md'?'Note':n==='paper.pdf'?'Paper':'Attachment';
// A file row says what is in the file, in words: what you last marked in the paper, how the note begins, what an attachment contains, where code comes from.
// One small label, then the text running to the actions; never counts or progress, never in the paper's columns.
const SIDE='<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',FOLDI='<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>';
function facts(x,i,name,k){
  const say=(lab,txt)=>`<span class="lab">${lab}</span><span class="say">${esc(txt)}</span>`;
  if(name==='paper.pdf'){const h=LASTHL[i];return h?say('Last highlight · p. '+h[1],'“'+h[0]+'”'):say('Abstract',ABS.split('. ')[0]+'.');}
  if(k==='md')return NOTE[i]?say('Note',NOTE[i]):say('Note','Empty');
  if(ABOUT[name])return say(k==='dir'?'Source':'Contents',ABOUT[name]);
  return '';
}
function files(x,i,z){
  const acts=k=>`<span class="acts">${k==='dir'?'':`<button class="fa" data-act="Opened to the side" title="Open to the side" aria-label="Open to the side">${I(SIDE)}</button>`}<button class="fa" data-act="Revealed in Finder" title="Reveal in folder" aria-label="Reveal in folder">${I(FOLDI)}</button><button class="fa" data-act="Path copied" title="Copy path" aria-label="Copy path">${I(COPY)}</button></span>`;
  const f=(name,size,k,when,act)=>`<div class="frow" role="button" tabindex="-1" data-act="${act}" data-p="${i}" title="${esc(ROLE(name,k)+' · '+size+(when?' · '+when:''))}"><span class="nm">${ty(k)}<span>${name}${k==='dir'?'/':''}</span></span><span class="facts">${facts(x,i,name,k)}</span>${acts(k)}</div>`;
  return `<div class="files${z?' z':''}" role="group" aria-label="Files of ${esc(x[0])}">${f('paper.pdf',x[13]+' pp','pdf',x[5],'Opened paper.pdf in the reader')}${x[15].map(g=>f(g[0],g[1],g[2],g[3],'Opened '+g[0])).join('')}<div class="frow add" role="button" tabindex="-1" data-act="Choose a file to add" data-p="${i}" title="Add a file to this paper"><span class="nm">${ty('add')}<span>Add file</span></span></div></div>`;
}
function fold(id,title,count,body){return `<div class="fold${closed.has(id)?' closed':''}" data-fold="${id}"><button class="sec" aria-expanded="${!closed.has(id)}">${I(CHEV)}${title}${count?`<span class="c">${count}</span>`:''}</button><div class="fb">${body}</div></div>`;}
function citation(x){const k=key(x);return cfmt==='BibTeX'
  ?`@inproceedings{${k},\n  title  = {${x[0]}},\n  author = {${x[1].slice(0,3).join(' and ')} and others},\n  booktitle = {${x[4]}},\n  year   = {${x[2]}}\n}`
  :cfmt==='APA'?`${x[1].slice(0,3).map(a=>{const s=a.split(' ');return s.pop()+', '+s.map(n=>n[0]+'.').join(' ');}).join(', ')}, et al. (${x[2]}). ${x[0]}. ${x[4]}.`
  :`\\cite{${k}}`;}
function detailsTab(x){
  const abs=ABS;
  const doi=`10.48550/arXiv.${1700+x[2]%100}.0${3762+x[6]}`,path=`~/Research/library/${x[9]}/${key(x)}/`;
  const cp=(v,lab)=>`<button class="ib" data-act="${lab} copied" title="Copy ${lab}" aria-label="Copy ${lab}">${I(COPY)}</button>`;
  return fold('abstract','Abstract','',`<p class="abs">${showAll?abs:abs.slice(0,260)+'…'}</p><div style="display:flex;gap:12px;margin-top:6px"><button class="lnk" id="more">${showAll?'Show less':'Show more'}</button><button class="lnk" data-act="Abstract copied">Copy</button></div>`)
   +fold('keywords','Keywords',x[11].length,`<div class="kw">${x[11].map(k=>`<button data-search="${esc(k)}" title="Search “${esc(k)}”">${esc(k)}</button>`).join('<span class="sep" aria-hidden="true">·</span>')}</div>`)
   +fold('info','Info','',`<dl class="kv">
      <dt>Publication</dt><dd>${esc(x[4])}</dd><dt>Year</dt><dd>${x[2]}</dd>
      <dt>Pages</dt><dd class="mono">${x[13]}</dd>
      <dt>DOI</dt><dd><button class="lnk mono" data-act="Opened doi.org">${doi}</button>${cp(doi,'DOI')}</dd>
      <dt>Cite key</dt><dd class="mono">${key(x)}${cp(key(x),'cite key')}</dd>
      <dt>Folder</dt><dd><button class="lnk" data-scope-go="f:${esc(x[9])}" title="Show this folder">${esc(x[9].split('/').join(' › '))}</button></dd></dl>`)
   +(x[7]>=1?fold('cited','Cited in',2,`<div class="cin"><button data-act="Opened intro.tex:42">transformer-ablation · 1 Introduction<span class="n">intro.tex:42</span></button><button data-act="Opened method.tex:18">transformer-ablation · 3 Method<span class="n">method.tex:18</span></button></div>`):'')
   +fold('cite','Cite','',`<div class="cfmt" role="group" aria-label="Citation format">${['BibTeX','APA','LaTeX'].map(f=>`<button aria-pressed="${f===cfmt}" data-fmt="${f}">${f}</button>`).join('')}</div><pre class="cite">${esc(citation(x))}</pre><button class="btn" data-act="${cfmt} copied">${I(COPY)}Copy ${cfmt}</button>`)
   +fold('file','File','',`<dl class="kv">
      <dt>PDF</dt><dd><button class="lnk" data-act="Opened in the reader">paper.pdf</button><span class="m mono">2.1 MB</span></dd>
      <dt>Text</dt><dd>Searchable</dd>
      <dt>Last read</dt><dd>${x[5]?esc(x[5])+' · p. '+x[12]+' of '+x[13]:'Never opened'}</dd>
      <dt>Location</dt><dd class="mono" style="color:var(--vscode-descriptionForeground)">${esc(path)}</dd></dl>
      <div class="tools" style="margin-top:10px"><button class="btn" data-act="Opened in the default PDF app">Open in default app</button><button class="btn ghost" data-act="Path copied">${I(COPY)}Copy path</button><button class="btn ghost" data-act="Revealed in Finder">${I(CHEVR)}Reveal in folder</button></div>`);
}
function annotationsTab(x){
  if(!x[8])return `<div class="placeholder">No highlights yet. Select text in the reader to highlight it.<div style="margin-top:10px"><button class="btn primary" data-act="Opened in the reader">Open PDF</button></div></div>`;
  const A=[[1,'--warn','The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.','2 h'],[1,'--reading','We propose a new simple network architecture, the Transformer.','2 h'],[2,'--ok','Self-attention, sometimes called intra-attention, relates different positions of a single sequence.','1 d'],[5,'--err','We suspect that for large values of d_k, the dot products grow large in magnitude.','3 d']];
  let h=`<div class="swatches">${HL.map(([c,n])=>`<button class="sw" style="--c:var(${c})" aria-pressed="${hlFilter===c}" data-hl="${c}" title="Only ${n}" aria-label="Only ${n} highlights"></button>`).join('')}<button class="lnk" data-act="Highlights copied as Markdown">Copy all</button><button class="lnk" data-act="Exported to Markdown file">Export</button></div>`,pg=0;
  A.filter(a=>!hlFilter||a[1]===hlFilter).forEach(a=>{if(a[0]!==pg){pg=a[0];h+=`<div class="pg">Page ${pg}</div>`;}h+=`<button class="card" style="--c:var(${a[1]})" data-act="Opened at page ${a[0]}"><p>${a[2]}</p><small>p. ${a[0]} · ${a[3]}</small></button>`;});
  return h;
}
function notesTab(){return `<textarea id="note" aria-label="Note">Baseline for the ablation. Compare head count against §3.2 of thesis draft.</textarea><div class="nbtns"><button class="btn" data-act="Highlights inserted">Insert highlights</button><button class="btn" data-act="Note copied">${I(COPY)}Copy note</button></div><div class="m" style="padding:10px 16px;font-size:12px">Saved with the paper.</div>`;}
function relatedTab(x){
  const row=(i,n)=>`<button data-go="${i}" title="Click to select, double-click to open">${mk(P[i][7])}<span class="cell">${esc(P[i][0])}</span><span class="n">${n}</span></button>`;
  return `<div class="pg">Similar content</div><div class="rel">${row(7,'82%')}${row(1,'74%')}${row(9,'61%')}</div><div class="pg">Same authors</div><div class="rel">${row(5,'Brown')}</div><div class="pg">Shared tags &amp; keywords</div><div class="rel">${row(2,'nlp')}${row(4,'architecture')}</div>`;
}
function detail(){
  const x=P[sel],d=document.getElementById('detail');
  if(!x){d.innerHTML='<div class="placeholder">Select a paper to see its details.</div>';return;}
  const au=x[1].length>3&&!showAll?x[1].slice(0,3):x[1];
  const body={details:detailsTab,annotations:annotationsTab,notes:notesTab,related:relatedTab}[tab](x);
  d.innerHTML=`<div class="head">
    <button class="ib" id="moreMenu" title="More actions" aria-label="More actions" aria-haspopup="menu">${I('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>')}</button>
    <div class="hgroup"><h3>${esc(x[0])}</h3>
    <div class="by">${au.map(a=>`<button data-search="${esc(a.split(' ').pop())}" title="Search papers by ${esc(a)}">${esc(a)}</button>`).join(', ')}${x[1].length>3?` <button class="more" id="authors">${showAll?'less':'+'+(x[1].length-3)+' more'}</button>`:''}</div>
    <div class="metaline">${esc(x[3])} ${x[2]} · ${x[14]==='preprint'?'Preprint':'Accepted'} · <button class="fl" data-act="Choose a folder" title="Move to folder… (currently ${esc(x[9].split('/').join(' › '))})">${I(CHEVR)}${esc(x[9].split('/').at(-1))}</button></div></div>
    <div class="tools">
      <button class="btn primary" data-act="Opened in the reader">${I(BOOK)}${x[7]>0&&x[7]<1?'Continue · p. '+x[12]:'Open PDF'}</button>
      <button class="btn ghost" id="citeMenu" title="Copy a citation" aria-haspopup="menu">Cite${I(CHEV,'i sm')}</button>
    </div>
    <div class="statusrow">
      <button class="btn ghost" id="statusMenu" title="Change status (Alt 1, 2, 3)" aria-haspopup="menu">${mk(x[7])}${NAME(x[7])}${I(CHEV,'i sm')}</button>
      <div class="tags">${x[10].map(t=>`<span class="tag"><span class="tn"><i>#</i>${esc(t)}</span><button data-untag="${esc(t)}" title="Remove tag ${esc(t)}" aria-label="Remove tag ${esc(t)}">${I('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')}</button></span>`).join('')}${adding?'<span class="tag"><i>#</i><input id="tagin" placeholder="new tag" aria-label="Add tag"></span>':`<button class="tagadd" id="tagadd" title="Add tag" aria-label="Add tag">${I('<path d="M5 12h14"/><path d="M12 5v14"/>')}</button>`}</div>
    </div>
  </div>
  <div class="dtabs" role="tablist">${[['details','Details',''],['annotations','Annotations',x[8]?`<span class="badge">${x[8]}</span>`:''],['notes','Notes',sel===0?'<span class="dot" title="Has a note"></span>':''],['related','Related','<span class="badge">5</span>']].map(([k,n,b])=>`<button role="tab" aria-selected="${tab===k}" data-tab="${k}">${n}${b}</button>`).join('')}</div>
  <div class="tabbody" role="tabpanel">${body}</div>`;
}

let tt;function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),1500);}
const setStatus=(i,p)=>{P[i][7]=p;toast(`Marked as ${NAME(p)}`);};
const cycle=i=>setStatus(i,P[i][7]>=1?0:P[i][7]>0?1:.5);
const focusSel=()=>document.querySelector('.row.sel')?.focus();
const select=i=>{if(sel!==i){sel=i;showAll=false;adding=false;}render();focusSel();};

// Paper menu.
const menuEl=document.getElementById('menu');
const it=(l,k='',act=l,extra='')=>`<button role="menuitem" data-act="${act}" ${extra}><span class="ck">${I('<path d="M20 6 9 17l-5-5"/>')}</span>${l}${k?`<kbd>${k}</kbd>`:''}</button>`;
const statusItems=()=>[0,.5,1].map((s,k)=>`<button role="menuitemradio" aria-checked="${P[sel][7]===s}" data-set="${s}"><span class="ck">${I('<path d="M20 6 9 17l-5-5"/>')}</span>${mk(s)}${NAME(s)}<kbd>⌥${k+1}</kbd></button>`).join('');
const citeItems=()=>it('Copy Cite Key','⌘C','Cite key copied')+it('Copy BibTeX','','BibTeX copied')+it('Copy APA Reference','','APA copied');
function openMenu(x,y,html){
  const p=P[sel][7];
  menuEl.innerHTML=html||it(P[sel][7]>0&&P[sel][7]<1?'Continue Reading':'Open PDF','Enter','Opened in the reader')+it('Open in Default PDF App')+it('Find Published Version…')+'<hr>'
   +citeItems()+'<hr>'
   +[0,.5,1].map((s,k)=>it('Mark as '+NAME(s),'⌥'+(k+1),'',`role="menuitemradio" aria-checked="${p===s}" data-set="${s}"`)).join('')+'<hr>'
   +it('Add Tag…','','Type a tag')+it('Move to…','','Choose a folder')+it('Reveal Folder','','Revealed in Finder')+it('Fetch Metadata Online')+it('Export Annotations…')+'<hr>'
   +it('Remove from Library…','⌘⌫','Asks before removing','class="danger"');
  menuEl.hidden=false;menuEl.style.minWidth=html?'200px':'';const r=menuEl.getBoundingClientRect();
  menuEl.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';menuEl.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';
  menuEl.querySelector('button').focus();
}
const closeMenu=()=>{if(!menuEl.hidden){menuEl.hidden=true;focusSel();}};
menuEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.set!==undefined){setStatus(sel,+b.dataset.set);render();}else toast(b.dataset.act);closeMenu();});
menuEl.addEventListener('keydown',e=>{const items=[...menuEl.querySelectorAll('button')],k=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown')items[(k+1)%items.length].focus();else if(e.key==='ArrowUp')items[(k-1+items.length)%items.length].focus();else if(e.key==='Escape')closeMenu();else return;e.preventDefault();});
document.addEventListener('mousedown',e=>{if(!e.target.closest('#menu'))menuEl.hidden=true;});

// Table.
const rows=document.getElementById('rows');
rows.addEventListener('click',e=>{
  const gh=e.target.closest('.gh');
  if(gh){const sb=e.target.closest('.gs[data-folder]');if(sb)setScope('f:'+sb.dataset.folder);else if(e.target.closest('.tw')){const f=gh.dataset.g;gfold.has(f)?gfold.delete(f):gfold.add(f);render();}return;}
  if(e.target.id==='clearq'){document.getElementById('q').value='';q='';render();return;}
  const fa=e.target.closest('.fa');if(fa){toast(fa.dataset.act);return;}
  const chip=e.target.closest('.frow');if(chip){toast(chip.dataset.act);return;}
  const r=e.target.closest('.row');if(!r)return;const i=+r.dataset.i;
  if(e.target.closest('.tw')){open.has(i)?open.delete(i):open.add(i);}
  else if(e.target.closest('[data-cycle]'))cycle(i);
  select(i);
});
rows.addEventListener('dblclick',e=>{const r=e.target.closest('.row');if(r&&!e.target.closest('button'))toast('Opened in the reader');});
rows.addEventListener('contextmenu',e=>{const r=e.target.closest('.row');if(!r)return;e.preventDefault();select(+r.dataset.i);openMenu(e.clientX,e.clientY);});
rows.addEventListener('keydown',e=>{
  const r=e.target.closest('.row');if(!r||e.target!==r)return;const i=+r.dataset.i,v=visible().filter(j=>!isFolded(P[j][9])),k=v.indexOf(i);
  if(e.altKey&&['1','2','3'].includes(e.key)){setStatus(i,[0,.5,1][+e.key-1]);}
  else if(e.key==='ArrowDown'&&k<v.length-1)sel=v[k+1];else if(e.key==='ArrowUp'&&k>0)sel=v[k-1];
  else if(e.key==='Home')sel=v[0];else if(e.key==='End')sel=v[v.length-1];
  else if(e.key==='ArrowRight')open.add(i);else if(e.key==='ArrowLeft')open.delete(i);
  else if(e.key==='Enter'){toast('Opened in the reader');return;}
  else if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const b=r.getBoundingClientRect();openMenu(b.left+40,b.bottom);return;}
  else return;
  e.preventDefault();select(sel);
});
document.getElementById('heads').addEventListener('click',e=>{const b=e.target.closest('[data-sort]');if(!b)return;const c=b.dataset.sort;
  sort=sort.col===c?{col:c,dir:sort.dir==='ascending'?'descending':'ascending'}:{col:c,dir:['year','read'].includes(c)?'descending':'ascending'};render();});
const qi=document.getElementById('q');
qi.addEventListener('input',e=>{q=e.target.value.toLowerCase();render();});
qi.addEventListener('keydown',e=>{if(e.key==='Escape'){qi.value='';q='';render();focusSel();}else if(e.key==='ArrowDown'){e.preventDefault();focusSel();}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();qi.focus();}});
const search=t=>{qi.value=t;q=t.toLowerCase();render();toast(`Searching “${t}”`);};

// Side bar scopes: the folder tree, each folder's subfolders first, then its papers.
const par=p=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';
const papersIn=p=>P.map((x,i)=>i).filter(i=>P[i][9]===p).sort((a,b)=>P[a][0].localeCompare(P[b][0]));
const paperLi=(i,d)=>`<li class="pp" style="--dp:${d}" data-paper="${i}" data-in="${esc(P[i][9])}" title="${esc(P[i][0])}. Click to show it in the list"><span class="ty" data-k="ref">REF</span><span class="pt">${esc(P[i][0])}</span></li>`;
function node([p,n]){const sg=p.split('/'),subs=FOLD.filter(f=>par(f[0])===p),pp=papersIn(p),kid=subs.length||pp.length;
  return `<li${kid?'':' class="leaf"'} style="--dp:${sg.length-1}" data-scope="f:${esc(p)}">${kid?`<button class="twi" aria-expanded="true">${I(CHEVR)}</button>`:I(CHEVR)}${esc(sg.at(-1))}<span class="d">${n}</span></li>`+subs.map(node).join('')+pp.map(i=>paperLi(i,sg.length)).join('');}
document.getElementById('scopes').insertAdjacentHTML('beforeend',FOLD.filter(f=>!par(f[0])).map(node).join(''));
function tree(){document.querySelectorAll('#scopes li[data-scope^="f:"],#scopes li[data-in]').forEach(li=>{const fp=li.dataset.in,p=(fp??li.dataset.scope.slice(2)).split('/'),t=li.querySelector('.twi');
  li.hidden=p.slice(0,fp?p.length:p.length-1).some((_,k)=>folded.has(p.slice(0,k+1).join('/')));
  if(t){const o=!folded.has(p.join('/'));t.setAttribute('aria-expanded',o);t.setAttribute('aria-label',(o?'Collapse ':'Expand ')+p.at(-1));}});}
function setScope(s){scope=s;if(s.startsWith('f:')){const p=s.slice(2).split('/');p.forEach((_,k)=>folded.delete(p.slice(0,k).join('/')));tree();}document.querySelectorAll('[data-scope]').forEach(li=>li.setAttribute('aria-current',li.dataset.scope===s));const v=visible();if(!v.includes(sel)&&v.length)sel=v[0];render();}
document.getElementById('scopes').addEventListener('click',e=>{const pl=e.target.closest('[data-paper]');if(pl){reveal(+pl.dataset.paper);return;}
  const li=e.target.closest('[data-scope]');if(!li)return;
  if(e.target.closest('.twi')){const p=li.dataset.scope.slice(2);folded.has(p)?folded.delete(p):folded.add(p);tree();}else setScope(li.dataset.scope);});
document.querySelectorAll('.side .mk').forEach(m=>{m.innerHTML=arc(+m.dataset.p);});
document.querySelectorAll('.side .view>.vh').forEach(b=>b.addEventListener('click',()=>b.parentElement.classList.toggle('closed')));

// Details.
const det=document.getElementById('detail');
det.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;const d=t.dataset;
  if(d.tab){tab=d.tab;detail();det.querySelector(`[data-tab="${tab}"]`).focus();}
  else if(t.id==='tagadd'){adding=true;detail();det.querySelector('#tagin').focus();}
  else if(t.closest('.fold')&&t.classList.contains('sec')){const id=t.parentElement.dataset.fold;closed.has(id)?closed.delete(id):closed.add(id);detail();}
  else if(d.fmt){cfmt=d.fmt;detail();}
  else if(d.hl){hlFilter=hlFilter===d.hl?null:d.hl;detail();}
  else if(d.untag){P[sel][10]=P[sel][10].filter(x=>x!==d.untag);detail();toast(`Removed tag ${d.untag}`);}
  else if(d.search)search(d.search);
  else if(d.scopeGo)setScope(d.scopeGo);
  else if(d.go)select(+d.go);
  else if(t.id==='more'||t.id==='authors'){showAll=!showAll;detail();}
  else if(t.id==='statusMenu'){const b=t.getBoundingClientRect();openMenu(b.left,b.bottom+4,statusItems());}
  else if(t.id==='citeMenu'){const b=t.getBoundingClientRect();openMenu(b.left,b.bottom+4,citeItems());}
  else if(t.id==='moreMenu'){const b=t.getBoundingClientRect();openMenu(b.left,b.bottom+4);}
  else if(d.act)toast(d.act);
});
det.addEventListener('dblclick',e=>{if(e.target.closest('[data-go]'))toast('Opened in the reader');});
det.addEventListener('keydown',e=>{const t=e.target;
  if(t.id==='tagin'){if(e.key==='Escape'){adding=false;detail();det.querySelector('#tagadd').focus();}
    else if((e.key==='Enter'||e.key===',')&&t.value.trim()){e.preventDefault();P[sel][10].push(t.value.trim().toLowerCase());detail();det.querySelector('#tagin').focus();}
    else if(e.key==='Backspace'&&!t.value&&P[sel][10].length){P[sel][10].pop();detail();det.querySelector('#tagin').focus();}}
  else if(t.closest('[role=tablist]')&&/Arrow(Left|Right)/.test(e.key)){const ks=['details','annotations','notes','related'];tab=ks[(ks.indexOf(tab)+(e.key==='ArrowRight'?1:3))%4];detail();det.querySelector(`[data-tab="${tab}"]`).focus();}
});
det.addEventListener('focusout',e=>{if(e.target.id==='tagin'&&!e.target.value&&adding){adding=false;detail();}});
document.getElementById('dtoggle').addEventListener('click',e=>{const on=document.getElementById('app').classList.toggle('nodetail');e.currentTarget.setAttribute('aria-pressed',!on);e.currentTarget.title=on?'Show details':'Hide details';});
document.getElementById('crumb').addEventListener('click',e=>{const b=e.target.closest('[data-up]');if(!b)return;b.dataset.up==='all'||b.dataset.up.startsWith('f:')?setScope(b.dataset.up==='all'?'all':b.dataset.up):toast('Opened '+b.dataset.up);});
document.getElementById('add').addEventListener('click',()=>toast('Drop a PDF, or paste a DOI or arXiv link'));

// A paper in the side bar tree: select it in the list with its files open. If the scope or search hides it, go to its folder first.
function sideMarks(){document.querySelectorAll('#scopes li.pp').forEach(li=>{const i=+li.dataset.paper;li.setAttribute('aria-selected',i===sel);});}
function reveal(i){
  if(!visible().includes(i)){if(q){q='';qi.value='';}if(!visible().includes(i))scope='f:'+P[i][9];}
  gfold.delete(P[i][9]);open.add(i);sel=i;showAll=false;adding=false;setScope(scope);
  const r=document.querySelector(`.row[data-i="${i}"]`);if(r){r.focus({preventScroll:true});r.scrollIntoView({block:'nearest'});const f=r.nextElementSibling;if(f?.classList.contains('files'))f.scrollIntoView({block:'nearest'});}
}
render();
