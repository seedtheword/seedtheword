(function(){
'use strict';

// ── Config ──
var CONFIG_URL='assets/data/site-config.json';
var TYPES=[['Pocket Personal Testimony Gideon Red','pocket-nt-red'],['Pocket Friend of Gideon Grey','pocket-nt-grey'],['Pocket Spanish Gideon','pocket-nt-spanish'],['Large Print Gideon Brown','large-print-nt-brown'],['Pocket Hindi Gideon','pocket-nt-hindi-blue'],['Large Print Russian','large-print-nt-russian'],['Large Print Ukranian','large-print-nt-ukrainian'],['Pocket Farsi Persian','pocket-nt-farsi-blue'],['Full Bible Large Print','full-bible-large-print'],['Full Bible Pocket','full-bible-pocket'],['Large Print Thai + English Gideon','pocket-nt-thai-english-blue'],['Pocket Mandarin Gideon','pocket-nt-mandarin'],['Large Print Urdu Gideon','large-print-nt-urdu-blue'],['Large Print Spanish + English Gideon','large-print-nt-spanish-english'],['Large Print Arabic + English','large-print-nt-arabic-english'],['Pocket Arabic','pocket-nt-arabic'],['Pocket French Gideon','pocket-nt-french'],['Life Book English','tract-life-book-english'],['Life Book Spanish','tract-life-book-spanish'],['Flip Books','tract-flip-books-english'],['Notebooks & Pens','merch-notebooks-pens'],['Keychains & Bracelets','merch-keychains-bracelets'],['Stickers','merch-stickers'],['Mini Jesus figurines','merch-mini-fig'],['Bookmarks','merch-bookmarks']];
function findType(id){for(var i=0;i<TYPES.length;i++){if(TYPES[i][1]===id)return TYPES[i];}return null;}

// ── State ──
var session=null; // {token,name,role,event,eventDate,todayScans:[],totalScans}
var activeDmContact=null;
var activeNotesMember=null;

// ── Helpers ──
async function getHandlerUrl(){
  var cfg=await fetch(CONFIG_URL+'?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();});
  return cfg.orderHandlerUrl;
}
async function postAction(data){
  var url=await getHandlerUrl();
  var res=await fetch(url,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(data)});
  var text=await res.text();
  try{return JSON.parse(text);}catch(e){throw new Error('Server unavailable');}
}
async function sha256(text){
  var buf=new TextEncoder().encode(text);
  var digest=await crypto.subtle.digest('SHA-256',buf);
  return Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}
function escapeHtml(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function initials(n){return n.split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);}
function timeAgo(ts){var d=Date.now()-ts,m=Math.floor(d/60000);if(m<1)return 'now';if(m<60)return m+'m';var h=Math.floor(m/60);if(h<24)return h+'h';return Math.floor(h/24)+'d';}
function fmtDate(ts){return new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function saveSession(){try{localStorage.setItem('stwm-team-session',JSON.stringify(session));}catch(e){}}

// ── Views ──
window.showView=function(v){
  document.querySelectorAll('.view').forEach(function(el){el.classList.remove('active');});
  document.getElementById('view-'+v).classList.add('active');
};
function showPortal(){
  showView('portal');
  document.getElementById('dash-event-banner').innerHTML='⚡ <strong>'+escapeHtml(session.event)+'</strong> — '+escapeHtml(session.name);
  document.getElementById('stat-today').textContent=session.todayScans.length;
  document.getElementById('stat-total').textContent=session.totalScans||0;
  updateActivityList();updateScanCount();
  // Show compose if admin
  if(session.role==='admin'||session.role==='super_admin'){document.getElementById('ann-compose-card').style.display='';}
  else{document.getElementById('ann-compose-card').style.display='none';}
  loadAnnouncements();
  checkEmergencyAlerts();
}
function showEventOrPortal(){
  if(session.event&&session.eventDate===new Date().toISOString().split('T')[0]){showPortal();}
  else{showView('event');}
}

// ── Main Tabs ──
document.querySelectorAll('.main-tab').forEach(function(tab){
  tab.addEventListener('click',function(){
    document.querySelectorAll('.main-tab').forEach(function(t){t.classList.remove('main-tab--active');});
    this.classList.add('main-tab--active');
    document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('tab-panel--active');p.hidden=true;});
    var panel=document.getElementById('tab-'+this.dataset.tab);
    panel.classList.add('tab-panel--active');panel.hidden=false;
  });
});

// ── Message Subtabs ──
document.querySelectorAll('.msg-subtab').forEach(function(tab){
  tab.addEventListener('click',function(){
    document.querySelectorAll('.msg-subtab').forEach(function(t){t.classList.remove('msg-subtab--active');});
    this.classList.add('msg-subtab--active');
    document.querySelectorAll('.msg-subpanel').forEach(function(p){p.classList.remove('active');});
    document.getElementById('msgpanel-'+this.dataset.msgtab).classList.add('active');
  });
});

// ── Auth ──
try{
  var saved=JSON.parse(localStorage.getItem('stwm-team-session')||'null');
  if(saved&&saved.token){session=saved;session.todayScans=session.todayScans||[];showEventOrPortal();}
}catch(e){}

document.getElementById('login-btn').addEventListener('click',async function(){
  var btn=this,status=document.getElementById('login-status');
  var name=document.getElementById('login-name').value.trim();
  var pass=document.getElementById('login-pass').value;
  if(!name||!pass){status.textContent='Enter name and password.';status.className='status status--error';return;}
  btn.disabled=true;btn.textContent='Logging in...';status.textContent='';
  try{
    var hash=await sha256('stwm-team-'+name.toLowerCase()+'-'+pass);
    var res=await postAction({action:'teamLogin',name:name,password_hash:hash});
    if(res.ok){
      session={token:res.token,name:res.name,role:res.role||'member',totalScans:res.total_scans||0,todayScans:[],event:'',eventDate:'',telegram_username:res.telegram_username||''};
      saveSession();showEventOrPortal();
    }else throw new Error(res.error||'Login failed');
  }catch(err){status.textContent=err.message;status.className='status status--error';}
  btn.disabled=false;btn.textContent='Log in';
});

document.getElementById('signup-btn').addEventListener('click',async function(){
  var btn=this,status=document.getElementById('signup-status');
  var name=document.getElementById('signup-name').value.trim();
  var email=document.getElementById('signup-email').value.trim();
  var phone=document.getElementById('signup-phone').value.trim();
  var telegram=document.getElementById('signup-telegram').value.trim();
  var pass=document.getElementById('signup-pass').value;
  var pass2=document.getElementById('signup-pass2').value;
  if(!name){status.textContent='Name is required.';status.className='status status--error';return;}
  if(!pass||pass.length<4){status.textContent='Password must be at least 4 characters.';status.className='status status--error';return;}
  if(pass!==pass2){status.textContent='Passwords do not match.';status.className='status status--error';return;}
  btn.disabled=true;btn.textContent='Creating account...';status.textContent='';
  try{
    var hash=await sha256('stwm-team-'+name.toLowerCase()+'-'+pass);
    var res=await postAction({action:'teamSignup',name:name,email:email,phone:phone,telegram_username:telegram,password_hash:hash});
    if(res.ok){
      session={token:res.token,name:name,role:'member',totalScans:0,todayScans:[],event:'',eventDate:'',telegram_username:telegram};
      saveSession();showEventOrPortal();
    }else throw new Error(res.error||'Signup failed');
  }catch(err){status.textContent=err.message;status.className='status status--error';}
  btn.disabled=false;btn.textContent='Create Account';
});

// Event setup
document.getElementById('event-btn').addEventListener('click',function(){
  var name=document.getElementById('event-name').value.trim();
  if(!name){document.getElementById('event-status').textContent='Enter an event name.';return;}
  session.event=name;session.eventDate=new Date().toISOString().split('T')[0];
  session.todayScans=[];saveSession();
  postAction({action:'setActiveEvent',passphrase_hash:'2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440',event_id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),event_label:name,set_by:session.name}).catch(function(){});
  showPortal();
});

