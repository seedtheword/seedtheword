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

// Local calendar date as YYYY-MM-DD (NOT UTC). Using toISOString() here caused
// evening-Pacific entries to log as tomorrow because ISO is UTC. en-CA formats
// as YYYY-MM-DD in the browser's local timezone.
function localToday(){ return new Date().toLocaleDateString('en-CA'); }

// Per-section permission check for the portal. Prefers STW_Auth (nav-auth.js);
// falls back to a local resolver from the session if it isn't loaded yet.
// super_admin => all. Keys: scanner, finance, orders, chat_admin,
// training_admin, content_studio, members_admin.
var PORTAL_ALL_PERMS=['scanner','finance','orders','chat_admin','training_admin','content_studio','members_admin'];
var PORTAL_ROLE_DEFAULTS={super_admin:PORTAL_ALL_PERMS.slice(),admin:['scanner','finance','orders','chat_admin','training_admin'],member:[]};
function canPortal(section){
  if(window.STW_Auth&&STW_Auth.hasPermission)return STW_Auth.hasPermission(section);
  if(!session)return false;
  var role=String(session.role||'member').toLowerCase();
  if(role==='super_admin')return true;
  var perms=Array.isArray(session.permissions)?session.permissions:(PORTAL_ROLE_DEFAULTS[role]||[]);
  return perms.indexOf(section)!==-1;
}

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
  // Show announcement compose only if the member has the chat_admin permission.
  if(canPortal('chat_admin')){document.getElementById('chat-admin-compose').style.display='';}
  else{document.getElementById('chat-admin-compose').style.display='none';}
  checkEmergencyAlerts();
}
function showEventOrPortal(){
  if(session.event&&session.eventDate===localToday()){showPortal();}
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
// (Replaced by Telegram-style chat — see chat channel logic below)

// ── Telegram-style Chat System ──
var activeChannel='main';
var activeDmContact=null;
var msgTypeMode='message'; // message, prayer, thanksgiving
var CHANNELS={
  main:{title:'Main Chat',sub:'Team fellowship & updates'},
  announcements:{title:'Announcements',sub:'Ministry-wide broadcasts'},
  prayer:{title:'Prayer & Thanksgiving',sub:'Lift each other up'},
  thanksgiving:{title:'Thanksgiving',sub:'Celebrate what God has done'},
  dms:{title:'Direct Messages',sub:'Private conversations'}
};

// Channel click handlers
document.querySelectorAll('.chat-topic').forEach(function(el){
  el.addEventListener('click',function(){
    document.querySelectorAll('.chat-topic').forEach(function(t){t.classList.remove('chat-topic--active');});
    this.classList.add('chat-topic--active');
    activeChannel=this.dataset.channel;
    document.getElementById('chat-channel-title').textContent=CHANNELS[activeChannel].title;
    document.getElementById('chat-channel-sub').textContent=CHANNELS[activeChannel].sub;
    // Toggle DM picker / admin compose visibility
    document.getElementById('chat-dm-picker').style.display=activeChannel==='dms'?'':'none';
    document.getElementById('chat-admin-compose').style.display=(activeChannel==='announcements'&&canPortal('chat_admin'))?'':'none';
    // Update compose placeholder
    var placeholders={main:'Write a message...',announcements:'Read-only for members',prayer:'Share a prayer request...',thanksgiving:'Share what God has done...',dms:'Type a message...'};
    document.getElementById('chat-input').placeholder=placeholders[activeChannel]||'Write a message...';
    // Disable compose for announcements (non-admin)
    var compose=document.getElementById('chat-compose');
    if(activeChannel==='announcements'&&!canPortal('chat_admin')){
      compose.style.opacity='0.5';compose.style.pointerEvents='none';
    }else{compose.style.opacity='1';compose.style.pointerEvents='auto';}
    loadChannelMessages();
  });
});

// Message type toggle
document.getElementById('chat-type-btn').addEventListener('click',function(){
  if(msgTypeMode==='message'){msgTypeMode='prayer';this.textContent='🙏';}
  else if(msgTypeMode==='prayer'){msgTypeMode='thanksgiving';this.textContent='🎉';}
  else{msgTypeMode='message';this.textContent='💬';}
});

// Send message
document.getElementById('chat-send-btn').addEventListener('click',sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChatMessage();}});

