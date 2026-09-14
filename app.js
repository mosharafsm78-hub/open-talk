const K='openTalkV1';
let s=JSON.parse(localStorage.getItem(K)||'null')||{
  profile:{},
  stats:{conversations:0,minutes:0,level:null,achievements:[],selectedBadges:[],streak:0,lastPracticeDate:null,coins:0,rewardedMilestones:[],coinSpend:0},
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
let remoteSelectedBadges=[];
let activeMatchPasses=[];

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
  const p=s.profile||{},t=s.today||{};
  s.stats=s.stats||{conversations:0,minutes:0,level:null,achievements:[],selectedBadges:[],streak:0,lastPracticeDate:null,coins:0,rewardedMilestones:[],coinSpend:0};
  const a=s.stats;
  a.coins=Number(a.coins||0);
  a.rewardedMilestones=a.rewardedMilestones||[];
  a.selectedBadges=a.selectedBadges||[];
  a.selectedBadges=a.selectedBadges.filter(k=>{try{return !!getAchievement(k)?.unlocked}catch{return false}}).slice(0,3);
  const todayKey=new Date().toISOString().slice(0,10);
  if(t.date!==todayKey){
    s.today={conversations:0,minutes:0,date:todayKey};
  }
  if($('#name'))$('#name').value=p.name||'';
  if($('#age'))$('#age').value=p.age||'';
  if($('#country'))$('#country').value=p.country||'';
  if($('#gender'))$('#gender').value=p.gender||'Prefer not to say';

  const l=a.level||'Not assessed yet';
  if($('#levelValue'))$('#levelValue').textContent=l;
  if($('#homeLevel'))$('#homeLevel').textContent=l;
  if($('#homeMinutes'))$('#homeMinutes').textContent=a.minutes||0;
  if($('#homeConvos'))$('#homeConvos').textContent=a.conversations||0;
  if($('#homeMinutes2'))$('#homeMinutes2').textContent=a.minutes||0;
  if($('#homeLevel2'))$('#homeLevel2').textContent=a.level||'—';
  if($('#homeAch'))$('#homeAch').textContent=(a.achievements||[]).length;
  if($('#statStreakHome'))$('#statStreakHome').textContent=a.streak||0;
  if($('#statConvos'))$('#statConvos').textContent=a.conversations||0;
  if($('#statMinutes'))$('#statMinutes').textContent=a.minutes||0;
  if($('#statStreak'))$('#statStreak').textContent=a.streak||0;
  if($('#statAch'))$('#statAch').textContent=(a.achievements||[]).length;
  if($('#coinBalance'))$('#coinBalance').textContent=a.coins||0;

  const goalDone=Math.min(s.today.conversations||0,4);
  if($('#goalCount'))$('#goalCount').textContent=`${goalDone}/4`;
  if($('#goalStatus'))$('#goalStatus').textContent=goalDone>=4?'Goal completed — beautiful work.':`${4-goalDone} conversation${4-goalDone===1?'':'s'} to go`;
  if($('#goalProgress'))$('#goalProgress').style.width=Math.min(100,goalDone/4*100)+'%';

  const n={A1:12,A2:28,B1:45,B2:62,C1:82,C2:100};
  if($('#levelBar'))$('#levelBar').style.width=(n[l]||0)+'%';
  if($('#profileLock')){
    const lockedUntil=s.profile.locked_until?new Date(s.profile.locked_until):null;
    const locked=lockedUntil&&lockedUntil>new Date();
    const form=$('#profileForm');
    form?.querySelectorAll('input,select,button').forEach(el=>{el.disabled=!!locked;});
    if(locked){
      const days=Math.ceil((lockedUntil-new Date())/86400000);
      $('#profileLock').textContent='Profile locked for '+days+' day'+(days===1?'':'s')+' · you can edit again on '+lockedUntil.toLocaleDateString();
      form?.classList.add('profile-locked');
    }else{
      $('#profileLock').textContent=backendReady
        ?'After saving, your profile is locked for 30 days to keep matching consistent.'
        :'Complete your profile. After saving, it is locked for 30 days.';
      form?.classList.remove('profile-locked');
    }
  }
  renderMilestones();
  renderCoinEarningPreview();
  renderAchievements();
  renderBadgeShowcase();
  if($('#shopCoins'))$('#shopCoins').textContent=a.coins||0;
}

