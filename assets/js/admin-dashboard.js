(function(){
'use strict';
var CONFIG_URL='../assets/data/site-config.json';
var SALT='stwm-2026-admin-gate';
var EXPECTED_HASH='2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440';
var SESSION_KEY='stwm-admin-unlocked';

async function sha256(t){var b=new TextEncoder().encode(t);var d=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(d)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');}
async function getHandlerUrl(){var c=await fetch(CONFIG_URL+'?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();});return c.orderHandlerUrl;}
async function postAction(data){var url=await getHandlerUrl();var r=await fetch(url,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(data)});var t=await r.text();try{return JSON.parse(t);}catch(e){throw new Error('Server error');}}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function fmtDate(ts){return new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}

// ── Render Gate ──
function renderGate(){
  document.getElementById('app').innerHTML=
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;">'+
    '<div style="background:var(--card);backdrop-filter:var(--blur);border:1px solid var(--glass-border);border-radius:var(--radius);padding:2.5rem 2rem;max-width:400px;width:100%;text-align:center;box-shadow:var(--shadow);">'+
    '<div style="font-size:2.2rem;margin-bottom:0.6rem;">🛡️</div>'+
    '<h1 style="font-family:var(--serif);font-size:1.4rem;font-weight:700;margin:0 0 0.3rem;">Admin Dashboard</h1>'+
    '<p style="font-size:0.88rem;color:var(--muted);margin:0 0 1.25rem;">Enter the admin passphrase to continue.</p>'+
    '<div id="gate-error" style="color:var(--red);font-size:0.82rem;font-weight:600;min-height:1.2rem;margin-bottom:0.4rem;"></div>'+
    '<input type="password" id="gate-input" placeholder="Passphrase" style="width:100%;padding:0.8rem 1rem;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:0.95rem;font-family:inherit;margin-bottom:0.6rem;">'+
    '<button id="gate-btn" style="width:100%;padding:0.85rem;background:linear-gradient(135deg,var(--green),#3a7d3c);color:#fff;border:none;border-radius:var(--radius-sm);font-size:0.95rem;font-weight:600;cursor:pointer;font-family:inherit;">Unlock</button>'+
    '</div></div>';
  var inp=document.getElementById('gate-input'),btn=document.getElementById('gate-btn'),err=document.getElementById('gate-error');
  btn.addEventListener('click',async function(){
    var pass=inp.value;if(!pass){err.textContent='Enter passphrase.';return;}
    btn.textContent='Checking...';
    var hash=await sha256(SALT+pass);
    if(hash===EXPECTED_HASH){try{sessionStorage.setItem(SESSION_KEY,'1');}catch(e){}renderShell();}
    else{err.textContent='Incorrect.';inp.value='';btn.textContent='Unlock';}
  });
  inp.addEventListener('keydown',function(e){if(e.key==='Enter')btn.click();});
}

// ── Auto-unlock ──
try{if(sessionStorage.getItem(SESSION_KEY)==='1'){renderShell();}else{renderGate();}}catch(e){renderGate();}

// ── Shell ──
function renderShell(){
  document.getElementById('app').innerHTML=
    '<header style="background:var(--card);backdrop-filter:var(--blur);border-bottom:1px solid var(--glass-border);padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;">'+
    '<div><h1 style="font-family:var(--serif);font-size:1.15rem;font-weight:700;margin:0;">Admin Dashboard</h1><p style="font-size:0.7rem;color:var(--muted);margin:0.1rem 0 0;">Seed the Word — Inventory, Stats & Messaging</p></div>'+
    '<button id="lock-btn" style="background:var(--glass);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:0.4rem 0.75rem;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:inherit;">Lock</button>'+
    '</header>'+
    '<nav style="display:flex;gap:0.4rem;padding:1rem 1.5rem 0;overflow-x:auto;max-width:900px;margin:0 auto;" id="admin-tabs"></nav>'+
    '<main style="max-width:900px;margin:0 auto;padding:0 1.5rem 3rem;" id="admin-main"></main>';

  document.getElementById('lock-btn').addEventListener('click',function(){
    try{sessionStorage.removeItem(SESSION_KEY);}catch(e){}location.reload();
  });

  var tabs=[
    {id:'stats',label:'📊 Stats',render:renderStats},
    {id:'inventory',label:'📦 Inventory',render:renderInventory},
    {id:'messages',label:'💬 Messages',render:renderMessages},
    {id:'members',label:'👥 Members',render:renderMembers}
  ];
  var activeTab='stats';

  function renderTabs(){
    document.getElementById('admin-tabs').innerHTML=tabs.map(function(t){
      var active=t.id===activeTab?' style="background:var(--card);color:var(--green);border-color:rgba(44,95,46,0.2);box-shadow:0 2px 12px rgba(44,95,46,0.1);"':'';
      return '<button class="adm-tab" data-tab="'+t.id+'"'+active+'>'+t.label+'</button>';
    }).join('');
    document.querySelectorAll('.adm-tab').forEach(function(btn){
      btn.addEventListener('click',function(){activeTab=this.dataset.tab;renderTabs();renderContent();});
    });
  }
  function renderContent(){
    var tab=tabs.find(function(t){return t.id===activeTab;});
    if(tab)tab.render();
  }

  // Inject tab styles
  var style=document.createElement('style');
  style.textContent='.adm-tab{flex:1;padding:0.65rem 0.5rem;background:var(--glass);backdrop-filter:var(--blur);border:1px solid var(--glass-border);border-radius:999px;font-size:0.78rem;font-weight:600;color:var(--muted);cursor:pointer;font-family:inherit;white-space:nowrap;text-align:center;transition:all 0.2s;}.adm-tab:hover{background:var(--card);color:var(--ink);}'+
    '.adm-card{background:var(--card);backdrop-filter:var(--blur);border:1px solid var(--glass-border);border-radius:var(--radius);padding:1.25rem;margin-bottom:1rem;box-shadow:var(--shadow);}'+
    '.adm-stat{background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:1rem;text-align:center;}'+
    '.adm-stat__val{font-family:var(--serif);font-size:1.4rem;font-weight:700;color:var(--gold);}.adm-stat__label{font-size:0.65rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin-top:0.2rem;}'+
    '.adm-table{width:100%;border-collapse:collapse;font-size:0.82rem;}.adm-table th{text-align:left;font-size:0.68rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);padding:0.5rem 0.6rem;border-bottom:1px solid var(--border);}.adm-table td{padding:0.55rem 0.6rem;border-bottom:1px solid var(--border);}.adm-table tr:last-child td{border-bottom:none;}'+
    '.adm-btn{padding:0.5rem 1rem;border:none;border-radius:var(--radius-sm);font-size:0.8rem;font-weight:600;cursor:pointer;font-family:inherit;}.adm-btn--green{background:linear-gradient(135deg,var(--green),#3a7d3c);color:#fff;}.adm-btn--outline{background:var(--glass);border:1px solid var(--border);color:var(--ink2);}'+
    '.adm-btn--sm{padding:0.35rem 0.6rem;font-size:0.72rem;}';
  document.head.appendChild(style);

  renderTabs();
  renderContent();
}

// ── Stats Tab ──
async function renderStats(){
  var main=document.getElementById('admin-main');
  main.innerHTML='<div class="adm-card"><p style="color:var(--muted);text-align:center;">Loading stats...</p></div>';
  try{
    var res=await postAction({action:'getAdminStats',passphrase_hash:EXPECTED_HASH});
    if(!res.ok)throw new Error(res.error||'Failed');
    var html='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.6rem;margin-bottom:1.25rem;">'+
      '<div class="adm-stat"><div class="adm-stat__val">'+esc(res.total_scans||0)+'</div><div class="adm-stat__label">Total Scans</div></div>'+
      '<div class="adm-stat"><div class="adm-stat__val">'+esc(res.total_members||0)+'</div><div class="adm-stat__label">Team Members</div></div>'+
      '<div class="adm-stat"><div class="adm-stat__val">$'+esc((res.total_cost||0).toFixed(2))+'</div><div class="adm-stat__label">Total Value</div></div>'+
      '<div class="adm-stat"><div class="adm-stat__val">'+esc(res.today_scans||0)+'</div><div class="adm-stat__label">Today</div></div>'+
      '</div>';
    if(res.per_member&&res.per_member.length){
      html+='<div class="adm-card"><h3 style="font-size:0.9rem;font-weight:700;margin:0 0 0.75rem;">Per-Member Breakdown</h3>'+
        '<table class="adm-table"><thead><tr><th>Member</th><th>Scans</th><th>Value</th><th>Last Active</th></tr></thead><tbody>';
      res.per_member.forEach(function(m){
        html+='<tr><td><strong>'+esc(m.name)+'</strong></td><td>'+m.scans+'</td><td>$'+m.cost.toFixed(2)+'</td><td>'+esc(m.last_date||'—')+'</td></tr>';
      });
      html+='</tbody></table></div>';
    }
    main.innerHTML=html;
  }catch(e){main.innerHTML='<div class="adm-card"><p style="color:var(--red);">Error: '+esc(e.message)+'</p></div>';}
}

// ── Inventory Tab ──
async function renderInventory(){
  var main=document.getElementById('admin-main');
  main.innerHTML='<div class="adm-card"><p style="color:var(--muted);text-align:center;">Loading inventory...</p></div>';
  try{
    var res=await postAction({action:'getAdminInventory',passphrase_hash:EXPECTED_HASH});
    if(!res.ok)throw new Error(res.error||'Failed');
    if(!res.rows||!res.rows.length){main.innerHTML='<div class="adm-card"><p style="color:var(--muted);text-align:center;">No inventory records.</p></div>';return;}
    var html='<div class="adm-card"><h3 style="font-size:0.9rem;font-weight:700;margin:0 0 0.75rem;">Recent Inventory (last 100)</h3>'+
      '<div style="overflow-x:auto;"><table class="adm-table"><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Member</th><th>Event</th><th>Actions</th></tr></thead><tbody>';
    res.rows.forEach(function(r){
      html+='<tr><td>'+esc(r.date)+'</td><td>'+esc(r.item_name)+'</td><td>'+r.qty+'</td><td>'+esc(r.member)+'</td><td>'+esc(r.event)+'</td>'+
        '<td><button class="adm-btn adm-btn--sm adm-btn--outline inv-edit" data-row="'+esc(r.row_id)+'">✏️</button> '+
        '<button class="adm-btn adm-btn--sm adm-btn--outline inv-del" data-row="'+esc(r.row_id)+'" data-name="'+esc(r.item_name)+'" style="color:var(--red);">×</button></td></tr>';
    });
    html+='</tbody></table></div></div>';
    main.innerHTML=html;
    main.querySelectorAll('.inv-edit').forEach(function(btn){
      btn.addEventListener('click',function(){
        var qty=prompt('New quantity:',1);if(!qty)return;
        postAction({action:'editInventoryRow',token:'admin',passphrase_hash:EXPECTED_HASH,row_id:this.dataset.row,new_qty:parseInt(qty)||1}).then(renderInventory).catch(function(e){alert(e.message);});
      });
    });
    main.querySelectorAll('.inv-del').forEach(function(btn){
      btn.addEventListener('click',function(){
        if(!confirm('Delete "'+this.dataset.name+'"?'))return;
        postAction({action:'adminDeleteInventoryRow',passphrase_hash:EXPECTED_HASH,row_id:this.dataset.row}).then(renderInventory).catch(function(e){alert(e.message);});
      });
    });
  }catch(e){main.innerHTML='<div class="adm-card"><p style="color:var(--red);">Error: '+esc(e.message)+'</p></div>';}
}

// ── Messages Tab ──
async function renderMessages(){
  var main=document.getElementById('admin-main');
  main.innerHTML=
    '<div class="adm-card">'+
    '<h3 style="font-size:0.9rem;font-weight:700;margin:0 0 0.6rem;">Post Announcement</h3>'+
    '<select id="adm-ann-pri" style="width:100%;padding:0.6rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;margin-bottom:0.4rem;font-family:inherit;"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select>'+
    '<input id="adm-ann-subj" placeholder="Subject..." style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;margin-bottom:0.4rem;font-family:inherit;">'+
    '<textarea id="adm-ann-body" placeholder="Message..." rows="3" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;margin-bottom:0.4rem;font-family:inherit;resize:vertical;"></textarea>'+
    '<label style="display:flex;align-items:center;gap:0.4rem;font-size:0.78rem;margin-bottom:0.5rem;cursor:pointer;"><input type="checkbox" id="adm-ann-tg" checked style="width:auto;margin:0;"> Send to Telegram</label>'+
    '<button class="adm-btn adm-btn--green" id="adm-ann-send">Post Announcement</button>'+
    '</div>'+
    '<div class="adm-card"><h3 style="font-size:0.9rem;font-weight:700;margin:0 0 0.5rem;">Recent Announcements</h3><div id="adm-ann-feed"><p style="color:var(--muted);font-size:0.82rem;">Loading...</p></div></div>'+
    '<div class="adm-card"><h3 style="font-size:0.9rem;font-weight:700;margin:0 0 0.5rem;">Edit Requests from Team</h3><div id="adm-edit-requests"><p style="color:var(--muted);font-size:0.82rem;">Loading...</p></div></div>';

  document.getElementById('adm-ann-send').addEventListener('click',async function(){
    var subj=document.getElementById('adm-ann-subj').value.trim();
    var body=document.getElementById('adm-ann-body').value.trim();
    var pri=document.getElementById('adm-ann-pri').value;
    var tg=document.getElementById('adm-ann-tg').checked;
    if(!subj||!body){alert('Fill in subject and message.');return;}
    this.disabled=true;this.textContent='Posting...';
    try{
      // Use passphrase_hash to auth as admin without a token
      await postAction({action:'adminPostAnnouncement',passphrase_hash:EXPECTED_HASH,subject:subj,body:body,priority:pri,send_telegram:tg,author:'Admin'});
      document.getElementById('adm-ann-subj').value='';document.getElementById('adm-ann-body').value='';
      loadAdminAnnouncements();
    }catch(e){alert(e.message);}
    this.disabled=false;this.textContent='Post Announcement';
  });

  loadAdminAnnouncements();
  loadEditRequests();
}

async function loadAdminAnnouncements(){
  var feed=document.getElementById('adm-ann-feed');
  try{
    var res=await postAction({action:'getAnnouncements',passphrase_hash:EXPECTED_HASH});
    if(res.ok&&res.announcements&&res.announcements.length){
      feed.innerHTML=res.announcements.slice(0,20).map(function(a){
        return '<div style="padding:0.6rem 0;border-bottom:1px solid var(--border);"><strong style="font-size:0.85rem;">'+esc(a.subject)+'</strong><span style="font-size:0.68rem;color:var(--muted);margin-left:0.5rem;">'+esc(a.priority)+' · '+esc(a.author)+' · '+fmtDate(a.timestamp)+'</span><p style="font-size:0.82rem;color:var(--ink2);margin:0.25rem 0 0;line-height:1.5;">'+esc(a.body)+'</p></div>';
      }).join('');
    }else{feed.innerHTML='<p style="color:var(--muted);font-size:0.82rem;">No announcements.</p>';}
  }catch(e){feed.innerHTML='<p style="color:var(--red);font-size:0.82rem;">Error.</p>';}
}

async function loadEditRequests(){
  var container=document.getElementById('adm-edit-requests');
  try{
    var res=await postAction({action:'getMemberNotes',passphrase_hash:EXPECTED_HASH,member:'Edit Requests'});
    if(res.ok&&res.notes&&res.notes.length){
      container.innerHTML=res.notes.map(function(n){
        return '<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.82rem;"><strong>'+esc(n.author)+'</strong> · '+fmtDate(n.timestamp)+'<p style="margin:0.2rem 0 0;color:var(--ink2);">'+esc(n.text)+'</p></div>';
      }).join('');
    }else{container.innerHTML='<p style="color:var(--muted);font-size:0.82rem;">No pending edit requests.</p>';}
  }catch(e){container.innerHTML='<p style="color:var(--red);font-size:0.82rem;">Error.</p>';}
}

// ── Members Tab ──
async function renderMembers(){
  var main=document.getElementById('admin-main');
  main.innerHTML='<div class="adm-card"><p style="color:var(--muted);text-align:center;">Loading members...</p></div>';
  try{
    var res=await postAction({action:'getAdminMembers',passphrase_hash:EXPECTED_HASH});
    if(!res.ok)throw new Error(res.error||'Failed');
    if(!res.members||!res.members.length){main.innerHTML='<div class="adm-card"><p style="color:var(--muted);">No members.</p></div>';return;}
    var html='<div class="adm-card"><h3 style="font-size:0.9rem;font-weight:700;margin:0 0 0.75rem;">Team Members</h3>'+
      '<table class="adm-table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Scans</th><th>Actions</th></tr></thead><tbody>';
    res.members.forEach(function(m){
      html+='<tr><td><strong>'+esc(m.name)+'</strong></td><td>'+esc(m.role)+'</td><td>'+esc(m.email||'—')+'</td><td>'+m.scans+'</td>'+
        '<td><select class="role-select" data-name="'+esc(m.name)+'" style="padding:0.3rem;font-size:0.72rem;border-radius:6px;border:1px solid var(--border);">'+
        '<option value="member"'+(m.role==='member'?' selected':'')+'>Member</option>'+
        '<option value="admin"'+(m.role==='admin'?' selected':'')+'>Admin</option>'+
        '<option value="super_admin"'+(m.role==='super_admin'?' selected':'')+'>Super Admin</option>'+
        '</select></td></tr>';
    });
    html+='</tbody></table></div>';
    main.innerHTML=html;
    main.querySelectorAll('.role-select').forEach(function(sel){
      sel.addEventListener('change',function(){
        var name=this.dataset.name,role=this.value;
        postAction({action:'setMemberRole',passphrase_hash:EXPECTED_HASH,member_name:name,new_role:role}).then(function(){alert('Role updated.');}).catch(function(e){alert(e.message);});
      });
    });
  }catch(e){main.innerHTML='<div class="adm-card"><p style="color:var(--red);">Error: '+esc(e.message)+'</p></div>';}
}

})();