// Logout
document.getElementById('logout-btn').addEventListener('click',function(){
  session=null;try{localStorage.removeItem('stwm-team-session');}catch(e){}showView('login');
});

// ── Activity List ──
function updateActivityList(){
  var list=document.getElementById('activity-list');
  if(!session||!session.todayScans.length){list.innerHTML='<p style="color:var(--muted);font-size:0.84rem;">No items scanned yet today.</p>';return;}
  list.innerHTML=session.todayScans.slice().reverse().map(function(s,i){
    var realIdx=session.todayScans.length-1-i;
    return '<div class="activity-item"><span class="activity-item__name">'+escapeHtml(s.name)+'</span><span class="activity-item__time">'+s.time+'</span>'+
      '<button class="activity-item__edit" data-idx="'+realIdx+'" title="Edit">✏️</button>'+
      '<button class="activity-item__rm" data-idx="'+realIdx+'" title="Remove">×</button></div>';
  }).join('');
  list.querySelectorAll('.activity-item__rm').forEach(function(btn){
    btn.addEventListener('click',function(){removeScan(+this.dataset.idx);});
  });
  list.querySelectorAll('.activity-item__edit').forEach(function(btn){
    btn.addEventListener('click',function(){editScan(+this.dataset.idx);});
  });
}
function updateScanCount(){
  var el=document.getElementById('scan-count');
  if(el&&session)el.textContent=session.todayScans.length+' item(s) scanned today';
}
function removeScan(idx){
  if(!confirm('Remove "'+session.todayScans[idx].name+'" from today\'s log?\n\nThis will also remove it from the spreadsheet.')){return;}
  var scan=session.todayScans[idx];
  // Delete from server first, then update local
  postAction({action:'deleteScan',token:session.token,item_id:scan.id,item_name:scan.name,event_label:session.event,date:session.eventDate}).then(function(res){
    if(res&&res.ok){
      session.todayScans.splice(idx,1);
      session.totalScans=Math.max(0,(session.totalScans||1)-1);
      saveSession();updateActivityList();updateScanCount();
      document.getElementById('stat-today').textContent=session.todayScans.length;
      document.getElementById('stat-total').textContent=session.totalScans;
    }else{alert('Could not delete from spreadsheet: '+(res&&res.error||'unknown error'));}
  }).catch(function(e){alert('Delete failed: '+e.message);});
}
function editScan(idx){
  var scan=session.todayScans[idx];
  var newQty=prompt('Edit quantity for "'+scan.name+'":\n(Currently 1. Enter new quantity or 0 to remove.)',1);
  if(newQty===null)return;
  newQty=parseInt(newQty);
  if(newQty===0){removeScan(idx);return;}
  if(isNaN(newQty)||newQty<1){alert('Invalid quantity.');return;}
  // For today's items, we can directly update
  postAction({action:'editScan',token:session.token,item_id:scan.id,item_name:scan.name,event_label:session.event,date:session.eventDate,new_qty:newQty}).catch(function(){});
  alert('Updated to '+newQty+'.');
}

