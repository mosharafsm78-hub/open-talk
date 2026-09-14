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
  a.coins=a.coins||0;
  a.rewardedMilestones=a.rewardedMilestones||[];
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
  $('#coinBalance').textContent=a.coins||0;

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
      .select('id,name,age,country,english_level,gender_preference')
      .eq('id',currentUser.id).maybeSingle();
    if(!pe&&p){s.profile={...s.profile,...p};save();}
    try{
      const rewards=await supabaseClient.from('user_milestone_rewards').select('milestone_key,coins').eq('user_id',currentUser.id);
      if(!rewards.error){
        s.stats.rewardedMilestones=(rewards.data||[]).map(x=>x.milestone_key);
        s.stats.coins=(rewards.data||[]).reduce((sum,x)=>sum+Number(x.coins||0),0);
        save();
      }
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
      const r=await supabaseClient.from('profiles').select('id,name,age,country,english_level,gender_preference').eq('id',currentUser.id).maybeSingle();
      return new Response(JSON.stringify(r.data||{id:currentUser.id}),{status:r.error?500:200,headers:{'content-type':'application/json'}});
    }
    const profile={...body,id:currentUser.id,updated_at:new Date().toISOString()};
    const r=await supabaseClient.from('profiles').upsert(profile).select('id,name,age,country,english_level,gender_preference').single();
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
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===target));
  document.querySelectorAll('nav button[data-view]').forEach(v=>v.classList.toggle('nav-active',v.dataset.view===target));
  scrollTo({top:0,behavior:'smooth'});
});

$('#profileForm').onsubmit=async e=>{
  e.preventDefault();
  const profile={
    name:$('#name').value.trim(),
    age:Number($('#age').value),
    country:$('#country').value,
    gender_preference:$('#gender').value==='Female'?'female':$('#gender').value==='Male'?'male':'any'
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
    }catch(err){toast(err.message);}
  }else toast('Please wait a moment for Open Talk to connect.');
};

