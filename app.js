const K='openTalkV1';
let s=JSON.parse(localStorage.getItem(K)||'null')||{
  profile:{},
  stats:{conversations:0,minutes:0,level:null,achievements:[],streak:0,lastPracticeDate:null},
  today:{conversations:0,minutes:0,date:new Date().toISOString().slice(0,10)}
};
const $=x=>document.querySelector(x);
let backendReady=false;
let supabaseClient=null;
let authSession=null;
let currentUser=null;
let currentPartner=null;
let matchPoll=null;
let channel=null;
let pc=null;
let localStream=null;
let pendingIce=[];
let callStartedAt=0;
let callTimer=null;
let finishing=false;

function save(){
  localStorage.setItem(K,JSON.stringify(s));
  render();
}

function toast(message){
  let t=document.getElementById('toast');
  if(!t){
    t=document.createElement('div');
    t.id='toast';
    t.style.cssText='position:fixed;right:22px;bottom:22px;z-index:100;background:#111735;color:#fff;padding:13px 17px;border-radius:14px;box-shadow:0 18px 45px rgba(0,0,0,.2);font-weight:700;font-size:13px;opacity:0;transform:translateY(8px);transition:.25s';
    document.body.appendChild(t);
  }
  t.textContent=message;
  requestAnimationFrame(()=>{t.style.opacity='1';t.style.transform='translateY(0)'});
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateY(8px)'},2800);
}

function render(){
  const p=s.profile||{},t=s.today||{},a=s.stats||{};
  const todayKey=new Date().toISOString().slice(0,10);
  if(t.date!==todayKey){
    s.today={conversations:0,minutes:0,date:todayKey};
  }
  if($('#name'))$('#name').value=p.name||'';
  if($('#age'))$('#age').value=p.age||'';
  if($('#country'))$('#country').value=p.country||'';
  if($('#gender'))$('#gender').value=p.gender||'Prefer not to say';

  const l=a.level||'Not assessed yet';
  $('#levelValue').textContent=l;
  $('#homeLevel').textContent=l;
  $('#homeMinutes').textContent=a.minutes||0;
  $('#homeConvos').textContent=a.conversations||0;
  $('#homeMinutes2').textContent=a.minutes||0;
  $('#homeLevel2').textContent=a.level||'—';
  $('#homeAch').textContent=(a.achievements||[]).length;
  $('#statStreakHome').textContent=a.streak||0;
  $('#statConvos').textContent=a.conversations||0;
  $('#statMinutes').textContent=a.minutes||0;
  $('#statStreak').textContent=a.streak||0;
  $('#statAch').textContent=(a.achievements||[]).length;

  const goalDone=Math.min(s.today.conversations||0,4);
  $('#goalCount').textContent=`${goalDone}/4`;
  $('#goalStatus').textContent=goalDone>=4?'Goal completed — beautiful work.':`${4-goalDone} conversation${4-goalDone===1?'':'s'} to go`;
  $('#goalProgress').style.width=Math.min(100,goalDone/4*100)+'%';

  const n={A1:12,A2:28,B1:45,B2:62,C1:82,C2:100};
  $('#levelBar').style.width=(n[l]||0)+'%';
  $('#profileLock').textContent=backendReady
    ?'Your profile stays editable. Changes are used for future matching.'
    :'Profile is editable locally. Live matching activates when the backend is connected.';
  renderMilestones();
  renderAchievements();
}

async function bootstrapBackend(){
  try{
    const stored=JSON.parse(localStorage.getItem('openTalkSession')||'null');
    let payload=stored;
    if(!payload?.session?.access_token){
      const res=await fetch('/api/session',{headers:{accept:'application/json'}});
      if(!res.ok) throw new Error('backend unavailable');
      payload=await res.json();
      localStorage.setItem('openTalkSession',JSON.stringify(payload));
    }
    if(!payload.supabase_url||!payload.supabase_key||!payload.session?.access_token)throw new Error('incomplete backend session');
    if(!window.supabase?.createClient)throw new Error('Supabase client unavailable');

    supabaseClient=window.supabase.createClient(payload.supabase_url,payload.supabase_key);
    const {data,error}=await supabaseClient.auth.setSession(payload.session);
    if(error)throw error;
    authSession=data.session;
    currentUser=data.user;
    backendReady=true;

    const profileRes=await api('/api/profile','GET');
    if(profileRes.ok){
      const p=await profileRes.json();
      if(p?.id){s.profile={...s.profile,...p};save();}
    }
    updateBackendStatus();
  }catch(e){
    backendReady=false;
    updateBackendStatus();
  }
}