// ── Scan History ──
async function loadScanHistory(){
  var container=document.getElementById('history-list');
  if(!container)return;
  container.innerHTML='<p style="color:var(--muted);font-size:0.84rem;text-align:center;">Loading history...</p>';
  try{
    var res=await postAction({action:'getScanHistory',token:session.token});
    if(res.ok&&res.scans&&res.scans.length){
      var today=new Date().toISOString().split('T')[0];
      container.innerHTML=res.scans.map(function(s){
        var isToday=s.date===today;
        var actions='';
        if(isToday){
          actions='<button class="activity-item__edit hist-edit" data-row="'+escapeHtml(s.row_id)+'" data-name="'+escapeHtml(s.item_name)+'">✏️</button>'+
                  '<button class="activity-item__rm hist-del" data-row="'+escapeHtml(s.row_id)+'" data-name="'+escapeHtml(s.item_name)+'">×</button>';
        }else{
          actions='<button class="activity-item__edit hist-suggest" data-row="'+escapeHtml(s.row_id)+'" data-name="'+escapeHtml(s.item_name)+'" title="Suggest a change">✏️</button>';
        }
        return '<div class="activity-item"><span class="activity-item__name">'+escapeHtml(s.item_name)+'<small style="color:var(--muted);font-size:0.7rem;margin-left:0.4rem;">'+escapeHtml(s.date)+' · '+escapeHtml(s.event||'')+'</small></span>'+actions+'</div>';
      }).join('');
      // Bind today's edit/delete
      container.querySelectorAll('.hist-del').forEach(function(btn){
        btn.addEventListener('click',function(){
          if(!confirm('Delete "'+this.dataset.name+'" from the spreadsheet?'))return;
          postAction({action:'deleteInventoryRow',token:session.token,row_id:this.dataset.row}).then(function(){loadScanHistory();}).catch(function(e){alert(e.message);});
        });
      });
      container.querySelectorAll('.hist-edit').forEach(function(btn){
        btn.addEventListener('click',function(){
          var newQty=prompt('New quantity for "'+this.dataset.name+'":',1);
          if(!newQty)return;
          postAction({action:'editInventoryRow',token:session.token,row_id:this.dataset.row,new_qty:parseInt(newQty)||1}).then(function(){loadScanHistory();}).catch(function(e){alert(e.message);});
        });
      });
      // Bind past day suggest-change
      container.querySelectorAll('.hist-suggest').forEach(function(btn){
        btn.addEventListener('click',function(){
          var note=prompt('Suggest a change for "'+this.dataset.name+'":\n(This sends a note to admins for review)');
          if(!note)return;
          postAction({action:'suggestScanEdit',token:session.token,row_id:this.dataset.row,item_name:this.dataset.name,note:note}).then(function(){alert('Change request sent to admins.');}).catch(function(e){alert(e.message);});
        });
      });
    }else{
      container.innerHTML='<p style="color:var(--muted);font-size:0.84rem;text-align:center;">No scan history found.</p>';
    }
  }catch(e){container.innerHTML='<p style="color:var(--red);font-size:0.84rem;text-align:center;">Error loading history.</p>';}
}