async function sendChatMessage(){
  var input=document.getElementById('chat-input');
  var text=input.value.trim();
  if(!text)return;
  input.value='';
  // Optimistic UI — show immediately
  appendLocalMessage(text,msgTypeMode);
  try{
    await postAction({action:'sendChatMessage',token:session.token,channel:activeChannel==='dms'?'dm_'+activeDmContact:activeChannel,text:text,msg_type:msgTypeMode,to_user:activeDmContact||''});
  }catch(e){}
}

function appendLocalMessage(text,type){
  var container=document.getElementById('chat-messages');
  var div=document.createElement('div');
  div.className='chat-msg chat-msg--out'+(type==='prayer'?' chat-msg--prayer':'');
  var typeLabel=type!=='message'?'<span class="chat-msg__type">'+type+'</span>':'';
  div.innerHTML=typeLabel+escapeHtml(text)+'<span class="chat-msg__time">Just now</span>';
  container.appendChild(div);
  container.scrollTop=container.scrollHeight;
}

async function loadChannelMessages(){
  var container=document.getElementById('chat-messages');
  container.innerHTML='<div class="chat-msg chat-msg--system">Loading...</div>';
  var channel=activeChannel;
  if(channel==='dms'&&activeDmContact)channel='dm_'+activeDmContact;
  else if(channel==='dms'){container.innerHTML='<div class="chat-msg chat-msg--system">Select a conversation below</div>';return;}
  try{
    var res=await postAction({action:'getChatMessages',token:session.token,channel:channel});
    if(res.ok&&res.messages&&res.messages.length){
      container.innerHTML=res.messages.map(function(m){
        var isMine=m.from&&m.from.toLowerCase()===session.name.toLowerCase();
        var cls=isMine?'chat-msg--out':'chat-msg--in';
        if(m.msg_type==='prayer'||m.msg_type==='thanksgiving')cls+=' chat-msg--prayer';
        var author=!isMine?'<span class="chat-msg__author">'+escapeHtml(m.from)+'</span>':'';
        var typeLabel=m.msg_type&&m.msg_type!=='message'?'<span class="chat-msg__type">'+m.msg_type+'</span>':'';
        return '<div class="chat-msg '+cls+'">'+author+typeLabel+escapeHtml(m.text)+'<span class="chat-msg__time">'+fmtDate(m.timestamp)+'</span></div>';
      }).join('');
      container.scrollTop=container.scrollHeight;
    }else{
      container.innerHTML='<div class="chat-msg chat-msg--system">No messages yet. Be the first!</div>';
    }
  }catch(e){container.innerHTML='<div class="chat-msg chat-msg--system">Could not load messages</div>';}
}

// DM contact picker — fetches actual registered members
document.getElementById('chat-dm-new').addEventListener('click',async function(){
  // Show a member picker instead of free-text prompt
  try{
    var res=await postAction({action:'getNoteMembers',token:session.token});
    if(res.ok&&res.members&&res.members.length){
      var filtered=res.members.filter(function(m){return m.toLowerCase()!==session.name.toLowerCase();});
      if(!filtered.length){alert('No other team members registered yet.');return;}
      // Build a simple selection dialog
      var pick=filtered.map(function(m,i){return(i+1)+'. '+m;}).join('\n');
      var sel=prompt('Select a team member to message:\n\n'+pick+'\n\nEnter their number:');
      if(!sel)return;
      var idx=parseInt(sel)-1;
      if(idx>=0&&idx<filtered.length){activeDmContact=filtered[idx];loadChannelMessages();loadDmContactList();}
      else{alert('Invalid selection.');}
    }else{alert('No team members found.');}
  }catch(e){alert('Could not load members.');}
});

async function loadDmContactList(){
  var container=document.getElementById('chat-dm-contacts');
  try{
    var res=await postAction({action:'getDmContacts',token:session.token});
    if(res.ok&&res.contacts&&res.contacts.length){
      container.innerHTML=res.contacts.map(function(c){
        var active=activeDmContact===c.name?' style="background:var(--green-soft);border-radius:8px;"':'';
        return '<div class="dm-contact"'+active+' data-name="'+escapeHtml(c.name)+'"><div class="dm-contact__avatar">'+initials(c.name)+'</div><div><div class="dm-contact__name">'+escapeHtml(c.name)+'</div></div></div>';
      }).join('');
      container.querySelectorAll('.dm-contact').forEach(function(el){
        el.addEventListener('click',function(){activeDmContact=this.dataset.name;loadChannelMessages();loadDmContactList();});
      });
    }else{container.innerHTML='<p style="font-size:0.78rem;color:var(--muted);">No conversations yet.</p>';}
  }catch(e){}
}