function updateBackendStatus(){
  const button=$('#findPartner');
  if(!button)return;
  if(backendReady){
    button.title='Find a real human speaking partner';
  }else{
    button.title='Live human matching is not available on this static preview yet';
  }
}

async function api(path,method='GET',body=null){
  if(!authSession?.access_token)throw new Error('No live session');
  return fetch(path,{
    method,
    headers:{authorization:`Bearer ${authSession.access_token}`,'content-type':'application/json'},
    body:body?JSON.stringify(body):undefined
  });
}

document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
  const target=b.dataset.view;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===target));
  document.querySelectorAll('nav button[data-view]').forEach(v=>v.classList.toggle('nav-active',v.dataset.view===target));
  scrollTo({top:0,behavior:'smooth'});
});

$('#profileForm').onsubmit=async e=>{
  e.preventDefault();
  const profile={
    name:$('#name').value.trim(),
    age:$('#age').value,
    country:$('#country').value,
    gender:$('#gender').value
  };
  s.profile={...s.profile,...profile,savedAt:Date.now()};
  save();

  if(backendReady){
    try{
      const r=await api('/api/profile','POST',profile);
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Profile could not be saved');
      s.profile={...s.profile,...data};
      save();
      toast('Profile saved. You can edit it again anytime.');
    }catch(err){
      toast(err.message);
    }
  }else{
    toast('Profile saved locally. Live matching will use it once the backend is connected.');
  }
};

async function findPartner(){
  if(finishing)return;
  if(!backendReady){
    toast('This GitHub Pages preview has no live backend. I will not fake an AI partner — real human matching needs the live backend.');
    return;
  }

  openConversationModal();
  stopMatchPolling();

  const preference=$('#matchPreference').value;
  $('#partner').textContent='Finding a real speaking partner…';
  $('#partnerMeta').textContent='We are searching for another person, not an AI. Your microphone stays off while we search.';
  $('#listen').textContent='Looking for someone compatible…';
  $('#transcript').textContent='Waiting for another real person to join. You can leave at any time.';
  $('#mic').disabled=true;
  $('#mic').textContent='🎙 Waiting for partner';

  const attempt=async()=>{
    try{
      const r=await api('/api/match','POST',{preference});
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Matching failed');
      if(data.candidate){
        currentPartner=data.candidate;
        stopMatchPolling();
        await startHumanCall(data.session_id,data.candidate);
      }else{
        $('#listen').textContent='No one is available yet — still looking…';
      }
    }catch(err){
      $('#listen').textContent=err.message||'Unable to reach the matching service.';
    }
  };

  await attempt();
  if(!currentPartner){
    matchPoll=setInterval(attempt,4000);
  }
}

function stopMatchPolling(){
  if(matchPoll){clearInterval(matchPoll);matchPoll=null;}
}

function openConversationModal(){
  finishing=false;
  $('#modal').classList.remove('hidden');
  $('#feedback').classList.add('hidden');
  $('#feedback').innerHTML='';
  $('#timer').textContent='00:00';
  $('#finish').disabled=true;
  $('#mic').disabled=true;
}

$('#talkNow').onclick=findPartner;
$('#findPartner').onclick=findPartner;
$('#talkNowBottom').onclick=findPartner;

$('#close').onclick=leaveConversation;
$('#finish').onclick=finishConversation;