// ── QR Scanner ──
var qrScanner=null,qrActive=false,pendingScan=null;
document.getElementById('qr-toggle-btn').addEventListener('click',function(){
  if(qrActive){stopQr();return;}
  if(!window.Html5Qrcode){var s=document.createElement('script');s.src='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';s.onload=startQr;document.head.appendChild(s);}else startQr();
});
function startQr(){
  var reader=document.getElementById('qr-reader'),status=document.getElementById('qr-status'),btn=document.getElementById('qr-toggle-btn');
  document.getElementById('qr-confirm').classList.remove('active');pendingScan=null;
  reader.classList.add('active');btn.textContent='\u23f9 Stop Scanner';status.textContent='Scanning...';status.className='qr-status';
  qrScanner=new Html5Qrcode('qr-reader');qrActive=true;
  qrScanner.start({facingMode:'environment'},{fps:10,qrbox:{width:200,height:200}},function(decoded){
    stopQr();
    var itemId=decoded.trim();
    if(itemId.indexOf('http')===0){try{var u=new URL(itemId);itemId=u.searchParams.get('item')||u.pathname.split('/').pop()||itemId;}catch(e){}}
    var found=findType(itemId);
    if(found){pendingScan={id:found[1],name:found[0]};showScanConfirm(found[0],found[1]);if(navigator.vibrate)navigator.vibrate(100);}
    else{status.textContent='\u26a0\ufe0f Unknown: '+itemId;status.className='qr-status error';}
  },function(){}).catch(function(err){document.getElementById('qr-status').textContent='Camera error: '+(err.message||err);document.getElementById('qr-status').className='qr-status error';qrActive=false;document.getElementById('qr-reader').classList.remove('active');document.getElementById('qr-toggle-btn').textContent='\ud83d\udcf7 Scan Item QR';});
}
function stopQr(){
  if(qrScanner){try{qrScanner.stop().then(function(){try{qrScanner.clear();}catch(e){}}).catch(function(){});}catch(e){}}
  qrActive=false;document.getElementById('qr-reader').classList.remove('active');document.getElementById('qr-toggle-btn').textContent='\ud83d\udcf7 Scan Item QR';
  if(!pendingScan){document.getElementById('qr-status').textContent='Scanner stopped.';document.getElementById('qr-status').className='qr-status';}
}
function showScanConfirm(name,id){
  document.getElementById('qr-confirm-name').textContent=name;
  document.getElementById('qr-confirm-id').textContent=id;
  document.getElementById('qr-confirm').classList.add('active');
  document.getElementById('qr-status').textContent='\u2705 Scanned! Confirm below.';document.getElementById('qr-status').className='qr-status success';
}
document.getElementById('qr-confirm-add').addEventListener('click',function(){
  if(pendingScan){logScan(pendingScan.id,pendingScan.name);document.getElementById('qr-status').textContent='\u2705 Added: '+pendingScan.name;}
  document.getElementById('qr-confirm').classList.remove('active');pendingScan=null;
});
document.getElementById('qr-confirm-cancel').addEventListener('click',function(){
  document.getElementById('qr-status').textContent='Discarded.';document.getElementById('qr-status').className='qr-status';
  document.getElementById('qr-confirm').classList.remove('active');pendingScan=null;
});
document.getElementById('qr-confirm-rescan').addEventListener('click',function(){
  document.getElementById('qr-confirm').classList.remove('active');pendingScan=null;startQr();
});