async function bootstrapBackend(){
  try{
    if(!window.supabase?.createClient)throw new Error('Supabase client unavailable');
    supabaseClient=window.supabase.createClient(
      'https://pmyfswozvkdpqgnsiibf.supabase.co',
      'sb_publishable_RrciEiRwRPkbU6yO6wt8Zg_BI0tSYEW'
    );
    const existing=(await supabaseClient.auth.getSession()).data.session;
    if(existing?.access_token){
      authSession=existing;
      currentUser=existing.user;
    }else{
      const {data,error}=await supabaseClient.auth.signInAnonymously();
      if(error)throw error;
      authSession=data.session;
      currentUser=data.user;
    }
    backendReady=!!currentUser;
    const {data:p,error:pe}=await supabaseClient.from('profiles')
      .select('id,name,age,country,gender,english_level,gender_preference,locked_until')
      .eq('id',currentUser.id).maybeSingle();
    if(!pe&&p){s.profile={...s.profile,...p};save();}
    try{
      const rewards=await supabaseClient.from('user_milestone_rewards').select('milestone_key,coins').eq('user_id',currentUser.id);
      const balance=await supabaseClient.rpc('available_coins',{p_user_id:currentUser.id});
      if(!rewards.error) s.stats.rewardedMilestones=(rewards.data||[]).map(x=>x.milestone_key);
      if(!balance.error && Number.isFinite(Number(balance.data))) s.stats.coins=Number(balance.data);
      else s.stats.coins=(rewards.data||[]).reduce((sum,x)=>sum+Number(x.coins||0),0);
      save();
    }catch{}
    updateBackendStatus();
  }catch(e){
    backendReady=false;
    updateBackendStatus();
    console.error('Open Talk backend:',e);
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
  const edgeBase='https://pmyfswozvkdpqgnsiibf.supabase.co/functions/v1';
  if(path==='/api/match'){
    return fetch(edgeBase+'/match',{
      method,
      headers:{authorization:'Bearer '+authSession.access_token,apikey:'sb_publishable_RrciEiRwRPkbU6yO6wt8Zg_BI0tSYEW','content-type':'application/json'},
      body:body?JSON.stringify(body):undefined
    });
  }
  if(path==='/api/profile'){
    if(method==='GET'){
      const r=await supabaseClient.from('profiles').select('id,name,age,country,gender,english_level,gender_preference').eq('id',currentUser.id).maybeSingle();
      return new Response(JSON.stringify(r.data||{id:currentUser.id}),{status:r.error?500:200,headers:{'content-type':'application/json'}});
    }
    const profile={...body,id:currentUser.id,updated_at:new Date().toISOString()};
    const r=await supabaseClient.from('profiles').upsert(profile).select('id,name,age,country,gender,english_level,gender_preference').single();
    return new Response(JSON.stringify(r.data||{error:r.error?.message}),{status:r.error?500:200,headers:{'content-type':'application/json'}});
  }
  if(path==='/api/complete-conversation'){
    const r=await supabaseClient.from('calls').update({status:'completed',ended_at:new Date().toISOString(),duration_seconds:body?.duration_seconds||0}).eq('id',body?.call_id||currentPartner?.call_id);
    return new Response(JSON.stringify({ok:!r.error}),{status:r.error?500:200,headers:{'content-type':'application/json'}});
  }
  throw new Error('Unknown API route');
}

document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
  const target=b.dataset.view;
  if(b.dataset.action==='talk'){
    findPartner();
    return;
  }
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===target));
  document.querySelectorAll('nav button[data-view]').forEach(v=>v.classList.toggle('nav-active',v.dataset.view===target));
  document.querySelectorAll('.mobile-nav-item[data-view]').forEach(v=>v.classList.toggle('nav-active',v.dataset.view===target && !v.dataset.action));
  if(target==='milestones') renderMilestones();
  if(target==='achievements') renderAchievements();
  if(target==='coins') renderCoinEarningPreview();
  scrollTo({top:0,behavior:'smooth'});
});

$('#profileForm').onsubmit=async e=>{
  e.preventDefault();
  const profile={
    name:$('#name').value.trim(),
    age:Number($('#age').value),
    country:$('#country').value,
    gender:$('#gender').value==='Female'?'female':$('#gender').value==='Male'?'male':$('#gender').value==='Other'?'other':'',
    // profiles.english_level is required in Supabase; use the latest AI level or a safe initial level.
    english_level:s.stats.level||s.profile.english_level||'A1',
    gender_preference:s.profile.gender_preference||'any'
  };
  const lockedUntil=s.profile.locked_until?new Date(s.profile.locked_until):null;
  if(lockedUntil&&lockedUntil>new Date()){
    toast('Your profile is locked until '+lockedUntil.toLocaleDateString()+'.');
    render();
    return;
  }
  if(backendReady){
    try{
      const r=await api('/api/profile','POST',profile);
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Profile could not be saved');
      s.profile={...s.profile,...data,savedAt:Date.now()};
      save();
      render();
      toast('Profile saved. It is now locked for 30 days.');
    }catch(err){toast(err.message);}
  }else toast('Please wait a moment for Open Talk to connect.');
};