async function startHumanCall(sessionId,partner){
  if(!supabaseClient||!currentUser){
    toast('Live human matching is not initialized.');
    return;
  }
  $('#partner').textContent=`${partner.name||'Your speaking partner'} is ready`;
  $('#partnerMeta').textContent=`${partner.country||'A nearby speaker'} • ${partner.level||'level not assessed'} • Real person`;
  $('#listen').textContent='Connecting securely…';
  $('#transcript').textContent='Your voice will be sent directly to your matched partner. No AI is speaking here.';

  try{
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
  }catch(err){
    $('#listen').textContent='Microphone permission is required to speak with your partner.';
    $('#transcript').textContent='Allow microphone access in your browser, then press Start speaking.';
    $('#mic').disabled=false;
    $('#mic').textContent='🎙 Allow microphone';
    $('#mic').onclick=async()=>startHumanCall(sessionId,partner);
    return;
  }

  $('#mic').disabled=false;
  $('#mic').textContent='🎙 Start speaking';
  $('#mic').onclick=()=>startCallTransport(sessionId,partner);
  await setupSignaling(sessionId,partner);
}

async function setupSignaling(sessionId,partner){
  if(channel){
    try{await supabaseClient.removeChannel(channel)}catch{}
  }
  channel=supabaseClient.channel('open-talk:'+sessionId,{
    config:{broadcast:{ack:true}}
  });

  channel.on('broadcast',{event:'signal'},async payload=>{
    const msg=payload.payload||{};
    if(msg.from===currentUser.id)return;
    try{
      if(msg.type==='hello'){
        if(currentUser.id<partner.id) await createOffer();
      }else if(msg.type==='offer'){
        await ensurePeer();
        await pc.setRemoteDescription(msg.sdp);
        for(const ice of pendingIce){try{await pc.addIceCandidate(ice)}catch{}}
        pendingIce=[];
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal({type:'answer',sdp:pc.localDescription});
      }else if(msg.type==='answer'){
        if(!pc) return;
        await pc.setRemoteDescription(msg.sdp);
        for(const ice of pendingIce){try{await pc.addIceCandidate(ice)}catch{}}
        pendingIce=[];
      }else if(msg.type==='ice'){
        const ice=msg.candidate;
        if(!pc?.remoteDescription){pendingIce.push(ice);}
        else{try{await pc.addIceCandidate(ice)}catch{}}
      }
    }catch(err){
      $('#listen').textContent='The voice connection needs another attempt. Please leave and find a new partner.';
    }
  });

  await new Promise((resolve,reject)=>{
    channel.subscribe(status=>{
      if(status==='SUBSCRIBED')resolve();
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')reject(new Error('Realtime signaling unavailable'));
    });
  });

  await sendSignal({type:'hello'});
}

async function sendSignal(message){
  if(!channel)return;
  await channel.send({type:'broadcast',event:'signal',payload:{...message,from:currentUser.id}});
}

async function ensurePeer(){
  if(pc)return pc;
  pc=new RTCPeerConnection({
    iceServers:[
      {urls:['stun:stun.cloudflare.com:3478']},
      {urls:['stun:stun.l.google.com:19302']}
    ]
  });

  pc.onicecandidate=e=>{
    if(e.candidate)sendSignal({type:'ice',candidate:e.candidate.toJSON?.()||e.candidate});
  };
  pc.ontrack=e=>{
    const audio=$('#remoteAudio');
    if(audio.srcObject!==e.streams[0])audio.srcObject=e.streams[0];
    audio.play().catch(()=>{});
    $('#listen').textContent='Connected — you are speaking with a real person.';
    $('#partnerMeta').textContent=`${currentPartner?.name||'Your partner'} • LIVE HUMAN CONVERSATION`;
  };
  pc.onconnectionstatechange=()=>{
    if(['failed','disconnected','closed'].includes(pc.connectionState)&&!finishing){
      $('#listen').textContent='Connection interrupted. You can leave and find another person.';
    }
    if(pc.connectionState==='connected')startCallClock();
  };

  if(localStream){
    localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
  }
  return pc;
}

async function createOffer(){
  await ensurePeer();
  const offer=await pc.createOffer({offerToReceiveAudio:true});
  await pc.setLocalDescription(offer);
  await sendSignal({type:'offer',sdp:pc.localDescription});
}

async function startCallTransport(sessionId,partner){
  if(!localStream){
    try{localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});}
    catch{return}
  }
  $('#mic').disabled=true;
  $('#mic').textContent='🔴 Speaking';
  await ensurePeer();
  $('#listen').textContent='Microphone ready. Waiting for the secure audio connection…';
  await sendSignal({type:'hello'});
}