async function findPartner(){
  if(finishing)return;
  if(!backendReady){
    toast('Connecting to Open Talk… please try again in a moment.');
    return;
  }
  openConversationModal();
  stopMatchPolling();
  currentPartner=null;
  const preference=$('#matchPreference').value;
  $('#partner').textContent='Looking for someone to talk to…';
  $('#partnerMeta').textContent='Open Talk is finding another real person for you. No AI will replace your partner.';
  $('#listen').textContent='Searching the live waiting room…';
  $('#transcript').innerHTML='<div class="queue-status"><span class="queue-spinner"></span><b>Waiting for a real person</b><small>Keep this window open. We will connect you automatically.</small></div>';
  $('#mic').disabled=true;
  $('#mic').textContent='🎙 Waiting for partner';
  $('#finish').disabled=false;

  const setQueueStage=(stage)=>{
    [1,2,3].forEach(n=>$('#queueStep'+n)?.classList.toggle('active',n===stage));
  };
  const attempt=async()=>{
    try{
      setQueueStage(1);
      const r=await api('/api/match','POST',{preference});
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Matching failed');
      if(data.candidate){
        setQueueStage(2);
        currentPartner={...data.candidate,call_id:data.call_id||data.session_id};
        stopMatchPolling();
        $('#partner').textContent='Your speaking partner is ready';
        $('#partnerMeta').textContent='A real person has been matched with you. No AI is involved.';
        $('#listen').textContent='Great match found — preparing your private connection…';
        $('#transcript').innerHTML='<div class="queue-status success"><span>✓</span><b>Real person found</b><small>Setting up a secure peer-to-peer audio connection.</small></div>';
        setQueueStage(3);
        await startHumanCall(data.session_id,data.candidate);
      }else{
        $('#partner').textContent='Waiting for a real person…';
        $('#partnerMeta').textContent='You are safely in the live matching queue. We will never substitute an AI.';
        $('#listen').textContent='Still looking for someone who is online…';
      }
    }catch(err){
      $('#listen').textContent=err.message||'Unable to reach the matching service.';
      $('#transcript').innerHTML='<div class="queue-status error"><span>!</span><b>We lost the matching connection</b><small>Try again — your profile is safe.</small></div>';
    }
  };
  await attempt();
  if(!currentPartner)matchPoll=setInterval(attempt,3000);
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
          if(Number(reward.coins_earned||0)>0) toast('Milestone unlocked! +'+reward.coins_earned+' coins 🪙');
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

function renderMilestones(){
  const a=s.stats||{};
  const coins=Number(a.coins||0);
  const c=Number(a.conversations||0), mins=Number(a.minutes||0), streak=Number(a.streak||0);
  const m=[
    ['🌱','First Words','Complete your first real human conversation.',c>=1,2,'Start your journey'],
    ['💬','Three Conversations','Finish 3 real conversations.',c>=3,3,'Build the habit'],
    ['⚡','Five Alive','Finish 5 real conversations.',c>=5,5,'You are showing up'],
    ['🚀','Ten Talks','Complete 10 real conversations.',c>=10,7,'Become a regular'],
    ['🌟','Twenty Strong','Complete 20 real conversations.',c>=20,10,'Consistency compounds'],
    ['🏆','Half Century','Complete 50 real conversations.',c>=50,15,'A serious speaker'],
    ['💎','Century Speaker','Complete 100 real conversations.',c>=100,20,'Legendary commitment'],
    ['⏱️','Warm Up','Speak for 10 total minutes.',mins>=10,2,'Get your voice moving'],
    ['🔥','30 Minute Club','Speak for 30 total minutes.',mins>=30,4,'Real practice adds up'],
    ['🎧','One Hour In','Speak for 60 total minutes.',mins>=60,7,'Your fluency is growing'],
    ['🗣️','Three Hour Speaker','Speak for 3 total hours.',mins>=180,12,'Keep the conversation going'],
    ['🌙','Ten Hour Speaker','Speak for 10 total hours.',mins>=600,20,'You have momentum'],
    ['🔥','Three-Day Streak','Practice on 3 consecutive days.',streak>=3,3,'Make showing up automatic'],
    ['📅','Seven-Day Streak','Practice for 7 consecutive days.',streak>=7,6,'A week of courage'],
    ['👑','Thirty-Day Streak','Practice for 30 consecutive days.',streak>=30,15,'This is your new habit']
  ];
  const rewarded=new Set(a.rewardedMilestones||[]);
  const unlocked=m.filter(x=>x[3]).length;
  $('#coinBalance').textContent=coins;
  $('#milestoneCoins').textContent=coins;
  $('#milestoneUnlocked').textContent=unlocked;
  $('#milestoneRemaining').textContent=m.length-unlocked;
  $('#milestoneEarned').textContent=coins;
  $('#milestoneList').innerHTML=m.map(x=>{
    const unlocked=x[3], claimed=rewarded.has(x[1].toLowerCase().replace(/[^a-z0-9]+/g,''));
    const pct=unlocked?100:Math.min(99,Math.round((x[1].includes('Minute')||x[1].includes('Hour')||x[1].includes('Speaker')?mins:x[1].includes('Streak')?streak:c)/(x[1].includes('Minute')?30:x[1].includes('Hour')?60:x[1].includes('Streak')?7:x[1].includes('Century')?100:x[1].includes('Half')?50:x[1].includes('Twenty')?20:x[1].includes('Ten')?10:x[1].includes('Five')?5:x[1].includes('Three')?3:1)*100));
    return `<article class="milestone-card card ${unlocked?'is-unlocked':'is-locked'}">
      <div class="milestone-icon">${x[0]}</div>
      <div class="milestone-body"><div class="milestone-title"><h3>${x[1]}</h3><span class="reward-pill">🪙 +${x[4]}</span></div>
      <p>${x[2]}</p><div class="milestone-bar"><span style="width:${pct}%"></span></div><small>${unlocked?'Milestone complete':'Locked · '+x[5]}</small></div>
      <div class="milestone-state">${unlocked?'✓':'🔒'}</div>
    </article>`;
  }).join('');
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