function passTarget(m){
  if(m.filterCount>=2) return {type:'smart',target:(m.gender||'any')+'|'+(m.country||'')+'|'+(m.level||''),hours:24,cost:8,label:'Smart Match'};
  if(m.gender!=='any') return {type:'gender',target:m.gender,hours:12,cost:4,label:'Gender'};
  if(m.country) return {type:'country',target:m.country,hours:12,cost:5,label:'Country'};
  if(m.level) return {type:'level',target:m.level,hours:12,cost:4,label:'Level'};
  return null;
}

function hasActivePass(type,target){
  return activeMatchPasses.some(p=>p.pass_type===type && p.target_value===target && new Date(p.expires_at)>new Date());
}

function activePassExpiry(type,target){
  const p=activeMatchPasses.find(x=>x.pass_type===type && x.target_value===target && new Date(x.expires_at)>new Date());
  return p?new Date(p.expires_at):null;
}

async function refreshMatchPasses(){
  if(!supabaseClient||!currentUser)return;
  try{
    const r=await supabaseClient.from('match_passes')
      .select('pass_type,target_value,expires_at')
      .eq('user_id',currentUser.id)
      .gt('expires_at',new Date().toISOString())
      .order('expires_at',{ascending:true});
    if(!r.error) activeMatchPasses=r.data||[];
  }catch{}
}

function matchSelection(){
  const gender=$('#matchGender')?.value||'any';
  const country=$('#matchCountry')?.value||'';
  const level=$('#matchLevel')?.value||'';
  const priority=!!$('#matchPriority')?.checked;
  const filterCount=[gender!=='any',!!country,!!level].filter(Boolean).length;
  const base=passTarget({gender,country,level,filterCount});
  const baseActive=!!base&&hasActivePass(base.type,base.target);
  const priorityActive=priority&&hasActivePass('priority','priority');
  const baseCost=base&&!baseActive?base.cost:0;
  const priorityCost=priority&&!priorityActive?3:0;
  const cost=baseCost+priorityCost;
  const hours=base?.hours||(priority?12:0);
  return {gender,country,level,priority,cost,filterCount,base,baseActive,priorityActive,baseCost,priorityCost,hours};
}

function formatExpiry(date){
  if(!date)return '';
  const ms=Math.max(0,date.getTime()-Date.now());
  const h=Math.max(1,Math.floor(ms/3600000));
  const d=Math.floor(h/24);
  return d>=1?d+'d '+(h%24)+'h':h+'h';
}

function updateMatchSelectionUI(){
  const m=matchSelection();
  const balance=Number(s.stats?.coins||0);
  const cost=$('#matchCost');
  const note=$('#matchCostNote');
  const startBtn=$('#mic');
  if(cost) cost.textContent=m.cost?m.cost+' coins':(m.base||m.priority?'ACTIVE':'FREE');
  const activeParts=[];
  if(m.baseActive) activeParts.push((m.base.label)+' active · '+formatExpiry(activePassExpiry(m.base.type,m.base.target)));
  if(m.priorityActive) activeParts.push('Priority active · '+formatExpiry(activePassExpiry('priority','priority')));
  if(note){
    if(activeParts.length && !m.cost) note.textContent=activeParts.join(' • ');
    else if(m.cost) note.textContent=balance>=m.cost
      ? (m.base?.hours===24?'24-hour Smart Match access.':'12-hour matching access.')+' Activated only when a real person is found.'
      : 'You need '+(m.cost-balance)+' more coins.';
    else note.textContent='Open matching is free. No coins are used.';
  }
  if(startBtn && !currentPartner){
    startBtn.textContent=m.cost?'🪙 Find a match · '+m.cost+' coins':'🎙 Find a real person';
  }
  const controls=$('#matchControls');
  if(controls) controls.classList.toggle('insufficient',m.cost>balance);
}