function startCallClock(){
  if(callTimer)return;
  callStartedAt=Date.now();
  callTimer=setInterval(()=>{
    const sec=Math.floor((Date.now()-callStartedAt)/1000);
    $('#timer').textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
  },250);
}

function stopCallClock(){
  clearInterval(callTimer);
  callTimer=null;
}

async function finishConversation(){
  if(finishing)return;
  finishing=true;
  stopMatchPolling();
  const seconds=callStartedAt?Math.max(1,Math.floor((Date.now()-callStartedAt)/1000)):0;
  await teardownCall();

  if(seconds>0){
    const mins=Math.max(1,Math.round(seconds/60));
    s.stats.conversations++;
    s.stats.minutes+=mins;
    s.today.conversations++;
    s.today.minutes+=mins;
    const todayKey=new Date().toISOString().slice(0,10);
    const yesterdayKey=new Date(Date.now()-86400000).toISOString().slice(0,10);
    if(s.stats.lastPracticeDate!==todayKey){
      s.stats.streak=s.stats.lastPracticeDate===yesterdayKey?(s.stats.streak||0)+1:1;
      s.stats.lastPracticeDate=todayKey;
    }
    const lv=['A1','A2','B1','B2','C1','C2'];
    s.stats.level=s.stats.level||lv[Math.min(5,Math.floor(s.stats.conversations/2)+1)];
    if(s.stats.conversations>=1)s.stats.achievements=[...new Set([...s.stats.achievements,'first'])];
    if(s.stats.conversations>=4)s.stats.achievements=[...new Set([...s.stats.achievements,'four'])];
    if(s.stats.minutes>=30)s.stats.achievements=[...new Set([...s.stats.achievements,'thirty'])];
    if((s.stats.streak||0)>=7)s.stats.achievements=[...new Set([...s.stats.achievements,'streak'])];
    if(s.stats.level)s.stats.achievements=[...new Set([...s.stats.achievements,'level'])];
    save();

    if(backendReady){
      try{
        await api('/api/complete-conversation','POST',{
          partner_id:currentPartner?.id||null,
          duration_seconds:seconds
        });
      }catch{}
    }
  }

  $('#feedback').classList.remove('hidden');
  $('#feedback').innerHTML='<b>Conversation complete</b><p>You just practiced with a real person. Your speaking time and progress have been saved.</p>';
  $('#listen').textContent='Conversation ended';
  $('#mic').disabled=true;
  $('#finish').disabled=true;
  toast('Real conversation saved.');
}

async function leaveConversation(){
  if(!$('#modal').classList.contains('hidden'))await teardownCall();
  $('#modal').classList.add('hidden');
  currentPartner=null;
  finishing=false;
}

async function teardownCall(){
  stopMatchPolling();
  stopCallClock();
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  if(pc){pc.close();pc=null;}
  if(channel&&supabaseClient){try{await supabaseClient.removeChannel(channel)}catch{} channel=null;}
  $('#remoteAudio').srcObject=null;
  callStartedAt=0;
}

function renderMilestones(){
  const a=s.stats,m=[
    ['🌱','First conversation','Complete your first real human conversation.',a.conversations>=1],
    ['⚡','Conversation sprint','Complete 4 conversations.',a.conversations>=4],
    ['⏱','30 minute club','Speak for 30 minutes.',a.minutes>=30],
    ['🚀','10 conversations','Become a regular speaker.',a.conversations>=10]
  ];
  $('#milestoneList').innerHTML=m.map(x=>`<div class="card"><b>${x[0]} ${x[1]} ${x[3]?'✓':''}</b><p>${x[2]}</p></div>`).join('');
}

function renderAchievements(){
  const a=s.stats.achievements||[],x=[
    ['first','🎙','First Words'],
    ['four','⚡','Conversation Sprint'],
    ['thirty','⏱','30 Minute Club'],
    ['streak','🔥','On Fire'],
    ['level','🧠','Level Up']
  ];
  $('#achievementGrid').innerHTML=x.map(q=>`<article style="opacity:${a.includes(q[0])?1:.45}"><b style="font-size:32px">${q[1]}</b><h3>${q[2]}</h3><p>${a.includes(q[0])?'Unlocked':'Locked'}</p></article>`).join('');
}

render();
bootstrapBackend();