// ── Log Scan ──
async function logScan(itemId,itemName){
  var now=new Date();
  session.todayScans.push({id:itemId,name:itemName,time:now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
  session.totalScans=(session.totalScans||0)+1;
  saveSession();updateActivityList();updateScanCount();
  document.getElementById('stat-today').textContent=session.todayScans.length;
  document.getElementById('stat-total').textContent=session.totalScans;
  try{await postAction({action:'teamScan',token:session.token,team_member:session.name,item_id:itemId,item_name:itemName,event_label:session.event,date:now.toISOString().split('T')[0]});}catch(e){}
}

// ── Picker ──
document.getElementById('add-manual-btn').addEventListener('click',openPicker);
function openPicker(){document.getElementById('picker-overlay').classList.add('active');document.getElementById('picker-search').value='';renderPickerList('');setTimeout(function(){document.getElementById('picker-search').focus();},100);}
function closePicker(){document.getElementById('picker-overlay').classList.remove('active');}
function renderPickerList(filter){
  var list=document.getElementById('picker-list'),q=filter.toLowerCase(),html='';
  TYPES.forEach(function(t,i){
    if(q&&t[0].toLowerCase().indexOf(q)===-1&&t[1].toLowerCase().indexOf(q)===-1)return;
    html+='<div class="picker-item" data-idx="'+i+'"><div><div class="picker-item__name">'+t[0]+'</div><div class="picker-item__id">'+t[1]+'</div></div></div>';
  });
  if(!html)html='<p style="text-align:center;color:var(--muted);padding:2rem 0;font-size:0.84rem;">No items match.</p>';
  list.innerHTML=html;
  list.querySelectorAll('.picker-item').forEach(function(el){el.addEventListener('click',function(){logScan(TYPES[+this.dataset.idx][1],TYPES[+this.dataset.idx][0]);closePicker();});});
}
document.getElementById('picker-close').addEventListener('click',closePicker);
document.getElementById('picker-overlay').addEventListener('click',function(e){if(e.target===this)closePicker();});
document.getElementById('picker-search').addEventListener('input',function(){renderPickerList(this.value);});

// ── Announcements ──
async function loadAnnouncements(){
  var feed=document.getElementById('ann-feed');
  try{
    var res=await postAction({action:'getAnnouncements',token:session.token});
    if(res.ok&&res.announcements&&res.announcements.length){
      feed.innerHTML=res.announcements.map(function(a){
        return '<div class="ann-item ann-item--'+a.priority+'"><span class="ann-item__priority ann-item__priority--'+a.priority+'">'+a.priority+'</span><h4 class="ann-item__subject">'+escapeHtml(a.subject)+'</h4><p class="ann-item__body">'+escapeHtml(a.body)+'</p><p class="ann-item__meta">'+escapeHtml(a.author)+' · '+fmtDate(a.timestamp)+'</p></div>';
      }).join('');
    }else{
      feed.innerHTML='<p style="color:var(--muted);font-size:0.84rem;text-align:center;padding:1rem 0;">No announcements yet.</p>';
    }
  }catch(e){
    feed.innerHTML='<p style="color:var(--muted);font-size:0.84rem;text-align:center;padding:1rem 0;">Could not load announcements.</p>';
  }
}

document.getElementById('ann-send-btn').addEventListener('click',async function(){
  var btn=this;
  var subject=document.getElementById('ann-subject').value.trim();
  var body=document.getElementById('ann-body').value.trim();
  var priority=document.getElementById('ann-priority').value;
  var sendTelegram=document.getElementById('ann-telegram').checked;
  if(!subject||!body){alert('Fill in subject and message.');return;}
  btn.disabled=true;btn.textContent='Posting...';
  try{
    var res=await postAction({action:'postAnnouncement',token:session.token,subject:subject,body:body,priority:priority,send_telegram:sendTelegram});
    if(res.ok){
      document.getElementById('ann-subject').value='';document.getElementById('ann-body').value='';
      loadAnnouncements();
      if(priority==='emergency')checkEmergencyAlerts();
    }else{alert(res.error||'Failed to post.');}
  }catch(e){alert(e.message);}
  btn.disabled=false;btn.textContent='Post';
});

// ── Emergency Alert System ──
async function checkEmergencyAlerts(){
  var banner=document.getElementById('emergency-banner');
  if(!banner)return;
  var dismissed=sessionStorage.getItem('stwm-emergency-dismissed');
  try{
    var res=await postAction({action:'getAnnouncements',token:session.token});
    if(res.ok&&res.announcements){
      // Find most recent emergency (within last 24h)
      var now=Date.now();
      var emergency=null;
      for(var i=0;i<res.announcements.length;i++){
        var a=res.announcements[i];
        if(a.priority==='emergency'&&(now-a.timestamp)<86400000){
          emergency=a;break;
        }
      }
      if(emergency&&dismissed!==emergency.subject){
        document.getElementById('emergency-title').textContent=emergency.subject;
        document.getElementById('emergency-body').textContent=emergency.body;
        banner.style.display='flex';
      }else{banner.style.display='none';}
    }
  }catch(e){}
}
document.getElementById('emergency-dismiss').addEventListener('click',function(){
  var title=document.getElementById('emergency-title').textContent;
  sessionStorage.setItem('stwm-emergency-dismissed',title);
  document.getElementById('emergency-banner').style.display='none';
});

// ── Direct Messages ──
async function loadDmContacts(){
  var container=document.getElementById('dm-contacts');
  try{
    var res=await postAction({action:'getDmContacts',token:session.token});
    if(res.ok&&res.contacts&&res.contacts.length){
      container.innerHTML=res.contacts.map(function(c){
        var isActive=activeDmContact===c.name?' dm-contact--active':'';
        return '<div class="dm-contact'+isActive+'" data-name="'+escapeHtml(c.name)+'"><div class="dm-contact__avatar">'+initials(c.name)+'</div><div><div class="dm-contact__name">'+escapeHtml(c.name)+'</div>'+(c.last_message?'<div class="dm-contact__preview">'+escapeHtml(c.last_message.slice(0,30))+'</div>':'')+'</div></div>';
      }).join('');
      container.querySelectorAll('.dm-contact').forEach(function(el){
        el.addEventListener('click',function(){activeDmContact=this.dataset.name;openDmChat();});
      });
    }else{
      container.innerHTML='<p style="color:var(--muted);font-size:0.84rem;">No conversations yet.</p>';
    }
  }catch(e){
    container.innerHTML='<p style="color:var(--muted);font-size:0.84rem;">Could not load contacts.</p>';
  }
}

function openDmChat(){
  document.getElementById('dm-list-view').style.display='none';
  document.getElementById('dm-chat-view').style.display='';
  document.getElementById('dm-chat-name').textContent=activeDmContact;
  loadDmMessages();
}
document.getElementById('dm-back-btn').addEventListener('click',function(){
  document.getElementById('dm-chat-view').style.display='none';
  document.getElementById('dm-list-view').style.display='';
  activeDmContact=null;loadDmContacts();
});

async function loadDmMessages(){
  var container=document.getElementById('dm-messages');
  container.innerHTML='<p style="color:var(--muted);font-size:0.82rem;text-align:center;">Loading...</p>';
  try{
    var res=await postAction({action:'getDmMessages',token:session.token,with_user:activeDmContact});
    if(res.ok&&res.messages&&res.messages.length){
      container.innerHTML=res.messages.map(function(m){
        var cls=m.from===session.name?'dm-bubble--sent':'dm-bubble--received';
        return '<div class="dm-bubble '+cls+'">'+escapeHtml(m.text)+'<span class="dm-bubble__time">'+fmtDate(m.timestamp)+'</span></div>';
      }).join('');
      container.scrollTop=container.scrollHeight;
    }else{
      container.innerHTML='<p style="color:var(--muted);font-size:0.82rem;text-align:center;">No messages yet.</p>';
    }
  }catch(e){container.innerHTML='<p style="color:var(--red);font-size:0.82rem;text-align:center;">Error loading messages.</p>';}
}

document.getElementById('dm-send-btn').addEventListener('click',sendDm);
document.getElementById('dm-input').addEventListener('keydown',function(e){if(e.key==='Enter')sendDm();});
async function sendDm(){
  var input=document.getElementById('dm-input'),text=input.value.trim();
  if(!text||!activeDmContact)return;
  input.value='';
  try{
    await postAction({action:'sendDm',token:session.token,to_user:activeDmContact,text:text});
    loadDmMessages();
  }catch(e){alert('Failed to send: '+e.message);}
}

document.getElementById('dm-new-btn').addEventListener('click',function(){
  var name=prompt('Enter team member name to message:');
  if(name&&name.trim()){activeDmContact=name.trim();openDmChat();}
});

// Load DM contacts when messages tab is opened
document.querySelector('[data-msgtab="dms"]').addEventListener('click',loadDmContacts);

// ── Member Notes ──
async function loadNoteMembers(){
  var container=document.getElementById('notes-members');
  try{
    var res=await postAction({action:'getNoteMembers',token:session.token});
    if(res.ok&&res.members&&res.members.length){
      renderNoteMembers(res.members);
    }else{
      container.innerHTML='<p style="color:var(--muted);font-size:0.84rem;">No members yet.</p>';
    }
  }catch(e){container.innerHTML='<p style="color:var(--muted);font-size:0.84rem;">Could not load.</p>';}
}
function renderNoteMembers(members){
  var container=document.getElementById('notes-members');
  container.innerHTML=members.map(function(m){
    var isActive=activeNotesMember===m?' dm-contact--active':'';
    return '<div class="dm-contact'+isActive+'" data-member="'+escapeHtml(m)+'"><div class="dm-contact__avatar">'+initials(m)+'</div><div class="dm-contact__name">'+escapeHtml(m)+'</div></div>';
  }).join('');
  container.querySelectorAll('.dm-contact').forEach(function(el){
    el.addEventListener('click',function(){activeNotesMember=this.dataset.member;openNotesDetail();});
  });
}
function openNotesDetail(){
  document.getElementById('notes-member-view').style.display='none';
  document.getElementById('notes-detail-view').style.display='';
  document.getElementById('notes-member-name').textContent=activeNotesMember;
  loadNotes();
}
document.getElementById('notes-back-btn').addEventListener('click',function(){
  document.getElementById('notes-detail-view').style.display='none';
  document.getElementById('notes-member-view').style.display='';
  activeNotesMember=null;loadNoteMembers();
});
async function loadNotes(){
  var log=document.getElementById('notes-log');
  log.innerHTML='<p style="color:var(--muted);font-size:0.82rem;text-align:center;">Loading...</p>';
  try{
    var res=await postAction({action:'getMemberNotes',token:session.token,member:activeNotesMember});
    if(res.ok&&res.notes&&res.notes.length){
      log.innerHTML=res.notes.map(function(n){
        return '<div class="note-entry"><span class="note-entry__cat note-entry__cat--'+n.category+'">'+n.category+'</span><p class="note-entry__text">'+escapeHtml(n.text)+'</p><p class="note-entry__meta">'+escapeHtml(n.author)+' · '+fmtDate(n.timestamp)+'</p></div>';
      }).join('');
    }else{
      log.innerHTML='<p style="color:var(--muted);font-size:0.82rem;text-align:center;">No notes yet.</p>';
    }
  }catch(e){log.innerHTML='<p style="color:var(--red);font-size:0.82rem;">Error.</p>';}
}
document.getElementById('notes-save-btn').addEventListener('click',async function(){
  var text=document.getElementById('notes-input').value.trim();
  var category=document.getElementById('notes-category').value;
  if(!text||!activeNotesMember){alert('Write a note.');return;}
  try{
    await postAction({action:'addMemberNote',token:session.token,member:activeNotesMember,text:text,category:category});
    document.getElementById('notes-input').value='';loadNotes();
  }catch(e){alert(e.message);}
});
document.getElementById('notes-add-btn').addEventListener('click',function(){
  var name=prompt('Enter member name:');
  if(name&&name.trim()){activeNotesMember=name.trim();openNotesDetail();}
});
document.getElementById('notes-search').addEventListener('input',function(){
  var q=this.value.toLowerCase();
  document.querySelectorAll('#notes-members .dm-contact').forEach(function(el){
    el.style.display=el.dataset.member.toLowerCase().indexOf(q)>-1?'':'none';
  });
});
document.querySelector('[data-msgtab="notes"]').addEventListener('click',loadNoteMembers);

// ── Training Tab ──
var MILESTONES=[
  {id:'first_scan',label:'First Bible Given',icon:'🌱',threshold:1},
  {id:'ten_scans',label:'10 Bibles Given',icon:'🌿',threshold:10},
  {id:'fifty_scans',label:'50 Bibles Given',icon:'🌳',threshold:50},
  {id:'hundred_scans',label:'100 Bibles Given',icon:'🏆',threshold:100},
  {id:'first_event',label:'First Outreach Event',icon:'⭐',threshold:1},
  {id:'five_events',label:'5 Events Attended',icon:'🔥',threshold:5}
];

var TRAINING_MODULES=[
  {id:'intro',name:'Ministry Introduction',desc:'What we do, how we do it, and why it matters.'},
  {id:'conversation',name:'Starting Conversations',desc:'How to approach people naturally and share the gospel.'},
  {id:'scanner',name:'Using the Scanner',desc:'How to scan Bibles, log inventory, and track your outreach.'},
  {id:'prayer',name:'Praying with Strangers',desc:'Simple frameworks for praying with people in the field.'},
  {id:'followup',name:'Follow-up & Discipleship',desc:'What to do after someone receives a Bible.'},
  {id:'safety',name:'Safety & Boundaries',desc:'Working in pairs, situational awareness, when to walk away.'}
];

function renderMilestones(){
  var container=document.getElementById('training-milestones');
  if(!session)return;
  var scans=session.totalScans||0;
  container.innerHTML=MILESTONES.map(function(m){
    var earned=scans>=m.threshold;
    return '<span class="milestone-badge'+(earned?' milestone-badge--earned':'')+'">'+m.icon+' '+m.label+(earned?' ✓':'')+'</span>';
  }).join('');
}

async function renderTrainingModules(){
  var container=document.getElementById('training-modules');
  try{
    var res=await postAction({action:'getTrainingProgress',token:session.token});
    var completed=(res.ok&&res.completed)||[];
    container.innerHTML=TRAINING_MODULES.map(function(mod){
      var done=completed.indexOf(mod.id)>=0;
      return '<div class="training-module"><div class="training-module__check'+(done?' training-module__check--done':'')+'">'+(done?'✓':'')+'</div><div class="training-module__info"><div class="training-module__name">'+mod.name+'</div><div class="training-module__desc">'+mod.desc+'</div></div></div>';
    }).join('');
  }catch(e){container.innerHTML='<p style="color:var(--muted);font-size:0.82rem;">Could not load progress.</p>';}
}

async function renderTrainingRecord(){
  var container=document.getElementById('training-record');
  try{
    var res=await postAction({action:'getTrainingRecord',token:session.token});
    if(res.ok&&res.records&&res.records.length){
      container.innerHTML=res.records.map(function(r){
        return '<div class="training-record-item"><span class="training-record-item__type training-record-item__type--'+r.type+'">'+r.type.replace('_',' ')+'</span><p style="margin:0.2rem 0 0;color:var(--ink2);">'+escapeHtml(r.text)+'</p><p style="font-size:0.68rem;color:var(--muted);margin:0.25rem 0 0;">'+escapeHtml(r.author)+' · '+fmtDate(r.timestamp)+'</p></div>';
      }).join('');
    }else{container.innerHTML='<p style="color:var(--muted);font-size:0.82rem;">No records yet. Your leadership will add notes here as you grow.</p>';}
  }catch(e){container.innerHTML='<p style="color:var(--muted);font-size:0.82rem;">Could not load records.</p>';}
}

function initTrainingTab(){
  renderMilestones();
  renderTrainingModules();
  renderTrainingRecord();
  // Admin panel
  if(session&&(session.role==='admin'||session.role==='super_admin')){
    document.getElementById('training-admin-panel').style.display='';
    loadTrainingMemberSelect();
  }
}

async function loadTrainingMemberSelect(){
  var sel=document.getElementById('training-member-select');
  try{
    var res=await postAction({action:'getNoteMembers',token:session.token});
    if(res.ok&&res.members){
      sel.innerHTML=res.members.map(function(m){return '<option value="'+escapeHtml(m)+'">'+escapeHtml(m)+'</option>';}).join('');
    }
  }catch(e){}
}

document.getElementById('training-record-save').addEventListener('click',async function(){
  var member=document.getElementById('training-member-select').value;
  var type=document.getElementById('training-record-type').value;
  var text=document.getElementById('training-record-text').value.trim();
  if(!text){alert('Write something.');return;}
  try{
    await postAction({action:'addTrainingRecord',token:session.token,member:member,type:type,text:text});
    document.getElementById('training-record-text').value='';
    alert('Record saved for '+member+'.');
  }catch(e){alert(e.message);}
});

// Hook training tab click
document.querySelector('[data-tab="training"]').addEventListener('click',function(){initTrainingTab();});

// ── History toggle ──
document.getElementById('toggle-history-btn').addEventListener('click',function(){
  var card=document.getElementById('history-card');
  if(card.style.display==='none'){
    card.style.display='';
    this.textContent='📋 Hide History';
    loadScanHistory();
  }else{
    card.style.display='none';
    this.textContent='📋 View Full History';
  }
});

})();