async function findPartner(){
  if(finishing)return;
  if(!backendReady){ toast('Connecting to Open Talk… please try again in a moment.'); return; }
  const p=s.profile||{};
  if(!p.name||!p.age||!p.country||!p.gender){
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='profile'));
    document.querySelectorAll('nav button[data-view]').forEach(v=>v.classList.toggle('nav-active',v.dataset.view==='profile'));
    toast('Complete your profile first — it takes less than a minute.');
    return;
  }
  await refreshMatchPasses();
  const match=matchSelection();
  if(match.cost>Number(s.stats?.coins||0)){
    toast('Not enough coins. Choose Open Match or earn more coins from Milestones.');
    openConversationModal();
    updateMatchSelectionUI();
    return;
  }
  openConversationModal();
  stopMatchPolling();
  currentPartner=null;
  $('#partner').textContent='Looking for someone to talk to…';
  $('#partnerMeta').textContent=match.cost
    ? (match.base?.hours===24?'Smart Match is ready for 24-hour access.':'Your preference is ready for 12-hour access.')+' No charge until a real person is found.'
    : 'Open Talk is finding another real person for you. No AI will replace your partner.';
  $('#listen').textContent='Searching the live waiting room…';
  $('#transcript').innerHTML='<div class="queue-status"><span class="queue-spinner"></span><b>Waiting for a real person</b><small>Keep this window open. Your coins are safe until a match is found.</small></div>';
  $('#mic').disabled=true;
  $('#finish').disabled=false;
  updateMatchSelectionUI();

  const setQueueStage=(stage)=>{ [1,2,3].forEach(n=>$('#queueStep'+n)?.classList.toggle('active',n===stage)); };
  const attempt=async()=>{
    try{
      setQueueStage(1);
      const r=await api('/api/match','POST',{
        target_country:match.country,
        target_level:match.level,
        gender_preference:match.gender,
        priority:match.priority,
        coin_cost:match.cost
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Matching failed');
      if(data.new_balance!==null && data.new_balance!==undefined){
        s.stats.coins=Number(data.new_balance);
        save();
      }
      if(Number(data.coins_charged||0)>0 && data.pass_expires_at){
        toast((data.pass_type==='smart'?'Smart Match':'Matching preference')+' activated for '+(data.pass_type==='smart'?'24 hours':'12 hours')+'.');
      }
      await refreshMatchPasses();
      updateMatchSelectionUI();
      if(data.candidate){
        setQueueStage(2);
        currentPartner={...data.candidate,call_id:data.call_id||data.session_id};
        stopMatchPolling();
        $('#partner').textContent='Your speaking partner is ready';
        await refreshMatchPasses();
        $('#partnerMeta').textContent=(data.candidate.name||'Your speaking partner')+' • '+(data.candidate.country||'Global')+' • '+(data.candidate.level||'level not assessed');
        remoteSelectedBadges=[];
        renderRemoteBadges();
        $('#listen').textContent='Great match found — preparing your private connection…';
        $('#transcript').innerHTML='<div class="queue-status success"><span>✓</span><b>Real person found</b><small>Your selected preferences matched. Setting up the private audio connection.</small></div>';
        setQueueStage(3);
        await startHumanCall(data.session_id,data.candidate);
      }else{
        $('#partner').textContent='Waiting for a real person…';
        $('#partnerMeta').textContent=match.cost
          ? 'Your preferred match is not online yet. Your coins remain untouched.'
          : 'You are safely in the live matching queue. We will never substitute an AI.';
        $('#listen').textContent='Still looking for someone who is online…';
      }
    }catch(err){
      console.error('Open Talk match:',err);
      $('#listen').textContent='The live matching service needs another attempt.';
      $('#transcript').innerHTML='<div class="queue-status error"><span>!</span><b>We could not reach the matching service</b><small>Your profile and coins are safe. Please try again.</small></div>';
      stopMatchPolling();
    }
  };
  await attempt();
  if(!currentPartner)matchPoll=setInterval(attempt,4000);
}

function stopMatchPolling(){
  if(matchPoll){clearInterval(matchPoll);matchPoll=null;}
}

function openConversationModal(){
  finishing=false;
  $('#modal').classList.remove('hidden');
  refreshMatchPasses().finally(updateMatchSelectionUI);
  $('#feedback').classList.add('hidden');
  $('#feedback').innerHTML='';
  $('#timer').textContent='00:00';
  $('#finish').disabled=true;
  $('#mic').disabled=true;
}

$('#talkNow')?.addEventListener('click',findPartner);
$('#findPartner')?.addEventListener('click',findPartner);
['matchGender','matchCountry','matchLevel','matchPriority'].forEach(id=>$('#'+id)?.addEventListener('change',updateMatchSelectionUI));

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
        remoteSelectedBadges=Array.isArray(msg.selectedBadges)?msg.selectedBadges.slice(0,3):[];
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
  await channel.send({type:'broadcast',event:'signal',payload:{...message,from:currentUser.id,selectedBadges:s.stats.selectedBadges||[]}});
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
    renderRemoteBadges();
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
  if(!currentPartner && !callStartedAt){
    await leaveConversation();
    toast('You left the waiting room.');
    return;
  }
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
    s.stats.achievements=[...new Set(ACHIEVEMENTS.filter(x=>x[4]({...s.stats,today:Number(s.today?.conversations||0)})).map(x=>x[0]))];
    s.stats.selectedBadges=(s.stats.selectedBadges||[]).filter(k=>s.stats.achievements.includes(k)).slice(0,3);
    save();

    if(backendReady){
      try{
        await api('/api/complete-conversation','POST',{
          partner_id:currentPartner?.id||null,
          duration_seconds:seconds
        });
        const rewardResult=await supabaseClient.rpc('award_eligible_milestones',{p_user_id:currentUser.id});
        const reward=rewardResult.data?.[0];
        if(!rewardResult.error && reward){
          s.stats.coins=Number(reward.total_coins||s.stats.coins||0);
          s.stats.rewardedMilestones=[...new Set([...(s.stats.rewardedMilestones||[]),...(reward.newly_awarded||[])])];
          save();
          if(Number(reward.coins_earned||0)>0) toast('Milestone unlocked! +'+reward.coins_earned+' coins');
        }
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

function milestoneKey(title){return title.toLowerCase().replace(/[^a-z0-9]+/g,'');}

const MILESTONES=[
    ['🌱','First Words','Complete your first real human conversation.',a=>a.conversations>=1,1,'Take the first step','easy'],
    ['💬','Two Talks','Complete 2 real conversations.',a=>a.conversations>=2,1,'Keep going','easy'],
    ['⏱️','Warm Up','Speak for 10 total minutes.',a=>a.minutes>=10,1,'Get your voice moving','easy'],
    ['🌱','Two-Day Streak','Practice on 2 consecutive days.',a=>a.streak>=2,1,'Come back tomorrow','easy'],
    ['✨','Three Conversations','Complete 3 real conversations.',a=>a.conversations>=3,1,'Build the habit','easy'],
    ['⚡','Five Alive','Complete 5 real conversations.',a=>a.conversations>=5,1,'You are showing up','easy'],
    ['🔥','30 Minute Club','Speak for 30 total minutes.',a=>a.minutes>=30,1,'Real practice adds up','easy'],
    ['🚀','Ten Talks','Complete 10 real conversations.',a=>a.conversations>=10,2,'Become a regular','medium'],
    ['🌟','Twenty Strong','Complete 20 real conversations.',a=>a.conversations>=20,2,'Consistency compounds','medium'],
    ['🎧','One Hour In','Speak for 60 total minutes.',a=>a.minutes>=60,2,'Your fluency is growing','medium'],
    ['📅','Seven-Day Streak','Practice for 7 consecutive days.',a=>a.streak>=7,2,'A week of courage','medium'],
    ['🏅','Thirty Conversations','Complete 30 real conversations.',a=>a.conversations>=30,2,'You are building fluency','medium'],
    ['🗣️','Three Hour Speaker','Speak for 3 total hours.',a=>a.minutes>=180,2,'Keep the conversation going','medium'],
    ['🌈','Fourteen-Day Streak','Practice for 14 consecutive days.',a=>a.streak>=14,2,'Two weeks of momentum','medium'],
    ['🎙️','Conversation Builder','Complete 15 real conversations.',a=>a.conversations>=15,2,'Keep the flow going','medium'],
    ['💫','Fluency Momentum','Complete 25 real conversations.',a=>a.conversations>=25,2,'Confidence grows through repetition','medium'],
    ['🏆','Half Century','Complete 50 real conversations.',a=>a.conversations>=50,4,'A serious speaker','hard'],
    ['💎','Century Speaker','Complete 100 real conversations.',a=>a.conversations>=100,4,'Legendary commitment','hard'],
    ['🌙','Five Hour Speaker','Speak for 5 total hours.',a=>a.minutes>=300,4,'Real staying power','hard'],
    ['👑','Ten Hour Speaker','Speak for 10 total hours.',a=>a.minutes>=600,4,'Exceptional commitment','hard'],
    ['🔥','Thirty-Day Streak','Practice for 30 consecutive days.',a=>a.streak>=30,4,'This is a real habit','hard'],
    ['◎','Global Speaker','Complete 75 real conversations.',a=>a.conversations>=75,4,'Keep meeting the world','hard'],
    ['🛡️','Two Hundred Conversations','Complete 200 real conversations.',a=>a.conversations>=200,4,'You are part of the community','hard'],
    ['🚀','Twenty Hour Speaker','Speak for 20 total hours.',a=>a.minutes>=1200,4,'Mastery takes time','hard']
  ];;


function renderCoinEarningPreview(){
  const host=$('#coinEarningPreview'); if(!host)return;
  const a=s.stats||{}, c=Number(a.conversations||0), mins=Number(a.minutes||0), streak=Number(a.streak||0);
  const tiers=[
    {key:'easy',label:'Easy',icon:'🌱',sub:'First steps',reward:'1 coin'},
    {key:'medium',label:'Medium',icon:'⚡',sub:'Consistency',reward:'2 coins'},
    {key:'hard',label:'Hard',icon:'🏆',sub:'Serious commitment',reward:'4 coins'}
  ];
  const valueFor=(title)=>{
    if(/Minute|Hour|Speaker/.test(title)){
      const targets={'Warm Up':10,'30 Minute Club':30,'One Hour In':60,'Three Hour Speaker':180,'Five Hour Speaker':300,'Ten Hour Speaker':600,'Twenty Hour Speaker':1200};
      return [mins,targets[title]||1];
    }
    if(/Streak/.test(title)){
      const targets={'Two-Day Streak':2,'Seven-Day Streak':7,'Fourteen-Day Streak':14,'Thirty-Day Streak':30};
      return [streak,targets[title]||1];
    }
    const targets={'First Words':1,'Two Talks':2,'Three Conversations':3,'Five Alive':5,'Ten Talks':10,'Twenty Strong':20,'Thirty Conversations':30,'Half Century':50,'Century Speaker':100,'Global Speaker':75,'Two Hundred Conversations':200,'Conversation Builder':15,'Fluency Momentum':25};
    return [c,targets[title]||1];
  };
  host.innerHTML=tiers.map(tier=>{
    const items=MILESTONES.filter(x=>x[6]===tier.key);
    const earned=items.filter(x=>x[3]({conversations:c,minutes:mins,streak})).length;
    const examples=items.slice(0,3).map(x=>{
      const [cur,target]=valueFor(x[1]);
      const done=x[3]({conversations:c,minutes:mins,streak});
      return '<div class="coin-earning-item"><span class="coin-earning-check">'+(done?'✓':'○')+'</span><div><b>'+x[1]+'</b><small>'+x[2]+'</small></div><strong>+'+x[4]+'</strong></div>';
    }).join('');
    return '<article class="coin-tier '+tier.key+'"><div class="coin-tier-top"><div><span class="tier-icon">'+tier.icon+'</span><div><b>'+tier.label+'</b><small>'+tier.sub+' · '+tier.reward+'</small></div></div><em>'+earned+'/'+items.length+'</em></div>'+examples+'</article>';
  }).join('');
}

function renderMilestones(){
  const host=$('#milestoneList');
  if(!host)return;
  const a=s.stats||{},coins=Number(a.coins||0);
  const c=Number(a.conversations||0),mins=Number(a.minutes||0),streak=Number(a.streak||0);
  const m=MILESTONES;
  const rewarded=new Set(a.rewardedMilestones||[]);
  const tiers=[
    {key:'easy',label:'Easy wins',sub:'Start small · 1 coin each',icon:'🌱'},
    {key:'medium',label:'Medium milestones',sub:'Consistency · 2 coins each',icon:'⚡'},
    {key:'hard',label:'Hard milestones',sub:'Serious commitment · 4 coins each',icon:'🏆'}
  ];
  const unlocked=m.filter(x=>x[3]({conversations:c,minutes:mins,streak})).length;
  if($('#coinBalance')) $('#coinBalance').textContent=coins;
  if($('#milestoneCoins')) $('#milestoneCoins').textContent=coins;
  $('#milestoneUnlocked').textContent=unlocked;
  $('#milestoneRemaining').textContent=m.length-unlocked;
  $('#milestoneEarned').textContent=coins;

  const currentFor=(title)=>{
    const minuteTargets={'Warm Up':10,'30 Minute Club':30,'One Hour In':60,'Three Hour Speaker':180,'Five Hour Speaker':300,'Ten Hour Speaker':600,'Twenty Hour Speaker':1200};
    const streakTargets={'Two-Day Streak':2,'Seven-Day Streak':7,'Fourteen-Day Streak':14,'Thirty-Day Streak':30};
    const conversationTargets={'First Words':1,'Two Talks':2,'Three Conversations':3,'Five Alive':5,'Ten Talks':10,'Twenty Strong':20,'Thirty Conversations':30,'Half Century':50,'Century Speaker':100,'Global Speaker':75,'Two Hundred Conversations':200,'Conversation Builder':15,'Fluency Momentum':25};
    if(Object.prototype.hasOwnProperty.call(minuteTargets,title)) return [mins,minuteTargets[title]];
    if(Object.prototype.hasOwnProperty.call(streakTargets,title)) return [streak,streakTargets[title]];
    return [c,conversationTargets[title]||1];
  };

  const list=$('#milestoneList');
  if(!list)return;
  list.innerHTML=tiers.map(tier=>{
    const items=m.filter(x=>x[6]===tier.key);
    return '<section class="milestone-tier milestone-tier-'+tier.key+'">'+
      '<div class="tier-heading"><div class="tier-icon">'+tier.icon+'</div><div><span>'+tier.label+'</span><small>'+tier.sub+'</small></div><b>'+items.filter(x=>x[3]({conversations:c,minutes:mins,streak})).length+'/'+items.length+'</b></div>'+
      '<div class="tier-grid">'+items.map(x=>{
        const key=milestoneKey(x[1]),claimed=rewarded.has(key);
        const [current,target]=currentFor(x[1]);
        const done=x[3]({conversations:c,minutes:mins,streak}); const pct=done?100:Math.min(99,Math.round((current/target)*100));
        return '<article class="milestone-card card '+(done?'is-unlocked':'is-locked')+' milestone-tier-card">'+
          '<div class="milestone-icon">'+x[0]+'</div>'+
          '<div class="milestone-body"><div class="milestone-title"><h3>'+x[1]+'</h3><span class="reward-pill">+ '+x[4]+' coins</span></div>'+
          '<p>'+x[2]+'</p><div class="milestone-bar"><span style="width:'+pct+'%"></span></div>'+
          '<small>'+ (done?(claimed?'Reward credited':'Milestone complete'):'Locked · '+x[5]) +'</small></div>'+
          '<div class="milestone-state">'+(done?'✓':'🔒')+'</div>'+
        '</article>';
      }).join('')+'</div></section>';
  }).join('');
}


const ACHIEVEMENTS=[
  // EASY — badges that make the first weeks feel rewarding.
  ['first','🎙️','First Words','Complete your first human conversation.',s=>s.conversations>=1,'easy'],
  ['three','💬','Getting Comfortable','Complete 3 conversations.',s=>s.conversations>=3,'easy'],
  ['five','🔥','On Fire','Complete 5 conversations.',s=>s.conversations>=5,'easy'],
  ['tenmin','⏱️','Warm Up','Speak for 10 minutes.',s=>s.minutes>=10,'easy'],
  ['thirtymin','⏳','30 Minute Club','Speak for 30 minutes.',s=>s.minutes>=30,'easy'],
  ['streak2','🌱','Day Two','Practice 2 days in a row.',s=>s.streak>=2,'easy'],
  ['streak3','🔥','Three-Day Fire','Practice 3 days in a row.',s=>s.streak>=3,'easy'],
  ['early','🌅','Showed Up','Complete 1 conversation today.',s=>s.today>=1,'easy'],
  ['daily2','☀️','Double Down','Complete 2 conversations today.',s=>s.today>=2,'easy'],
  ['level','🧠','Level Up','Receive a speaking level.',s=>!!s.level,'easy'],

  // MEDIUM — consistency starts to matter.
  ['ten','⚡','Conversation Sprint','Complete 10 conversations.',s=>s.conversations>=10,'medium'],
  ['twenty','🌟','Twenty Strong','Complete 20 conversations.',s=>s.conversations>=20,'medium'],
  ['sixtymin','🎧','One Hour In','Speak for 60 minutes.',s=>s.minutes>=60,'medium'],
  ['threehours','🗣️','Three Hour Speaker','Speak for 3 hours.',s=>s.minutes>=180,'medium'],
  ['streak7','📅','Week Warrior','Practice 7 days in a row.',s=>s.streak>=7,'medium'],
  ['streak14','🌈','Fortnight Flow','Practice 14 days in a row.',s=>s.streak>=14,'medium'],
  ['listener','🤝','Good Listener','Complete 5 conversations.',s=>s.conversations>=5,'medium'],
  ['builder','🎙️','Conversation Builder','Complete 15 conversations.',s=>s.conversations>=15,'medium'],
  ['momentum','💫','Fluency Momentum','Complete 25 conversations.',s=>s.conversations>=25,'medium'],
  ['daily4','🎯','Goal Getter','Complete 4 conversations today.',s=>s.today>=4,'medium'],
  ['fortyfive','🧠','Deep Practice','Speak for 45 minutes.',s=>s.minutes>=45,'medium'],
  ['ninety','🚀','Ninety Minutes','Speak for 90 minutes.',s=>s.minutes>=90,'medium'],

  // HARD — prestigious badges for people who genuinely stick around.
  ['fifty','🏆','Half Century','Complete 50 conversations.',s=>s.conversations>=50,'hard'],
  ['hundred','💎','Century Speaker','Complete 100 conversations.',s=>s.conversations>=100,'hard'],
  ['fivehours','🌙','Five Hour Speaker','Speak for 5 hours.',s=>s.minutes>=300,'hard'],
  ['tenhours','👑','Ten Hour Speaker','Speak for 10 hours.',s=>s.minutes>=600,'hard'],
  ['streak30','🔥','Thirty-Day Speaker','Practice 30 days in a row.',s=>s.streak>=30,'hard'],
  ['world','◎','Global Speaker','Complete 75 conversations.',s=>s.conversations>=75,'hard'],
  ['twohundred','🛡️','Two Hundred Conversations','Complete 200 conversations.',s=>s.conversations>=200,'hard'],
  ['twentyhours','🚀','Twenty Hour Speaker','Speak for 20 hours.',s=>s.minutes>=1200,'hard'],
  ['streak60','👑','Sixty-Day Speaker','Practice 60 days in a row.',s=>s.streak>=60,'hard'],
  ['twofifty','💠','Quarter Thousand','Complete 250 conversations.',s=>s.conversations>=250,'hard'],
  ['consistent','💫','Consistency Wins','Practice on 5 separate days.',s=>s.streak>=5,'medium']
];

function getAchievement(key){
  const item=ACHIEVEMENTS.find(x=>x[0]===key);
  if(!item)return null;
  const a=s.stats||{};
  return {key:item[0],icon:item[1],title:item[2],desc:item[3],unlocked:!!item[4]({...a,today:Number(s.today?.conversations||0)}),tier:item[5]||'easy'};
}
function toggleBadge(key){
  const badge=getAchievement(key);
  if(!badge?.unlocked)return toast('Earn this achievement first.');
  const selected=new Set(s.stats.selectedBadges||[]);
  if(selected.has(key)) selected.delete(key);
  else if(selected.size>=3) return toast('Choose up to 3 badges to showcase.');
  else selected.add(key);
  s.stats.selectedBadges=[...selected];
  save();
  toast(selected.has(key)?badge.title+' added to your showcase.':'Badge removed from your showcase.');
}
function renderBadgeShowcase(){
  const host=$('#badgeShowcase'); if(!host)return;
  const selected=s.stats.selectedBadges||[];
  host.innerHTML=selected.length?selected.map(k=>{const a=getAchievement(k);return a?'<span class="showcase-badge"><b>'+a.icon+'</b>'+a.title+'</span>':''}).join(''):'<span class="showcase-empty">Choose up to 3 earned badges below. People you connect with will see them.</span>';
}
function renderRemoteBadges(){
  const host=$('#remoteBadges'); if(!host)return;
  const badges=(remoteSelectedBadges||[]).map(getAchievement).filter(Boolean);
  host.innerHTML=badges.length?'<span class="remote-label">THEIR ACHIEVEMENTS</span>'+badges.map(a=>'<span class="remote-badge"><b>'+a.icon+'</b>'+a.title+'</span>').join(''):'<span class="remote-empty">Achievement badges will appear here when your partner has chosen them.</span>';
}
function renderAchievements(){
  const host=$('#achievementGrid');
  if(!host)return;
  const selected=new Set(s.stats.selectedBadges||[]);
  const tiers=[
    {key:'easy',label:'Easy',sub:'Early wins · build your identity',icon:'🌱'},
    {key:'medium',label:'Medium',sub:'Consistency · badges worth keeping',icon:'⚡'},
    {key:'hard',label:'Hard',sub:'Prestige · genuinely difficult',icon:'🏆'}
  ];
  host.innerHTML=tiers.map(tier=>{
    const items=ACHIEVEMENTS.filter(q=>q[5]===tier.key);
    const earned=items.filter(q=>getAchievement(q[0])?.unlocked).length;
    return '<section class="achievement-tier achievement-tier-'+tier.key+'">'+
      '<div class="achievement-tier-heading"><div class="tier-icon">'+tier.icon+'</div><div><span>'+tier.label+' achievements</span><small>'+tier.sub+'</small></div><b>'+earned+'/'+items.length+'</b></div>'+
      '<div class="achievement-grid-inner">'+items.map(q=>{
        const a=getAchievement(q[0]),isSelected=selected.has(q[0]);
        return '<button type="button" class="achievement-card '+(a.unlocked?'earned':'locked')+(isSelected?' selected':'')+'" data-achievement="'+a.key+'" '+(a.unlocked?'':'disabled')+'>'+
          '<span class="achievement-icon">'+a.icon+'</span><span class="achievement-copy"><b>'+a.title+'</b><small>'+a.desc+'</small><em>'+(a.unlocked?(isSelected?'✓ Showcased':'Earned · tap to showcase'):'Locked')+'</em></span>'+
          '<span class="achievement-check">'+(isSelected?'✓':a.unlocked?'＋':'🔒')+'</span></button>';
      }).join('')+'</div></section>';
  }).join('');
  host.querySelectorAll('[data-achievement]').forEach(btn=>btn.onclick=()=>toggleBadge(btn.dataset.achievement));
  const count=(s.stats.selectedBadges||[]).length;
  if($('#badgeCount'))$('#badgeCount').textContent=count+'/3';
  renderBadgeShowcase();
}




render();
bootstrapBackend();