// Announcement send (admin)
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
      if(activeChannel==='announcements')loadChannelMessages();
      if(priority==='emergency')checkEmergencyAlerts();
    }else{alert(res.error||'Failed.');}
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
      var now=Date.now();
      var emergency=null;
      for(var i=0;i<res.announcements.length;i++){
        var a=res.announcements[i];
        if(a.priority==='emergency'&&(now-a.timestamp)<86400000){emergency=a;break;}
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
  sessionStorage.setItem('stwm-emergency-dismissed',document.getElementById('emergency-title').textContent);
  document.getElementById('emergency-banner').style.display='none';
});

// Init messages tab on click
document.querySelector('[data-tab="messages"]').addEventListener('click',function(){
  loadChannelMessages();
  if(activeChannel==='dms')loadDmContactList();
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
      var prevEvent = session ? session.event : '';
      var prevEventDate = session ? session.eventDate : '';
      session={token:res.token,name:res.name,role:res.role||'member',permissions:Array.isArray(res.permissions)?res.permissions:[],totalScans:res.total_scans||0,todayScans:[],event:prevEvent||'',eventDate:prevEventDate||'',telegram_username:res.telegram_username||'',lastEvent:res.last_event||prevEvent||''};
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

// Forgot password
document.getElementById('forgot-btn').addEventListener('click',async function(){
  var btn=this,status=document.getElementById('forgot-status');
  var identifier=document.getElementById('forgot-identifier').value.trim();
  if(!identifier){status.textContent='Enter your name or email.';status.className='status status--error';return;}
  btn.disabled=true;btn.textContent='Sending...';status.textContent='';
  try{
    var res=await postAction({action:'recoverAccount',identifier:identifier});
    if(res.ok){
      status.textContent='✓ Recovery sent! Check your '+( res.method||'registered contact')+'.';
      status.className='status status--success';
    }else throw new Error(res.error||'Account not found');
  }catch(err){status.textContent=err.message;status.className='status status--error';}
  btn.disabled=false;btn.textContent='Send Recovery →';
});

// Event setup
document.getElementById('event-btn').addEventListener('click',function(){
  var name=document.getElementById('event-name').value.trim();
  if(!name){document.getElementById('event-status').textContent='Enter an event name.';return;}
  session.event=name;session.eventDate=localToday();
  session.todayScans=[];saveSession();
  // Cache event name locally for autocomplete
  try{var cached=JSON.parse(localStorage.getItem('stwm-event-names')||'[]');if(cached.indexOf(name)===-1){cached.unshift(name);if(cached.length>30)cached.length=30;localStorage.setItem('stwm-event-names',JSON.stringify(cached));}}catch(e){}
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
  var currentQty=scan.qty||1;
  var newQty=prompt('Edit quantity for "'+scan.name+'":\n(Currently '+currentQty+'. Enter new quantity or 0 to remove.)',currentQty);
  if(newQty===null)return;
  newQty=parseInt(newQty);
  if(newQty===0){removeScan(idx);return;}
  if(isNaN(newQty)||newQty<1){alert('Invalid quantity.');return;}
  // Update local state
  var diff=newQty-currentQty;
  session.todayScans[idx].qty=newQty;
  session.totalScans=(session.totalScans||0)+diff;
  saveSession();updateActivityList();updateScanCount();
  document.getElementById('stat-total').textContent=session.totalScans;
  // Update server
  postAction({action:'editScan',token:session.token,item_id:scan.id,item_name:scan.name,event_label:session.event,date:session.eventDate,new_qty:newQty}).then(function(res){
    if(res&&res.ok){/* success */}else{alert('Server update failed: '+(res&&res.error||'unknown'));}
  }).catch(function(e){alert('Update failed: '+e.message);});
}

// ── Scan History ──
async function loadScanHistory(){
  var container=document.getElementById('history-list');
  if(!container)return;
  container.innerHTML='<p style="color:var(--muted);font-size:0.84rem;text-align:center;">Loading history...</p>';
  try{
    var res=await postAction({action:'getScanHistory',token:session.token});
    if(res.ok&&res.scans&&res.scans.length){
      var today=localToday();
      container.innerHTML=res.scans.map(function(s){
        var isToday=s.date===today;
        var qtyLabel=s.qty>1?' × '+s.qty:'';
        var actions='';
        if(isToday){
          actions='<button class="activity-item__edit hist-edit" data-row="'+escapeHtml(s.row_id)+'" data-name="'+escapeHtml(s.item_name)+'">✏️</button>'+
                  '<button class="activity-item__rm hist-del" data-row="'+escapeHtml(s.row_id)+'" data-name="'+escapeHtml(s.item_name)+'">×</button>';
        }else{
          actions='<button class="activity-item__edit hist-suggest" data-row="'+escapeHtml(s.row_id)+'" data-name="'+escapeHtml(s.item_name)+'" title="Suggest a change">✏️</button>';
        }
        return '<div class="activity-item"><span class="activity-item__name">'+escapeHtml(s.item_name)+qtyLabel+'<small style="color:var(--muted);font-size:0.7rem;margin-left:0.4rem;">'+escapeHtml(s.date)+' · '+escapeHtml(s.event||'')+'</small></span>'+actions+'</div>';
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
  if(pendingScan){ openMovementSheet(pendingScan.id,pendingScan.name); }
  document.getElementById('qr-confirm').classList.remove('active');pendingScan=null;
});
document.getElementById('qr-confirm-cancel').addEventListener('click',function(){
  document.getElementById('qr-status').textContent='Discarded.';document.getElementById('qr-status').className='qr-status';
  document.getElementById('qr-confirm').classList.remove('active');pendingScan=null;
});
document.getElementById('qr-confirm-rescan').addEventListener('click',function(){
  document.getElementById('qr-confirm').classList.remove('active');pendingScan=null;startQr();
});

// ── Movement details sheet ──
var mvItem=null, mvType='outreach', mvCost='none', mvReceiptData=null, mvMetaLoaded=false;
function pillGroup(groupId,onPick){
  document.querySelectorAll('#'+groupId+' .mv-pill').forEach(function(b){b.addEventListener('click',function(){
    document.querySelectorAll('#'+groupId+' .mv-pill').forEach(function(x){x.classList.remove('is-active');});
    this.classList.add('is-active');onPick(this.dataset.val);
  });});
}
pillGroup('mv-type',function(v){mvType=v;});
pillGroup('mv-cost',function(v){mvCost=v;document.getElementById('mv-cost-detail').hidden=(v!=='yes');});
async function loadInventoryMeta(){
  if(mvMetaLoaded||!session)return; mvMetaLoaded=true;
  try{ var res=await postAction({action:'getInventoryMeta',token:session.token});
    if(res&&res.ok){
      // Populate the "who covered/donated" dropdown from the Inventory notes column.
      var sel=document.getElementById('mv-covered-select');
      if(sel&&res.donors){ sel.innerHTML='<option value="">— Choose a previous note —</option>'+res.donors.map(function(d){return '<option value="'+escapeHtml(d)+'">'+escapeHtml(d)+'</option>';}).join(''); }
    }
  }catch(e){}
}
function openMovementSheet(itemId,itemName){
  mvItem={id:itemId,name:itemName}; mvType='outreach'; mvCost='no'; mvReceiptData=null;
  document.getElementById('mv-item-name').textContent=itemName;
  document.getElementById('mv-item-id').textContent=itemId;
  document.getElementById('mv-qty').value='1';
  document.getElementById('mv-covered').value='';
  var sel=document.getElementById('mv-covered-select'); if(sel)sel.value='';
  document.getElementById('mv-notes').value='';
  document.getElementById('mv-receipt').value='';
  document.getElementById('mv-receipt-name').textContent='';
  document.getElementById('mv-cost-detail').hidden=true;
  // reset pill actives to defaults
  document.querySelectorAll('#mv-type .mv-pill').forEach(function(b){b.classList.toggle('is-active',b.dataset.val==='outreach');});
  document.querySelectorAll('#mv-cost .mv-pill').forEach(function(b){b.classList.toggle('is-active',b.dataset.val==='no');});
  document.getElementById('mv-overlay').classList.add('active');
  loadInventoryMeta();
}
function closeMovementSheet(){document.getElementById('mv-overlay').classList.remove('active');}
document.getElementById('mv-close').addEventListener('click',closeMovementSheet);
document.getElementById('mv-overlay').addEventListener('click',function(e){if(e.target===this)closeMovementSheet();});
document.getElementById('mv-qty-minus').addEventListener('click',function(){var i=document.getElementById('mv-qty');i.value=Math.max(1,(parseInt(i.value)||1)-1);});
document.getElementById('mv-qty-plus').addEventListener('click',function(){var i=document.getElementById('mv-qty');i.value=(parseInt(i.value)||1)+1;});
// Choosing a previous note fills the text field (still editable).
(function(){var sel=document.getElementById('mv-covered-select'); if(sel)sel.addEventListener('change',function(){ if(this.value)document.getElementById('mv-covered').value=this.value; });})();
document.getElementById('mv-receipt').addEventListener('change',function(){
  var f=this.files&&this.files[0]; if(!f){mvReceiptData=null;document.getElementById('mv-receipt-name').textContent='';return;}
  document.getElementById('mv-receipt-name').textContent=f.name;
  var r=new FileReader(); r.onload=function(){mvReceiptData=r.result;}; r.readAsDataURL(f);
});
document.getElementById('mv-log-btn').addEventListener('click',function(){
  if(!mvItem)return;
  var qty=parseInt(document.getElementById('mv-qty').value)||1; if(qty<1)qty=1;
  logMovement({
    id:mvItem.id, name:mvItem.name, qty:qty, movement_type:mvType,
    paid:(mvCost==='yes'),
    donor_note:document.getElementById('mv-covered').value.trim(),
    detail_notes:document.getElementById('mv-notes').value.trim(),
    receipt_data:(mvCost==='yes')?mvReceiptData:null
  });
  document.getElementById('qr-status').textContent='\u2705 Logged: '+mvItem.name+(qty>1?' (x'+qty+')':'');
  closeMovementSheet();
});

// ── Log a movement (extended teamScan) ──
async function logMovement(m){
  var now=new Date();
  // Only count items leaving stock toward "today's" activity.
  var leaving=(m.movement_type==='restock')?false:(m.movement_type==='adjustment'?false:true);
  if(leaving){
    session.todayScans.push({id:m.id,name:m.name,qty:m.qty,time:now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
    session.totalScans=(session.totalScans||0)+m.qty;
    saveSession();updateActivityList();updateScanCount();
    document.getElementById('stat-today').textContent=session.todayScans.length;
    document.getElementById('stat-total').textContent=session.totalScans;
  }
  try{await postAction({action:'teamScan',token:session.token,team_member:session.name,item_id:m.id,item_name:m.name,qty:m.qty,event_label:session.event,date:localToday(),movement_type:m.movement_type,paid:!!m.paid,donor_note:m.donor_note||'',detail_notes:m.detail_notes||'',receipt_data:m.receipt_data||''});}catch(e){}
}
// Back-compat shim (in case other code calls logScan).
async function logScan(itemId,itemName,qty){ return logMovement({id:itemId,name:itemName,qty:parseInt(qty)||1,movement_type:'outreach',paid:false}); }

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
  list.querySelectorAll('.picker-item').forEach(function(el){el.addEventListener('click',function(){
    var item=TYPES[+this.dataset.idx];
    closePicker();
    openMovementSheet(item[1],item[0]);
  });});
}
document.getElementById('picker-close').addEventListener('click',closePicker);
document.getElementById('picker-overlay').addEventListener('click',function(e){if(e.target===this)closePicker();});
document.getElementById('picker-search').addEventListener('input',function(){renderPickerList(this.value);});

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
  if(!container||!session)return;
  var scans=session.totalScans||0;
  container.innerHTML=MILESTONES.map(function(m){
    var earned=scans>=m.threshold;
    return '<span class="milestone-badge'+(earned?' milestone-badge--earned':'')+'">'+m.icon+' '+m.label+(earned?' ✓':'')+'</span>';
  }).join('');
}

async function renderTrainingModules(){
  var container=document.getElementById('training-modules');
  if(!container)return;
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
  if(!container)return;
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
  // Training admin panel — gated by the training_admin permission.
  if(canPortal('training_admin')){
    var adminPanel=document.getElementById('training-admin-panel')||document.getElementById('training-add-section');
    if(adminPanel)adminPanel.style.display='';
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

var trainingLogBtn=document.getElementById('training-record-save')||document.getElementById('training-log-btn');
if(trainingLogBtn)trainingLogBtn.addEventListener('click',async function(){
  var memberSel=document.getElementById('training-member-select');
  var member=memberSel?memberSel.value:(session&&session.name||'');
  var typeSel=document.getElementById('training-record-type')||document.getElementById('training-log-type');
  var type=typeSel?typeSel.value:'training';
  var textEl=document.getElementById('training-record-text')||document.getElementById('training-log-notes');
  var text=textEl?textEl.value.trim():'';
  if(!text){alert('Write something.');return;}
  try{
    await postAction({action:'addTrainingRecord',token:session.token,member:member,type:type,text:text});
    if(textEl)textEl.value='';
    alert('Record saved.');
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
