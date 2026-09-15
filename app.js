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
let signalingSessionId=null;
let pc=null;
let localStream=null;
let pendingIce=[];
let callStartedAt=0;
let callTimer=null;
let finishing=false;
let remoteSelectedBadges=[];
let remoteStream=null;
let remoteTrackReady=false;
let audioPlaybackReady=false;
let rtcConnected=false;
let rtcOfferInFlight=false;
let audioFlowReady=false;
let audioFlowTimer=null;
let activeMatchPasses=[];
let remoteAudioContext=null;
let remoteAudioSource=null;
let remoteAudioGain=null;
let signalPoll=null;
let signalPollBusy=false;
let signalSeen=new Set();
let callStatePoll=null;
let callStatePollBusy=false;

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
  const profileComplete=!!(p.name&&p.age&&p.country&&p.gender);
  if($('#name'))$('#name').value=p.name||'';
  if($('#age'))$('#age').value=p.age||'';
  if($('#country'))$('#country').value=p.country||'';
  if($('#gender'))$('#gender').value=p.gender||'Prefer not to say';
  $('#profileForm')?.classList.toggle('hidden',profileComplete);
  $('#profileSummary')?.classList.toggle('hidden',!profileComplete);
  if(profileComplete){
    $('#profileSummaryName').textContent=p.name;
    $('#profileSummaryAge').textContent=String(p.age);
    $('#profileSummaryCountry').textContent=p.country;
    $('#profileSummaryGender').textContent=p.gender==='female'?'Female':p.gender==='male'?'Male':p.gender==='other'?'Other':p.gender;
  }

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
  if($('#profileLock'))$('#profileLock').textContent=backendReady
    ?'Your profile stays editable. Changes are used for future matching.'
    :'Profile is editable locally. Live matching activates when the backend is connected.';
  renderMilestones();
  renderCoinEarningPreview();
  renderAchievements();
  renderBadgeShowcase();
  if($('#shopCoins'))$('#shopCoins').textContent=a.coins||0;
}

let authMode='signin';

function openAuthModal(mode='signin'){
  authMode=mode;
  const modal=$('#authModal');
  if(!modal)return;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const signedIn=!!currentUser;
  $('#authUserPanel')?.classList.toggle('hidden',!signedIn);
  $('#authForm')?.classList.toggle('hidden',signedIn);
  $('#authTitle').textContent=signedIn?'Your Open Talk account':'';
  $('#authSubtitle').textContent=signedIn?'You are signed in. Your profile, progress and conversations are linked to this account.':'';
  $('#authUserEmail').textContent=currentUser?.email||'Authenticated account';
  if(!signedIn){
    $('#authForm')?.classList.remove('hidden');
    setAuthMode(mode);
    setTimeout(()=>$(mode==='signup'?'#authName':'#authEmail')?.focus(),50);
  }
}
function closeAuthModal(){
  $('#authModal')?.classList.add('hidden');
  document.body.classList.remove('modal-open');
}
function setAuthMode(mode){
  authMode=mode==='signup'?'signup':'signin';
  const signup=authMode==='signup';
  $('#signInTab')?.classList.toggle('active',!signup);
  $('#signUpTab')?.classList.toggle('active',signup);
  $('#signupFields')?.classList.toggle('hidden',!signup);
  $('#authTitle').textContent=signup?'Create your Open Talk account':'Welcome back';
  $('#authSubtitle').textContent=signup
    ?'Create an account to keep your profile, progress and conversations safe across devices.'
    :'Sign in to keep your profile, progress and conversations connected.';
  $('#authSubmit').innerHTML=signup?'Create account <b>→</b>':'Sign in <b>→</b>';
  $('#authPassword').setAttribute('autocomplete',signup?'new-password':'current-password');
  $('#authMessage').textContent='';
}
function updateAuthUI(){
  const button=$('#authButton');
  const avatar=$('.avatar');
  const email=currentUser?.email||'';
  if(button){
    button.textContent=currentUser ? (email?email.split('@')[0]:'Account') : 'Sign in / Sign up';
    button.title=currentUser?'Open account':'Sign in or create an account';
  }
  if(avatar){
    avatar.textContent=currentUser?.user_metadata?.name?.charAt(0)?.toUpperCase() || s.profile?.name?.charAt(0)?.toUpperCase() || 'M';
  }
}
async function loadAuthenticatedProfile(){
  if(!supabaseClient||!currentUser)return;
  try{
    const {data,error}=await supabaseClient.from('profiles')
      .select('id,name,age,country,gender,english_level,gender_preference')
      .eq('id',currentUser.id).maybeSingle();
    if(error)throw error;
    if(data){
      s.profile={...s.profile,...data};
      save();
    }
  }catch(err){console.warn('Open Talk profile load:',err);}
}
async function handleAuthSubmit(event){
  event.preventDefault();
  if(!supabaseClient){
    $('#authMessage').textContent='Authentication is still loading. Please try again.';
    return;
  }
  const email=$('#authEmail').value.trim().toLowerCase();
  const password=$('#authPassword').value;
  const message=$('#authMessage');
  const submit=$('#authSubmit');
  submit.disabled=true;
  message.textContent='Please wait…';
  try{
    if(authMode==='signup'){
      const name=$('#authName').value.trim();
      const age=Number($('#authAge').value);
      if(!name||!age||age<13||age>100)throw new Error('Please enter your name and a valid age (13–100).');
      const {data,error}=await supabaseClient.auth.signUp({
        email,password,
        options:{data:{name,age}}
      });
      if(error)throw error;
      if(data.session?.user){
        authSession=data.session;
        currentUser=data.session.user;
        backendReady=true;
        s.profile={...s.profile,name,age};
        save();
        try{
          await supabaseClient.from('profiles').upsert({
            id:currentUser.id,name,age,
            country:s.profile.country||'',
            gender:s.profile.gender||'',
            english_level:s.stats.level||'A1',
            gender_preference:s.profile.gender_preference||'any',
            updated_at:new Date().toISOString()
          });
        }catch{}
        updateAuthUI(); updateBackendStatus();
        closeAuthModal();
        toast('Account created successfully.');
      }else{
        message.textContent='Account created. Check your email to confirm your account, then sign in.';
      }
    }else{
      const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
      if(error)throw error;
      authSession=data.session;
      currentUser=data.user;
      backendReady=!!currentUser;
      await loadAuthenticatedProfile();
      updateAuthUI(); updateBackendStatus();
      closeAuthModal();
      toast('Signed in successfully.');
    }
  }catch(err){
    message.textContent=err?.message||'Authentication failed. Please try again.';
  }finally{
    submit.disabled=false;
  }
}
async function handleSignOut(){
  try{
    await supabaseClient?.auth.signOut();
  }catch(err){console.warn('Open Talk sign out:',err);}
  authSession=null; currentUser=null; backendReady=false;
  updateAuthUI(); updateBackendStatus();
  toast('Signed out.');
}
function bindAuthUI(){
  $('#authButton')?.addEventListener('click',()=>openAuthModal('signin'));
  $('#authClose')?.addEventListener('click',closeAuthModal);
  $('#signInTab')?.addEventListener('click',()=>setAuthMode('signin'));
  $('#signUpTab')?.addEventListener('click',()=>setAuthMode('signup'));
  $('#authForm')?.addEventListener('submit',handleAuthSubmit);
  $('#signOutButton')?.addEventListener('click',handleSignOut);
  $('#authModal')?.addEventListener('click',e=>{if(e.target.id==='authModal')closeAuthModal();});
  updateAuthUI();
}
bindAuthUI();

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
      authSession=null;
      currentUser=null;
    }
    backendReady=!!currentUser;
    updateAuthUI();
    /* Only load user-specific data when a session actually exists.
       Anonymous visitors must still be able to create an account. */
    if(currentUser){
      const {data:p,error:pe}=await supabaseClient.from('profiles')
        .select('id,name,age,country,gender,english_level,gender_preference')
        .eq('id',currentUser.id).maybeSingle();
      if(!pe&&p){
        const merged={...s.profile};
        for(const key of ['name','age','country','gender','english_level','gender_preference']){
          const value=p[key];
          if(value!==null&&value!==undefined&&String(value).trim()!=='') merged[key]=value;
        }
        s.profile=merged;
        save();
      }
      try{
        const rewards=await supabaseClient.from('user_milestone_rewards').select('milestone_key,coins').eq('user_id',currentUser.id);
        const balance=await supabaseClient.rpc('available_coins',{p_user_id:currentUser.id});
        if(!rewards.error) s.stats.rewardedMilestones=(rewards.data||[]).map(x=>x.milestone_key);
        if(!balance.error && Number.isFinite(Number(balance.data))) s.stats.coins=Number(balance.data);
        else s.stats.coins=(rewards.data||[]).reduce((sum,x)=>sum+Number(x.coins||0),0);
        save();
      }catch{}
    }
    supabaseClient.auth.onAuthStateChange((event,session)=>{
      authSession=session||null;
      currentUser=session?.user||null;
      backendReady=!!currentUser;
      updateAuthUI();
      updateBackendStatus();
      if(currentUser && event!=='SIGNED_OUT'){
        loadAuthenticatedProfile().catch(err=>console.warn('Open Talk auth profile:',err));
      }
    });
    updateAuthUI();
    updateBackendStatus();
  }catch(e){
    backendReady=false;
    authSession=null;
    currentUser=null;
    updateAuthUI();
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
  const saveButton=$('#saveProfile');
  if(saveButton){saveButton.disabled=true;saveButton.textContent='Profile saved ✓';}
  s.profile={...s.profile,...profile,savedAt:Date.now()};
  save();
  if(backendReady){
    try{
      const r=await api('/api/profile','POST',profile);
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Profile could not be saved');
      s.profile={...s.profile,...data};
      save();
      toast('Profile completed successfully.');
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
  const startButton=$('#mic');
  const resetStartButton=()=>{
    if(startButton){
      startButton.disabled=false;
      startButton.style.display='';
      startButton.textContent=matchSelection().cost?'🪙 Find a match':'🎙 Find a real person';
    }
  };
  if(startButton){
    startButton.disabled=true;
    startButton.textContent='Checking…';
  }
  if(!currentUser){
    resetStartButton();
    openAuthModal('signin');
    toast('Sign in or create an account before starting a real conversation.');
    return;
  }
  if(!backendReady){
    resetStartButton();
    toast('Connecting to Open Talk… please try again in a moment.');
    return;
  }
  const p=s.profile||{};
  if(!p.name||!p.age||!p.country||!p.gender){
    resetStartButton();
    navigateToView('profile');
    toast('Complete your profile first — it takes less than a minute.');
    return;
  }

  // Check the selected match cost BEFORE requesting microphone access.
  // The user should never grant mic access for a match they cannot afford.
  await refreshMatchPasses();
  const match=matchSelection();
  if(match.cost>Number(s.stats?.coins||0)){
    resetStartButton();
    $('#modal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
    navigateToView('coins');
    renderCoinEarningPreview();
    toast('You need '+(match.cost-Number(s.stats?.coins||0))+' more coins to use that match.');
    return;
  }

  // Ask for the microphone while we still have the user's click gesture.
  // iOS Safari can reject getUserMedia when it is first requested later from
  // an asynchronous matchmaking callback. Keeping the stream alive also
  // prevents the post-match screen from repeatedly asking for permission.
  if(!localStream || !localStream.getAudioTracks().some(t=>t.readyState==='live')){
    try{
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported by this browser.');
      // Some browsers can leave getUserMedia pending indefinitely when a
      // permission prompt is blocked or hidden. Race it with a clear timeout
      // so the user always gets visible feedback instead of a dead button.
      const mediaPromise=navigator.mediaDevices.getUserMedia({audio:true,video:false});
      localStream=await Promise.race([
        mediaPromise,
        new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('Microphone permission is still pending.'),{name:'PermissionPending'})),8000))
      ]);
      $('#listen').textContent='Microphone ready. Finding your person…';
      primeRemoteAudioPlayback();
    }catch(err){
      const denied=err?.name==='NotAllowedError'||err?.name==='PermissionDeniedError';
      const pending=err?.name==='PermissionPending';
      $('#listen').textContent=denied
        ? 'Microphone access is blocked for this site.'
        : pending
          ? 'Microphone permission did not respond.'
          : 'We could not start your microphone.';
      $('#transcript').innerHTML=denied
        ? '<div class="queue-status error"><b>Allow microphone access to continue</b><small>Open this site’s browser permissions and set Microphone to Allow, then tap Find a real person again.</small></div>'
        : pending
          ? '<div class="queue-status error"><b>Microphone permission is waiting</b><small>Your browser did not show the permission prompt. Check the 🔒 site settings near the address bar and allow Microphone, then tap Find a real person again.</small></div>'
          : '<div class="queue-status error"><b>Microphone could not start</b><small>Please check your microphone and browser permissions, then try again.</small></div>';
      $('#mic').disabled=false;
      $('#mic').textContent='🎙 Allow microphone';
      return;
    }
  }

  setMatchPhase('searching');
  stopMatchPolling();
  currentPartner=null;
  $('#partner').textContent='Finding your person…';
  $('#partnerMeta').textContent=match.cost
    ? 'Searching with your selected preference. Your coins are safe until a real person is found.'
    : 'Looking across the live community for a real person.';
  $('#partnerMeta').textContent=match.cost ? 'Preference ready. No charge until a match is found.' : 'Searching the live community.';
  $('#listen').textContent='Finding your person…';
  $('#queueLiveSub').textContent='Stay here — we’ll connect you when someone is ready.';
  $('#searchHeadline').textContent='Searching real people';
  $('#searchSubline').textContent='Looking for someone online.';
  $('#searchTipTitle').textContent='Microphone ready';
  $('#searchTipText').textContent='Searching real people.';
  $('#transcript').innerHTML='';
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
        coin_cost:match.cost,
        profile:{
          name:String(p.name||'').trim(),
          age:Number(p.age||0),
          country:String(p.country||'').trim(),
          gender:String(p.gender||'').trim(),
          english_level:String(p.english_level||s.stats.level||'A1').trim()
        }
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
        setMatchPhase('connected');
        $('#partner').textContent='Someone is ready ✨';
        rtcConnected=false;
        remoteTrackReady=false;
        audioPlaybackReady=false;
        await refreshMatchPasses();
        $('#partnerMeta').textContent=(data.candidate.name||'Your speaking partner')+' • '+(data.candidate.country||'Global')+' • '+(data.candidate.level||'level not assessed');
        remoteSelectedBadges=[];
        renderRemoteBadges();
        $('#listen').textContent='Great match found — preparing your private connection…';
        $('#transcript').innerHTML='<div class="queue-status success"><span>✓</span><b>Real person found</b><small>Your selected preferences matched. Setting up the private audio connection.</small></div>';
        setQueueStage(3);
        startCallStateWatch(currentPartner.call_id);
        await startHumanCall(data.session_id,data.candidate);
      }else{
        $('#partner').textContent='Waiting for a real person…';
        $('#partnerMeta').textContent=match.cost
          ? 'Your preferred match is not online yet. Your coins remain untouched.'
          : 'You are safely in the live matching queue. We will never substitute an AI.';
        $('#listen').textContent='Still looking for someone who is online…';
        const elapsed=Number(String($('#timer').textContent||'00:00').split(':').pop()||0);
        if($('#searchHeadline')) $('#searchHeadline').textContent=elapsed>=30?'Still searching — your person could join at any moment.':'Searching the live community';
        if($('#searchTipTitle')) $('#searchTipTitle').textContent=elapsed>=30?'Keep going — real people join throughout the day.':'Your microphone is ready';
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

function setMatchPhase(phase){
  const modal=$('#modal');
  const controls=$('#matchControls');
  const visual=$('.match-visual');
  const queue=$('.queue-live');
  const steps=$('.queue-steps');
  const actions=$('.live-modal .actions');
  const searchExperience=$('#searchExperience');
  modal?.classList.toggle('searching',phase==='searching');
  controls?.classList.toggle('hidden',phase==='searching'||phase==='connected');
  visual?.classList.toggle('hidden',phase!=='searching');
  queue?.classList.toggle('hidden',phase!=='searching'&&phase!=='connected');
  steps?.classList.toggle('hidden',phase!=='connected');
  searchExperience?.classList.toggle('hidden',phase!=='searching');
  if(actions) actions.classList.toggle('search-actions',phase==='searching');
  if(phase==='searching'){
    $('#mic').disabled=true;
    $('#mic').textContent='Searching…';
    $('#mic').style.display='none';
    $('#finish').disabled=false;
    const m=matchSelection();
    const genderLabel=m.gender==='any'?'Anyone':m.gender==='female'?'Women':m.gender==='male'?'Men':'Other';
    if($('#searchPrefGender')) $('#searchPrefGender').textContent=genderLabel;
    if($('#searchPrefCountry')) $('#searchPrefCountry').textContent=m.country||'Any country';
    if($('#searchPrefLevel')) $('#searchPrefLevel').textContent=m.level||'Any level';
    if($('#searchHeadline')) $('#searchHeadline').textContent='Searching the live community';
    if($('#searchSubline')) $('#searchSubline').textContent='Looking for someone who is online and ready to talk.';
    if($('#searchTipTitle')) $('#searchTipTitle').textContent='Your microphone is ready';
    if($('#searchTipText')) $('#searchTipText').textContent='Stay here — Open Talk is searching for a real person, not an AI.';
  }else{
    $('#mic').style.display='';
    if(searchExperience) searchExperience.classList.add('hidden');
  }
}
function openConversationModal(){
  if(!currentUser){
    openAuthModal('signin');
    return;
  }
  finishing=false;
  currentPartner=null;
  remoteStream=new MediaStream();
  remoteTrackReady=false;
  remoteAudioContext=null;
  remoteAudioSource=null;
  remoteAudioGain=null;
  remoteTrackReady=false;
  audioPlaybackReady=false;
  rtcConnected=false;
  audioFlowReady=false;
  clearTimeout(audioFlowTimer);
  audioFlowTimer=null;
  rtcOfferInFlight=false;
  stopMatchPolling();
  $('#modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  setMatchPhase('choose');
  $('#matchControls')?.classList.remove('hidden');
  $('.match-visual')?.classList.add('hidden');
  $('.queue-live')?.classList.add('hidden');
  $('.queue-steps')?.classList.add('hidden');
  $('#feedback').classList.add('hidden');
  $('#feedback').innerHTML='';
  $('#timer').textContent='00:00';
  $('#finish').disabled=true;
  $('#mic').disabled=false;
  $('#mic').textContent='🎙 Find a real person';
  $('#mic').classList.remove('is-live');
  $('#mic').style.display='';
  $('#reportPartner').disabled=true;
  $('#reportPanel')?.classList.add('hidden');
  $('#partner').textContent='Choose your match';
  $('#partnerMeta').textContent='Talk to anyone for free, or add a preference.';
  $('#listen').textContent='Ready when you are';
  refreshMatchPasses().finally(updateMatchSelectionUI);
}

function navigateToView(viewId){
  const target=document.getElementById(viewId);
  if(!target)return false;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===viewId));
  document.querySelectorAll('[data-view]').forEach(v=>v.classList.toggle('nav-active',v.dataset.view===viewId));
  window.scrollTo(0,0);
  return true;
}
document.querySelectorAll('[data-view]').forEach(el=>{
  el.addEventListener('click',(event)=>{
    const view=el.dataset.view;
    if(!view)return;
    event.preventDefault();
    event.stopPropagation();
    navigateToView(view);
  });
});

function safeBind(id, handler){
  const el=document.getElementById(id);
  if(!el)return;
  el.addEventListener('click',async (event)=>{
    event.preventDefault();
    try{ await handler(event); }
    catch(err){
      console.error('Open Talk click failed:',id,err);
      toast('Something went wrong. Please try again.');
    }
  });
}
safeBind('talkNow',()=>openConversationModal());
safeBind('findPartner',()=>openConversationModal());
const micButton=document.getElementById('mic');
if(micButton) micButton.onclick=()=>findPartner();
['matchGender','matchCountry','matchLevel','matchPriority'].forEach(id=>{
  const el=document.getElementById(id);
  el?.addEventListener('change',()=>updateMatchSelectionUI());
});

$('#close').onclick=leaveConversation;
$('#finish').onclick=finishConversation;

async function startHumanCall(sessionId,partner){
  if(!supabaseClient||!currentUser){
    toast('Live human matching is not initialized.');
    return;
  }
  $('#reportPartner').disabled=false;
  $('#feedback')?.classList.add('hidden');
  $('#feedback').innerHTML='';
  $('#partner').textContent=`${partner.name||'Your speaking partner'} is ready`;
  $('#partnerMeta').textContent=`${partner.country||'A nearby speaker'} • ${partner.level||'level not assessed'} • Real person`;
  $('#listen').textContent='Connecting securely…';
  $('#transcript').textContent='Your voice will be sent directly to your matched partner. No AI is speaking here.';
  try{
    if(navigator.audioSession) navigator.audioSession.type='play-and-record';
  }catch{}

  // Microphone permission is requested from the original Find button.
  // Reuse that live stream here instead of asking again after the match.
  if(!localStream || !localStream.getAudioTracks().some(t=>t.readyState==='live')){
    $('#listen').textContent='Microphone access is needed before connecting.';
    $('#transcript').textContent='Return to the matching screen and tap Find a real person to enable your microphone.';
    return;
  }

  // The microphone is already live and WebRTC is negotiating.
  $('#mic').disabled=true;
  $('#mic').textContent='🎙 Connecting…';
  $('#mic').classList.add('is-live');
  $('#mic').onclick=null;
  await setupSignaling(sessionId,partner);
}

async function setupSignaling(sessionId,partner){
  const sameSession=signalingSessionId===sessionId;
  if(channel){try{await supabaseClient.removeChannel(channel)}catch{} channel=null;}
  stopSignalPolling(false);
  signalingSessionId=sessionId;
  if(!sameSession) signalSeen=new Set();

  const processSignal=async(msg)=>{
    if(!msg||msg.from===currentUser.id)return;
    const type=msg.type||msg.kind;
    if(!['offer','answer','ice'].includes(type))return;
    const fingerprint=type+':'+String(msg.from)+':'+JSON.stringify(msg.sdp||msg.candidate||'');
    if(signalSeen.has(fingerprint))return;
    signalSeen.add(fingerprint);
    try{
      if(type==='offer'){
        await ensurePeer();
        if(pc.signalingState!=='stable'&&pc.signalingState!=='have-remote-offer')return;
        await pc.setRemoteDescription(msg.sdp);
        for(const ice of pendingIce){try{await pc.addIceCandidate(ice)}catch(err){console.warn('Open Talk pending ICE:',err);}}
        pendingIce=[];
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);
        await sendSignal({type:'answer',sdp:pc.localDescription});
      }else if(type==='answer'){
        if(!pc||pc.signalingState!=='have-local-offer')return;
        await pc.setRemoteDescription(msg.sdp);
        for(const ice of pendingIce){try{await pc.addIceCandidate(ice)}catch(err){console.warn('Open Talk pending ICE:',err);}}
        pendingIce=[];
      }else{
        const ice=msg.candidate;
        if(!pc?.remoteDescription)pendingIce.push(ice);
        else{try{await pc.addIceCandidate(ice)}catch(err){console.warn('Open Talk ICE:',err);}}
      }
    }catch(err){
      console.error('Open Talk signaling:',err);
      $('#listen').textContent='The voice connection needs another attempt. Please leave and find a new partner.';
    }
  };

  channel=supabaseClient.channel('open-talk:'+sessionId,{config:{broadcast:{ack:true}}});
  channel.on('broadcast',{event:'signal'},payload=>{
    processSignal(payload.payload||{}).catch(err=>console.warn('Open Talk broadcast:',err));
  });
  channel.subscribe(status=>{
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Open Talk realtime unavailable; using database signaling.');
  });

  signalPoll=setInterval(async()=>{
    if(signalPollBusy||finishing||!supabaseClient||!currentUser||signalingSessionId!==sessionId)return;
    signalPollBusy=true;
    try{
      const {data,error}=await supabaseClient.from('call_signals').select('id,sender_id,kind,payload,created_at').eq('call_id',sessionId).order('created_at',{ascending:true}).limit(100);
      if(!error)for(const row of(data||[]))await processSignal({...row.payload||{},from:row.sender_id});
      else console.warn('Open Talk signal polling:',error);
    }catch(err){console.warn('Open Talk signal polling:',err);}
    finally{signalPollBusy=false;}
  },300);

  // Start the handshake immediately; do not wait for an ephemeral hello packet.
  if(currentUser.id<partner.id){
    try{await createOffer();}catch(err){
      console.error('Open Talk initial offer:',err);
      $('#listen').textContent='We could not start the private voice connection. Please try again.';
    }
  }
}

function startCallStateWatch(callId){
  stopCallStateWatch();
  if(!callId||!supabaseClient||!currentUser)return;
  const check=async()=>{
    if(callStatePollBusy||finishing||!currentPartner||currentPartner.call_id!==callId)return;
    callStatePollBusy=true;
    try{
      const {data,error}=await supabaseClient.from('calls')
        .select('id,status,ended_at,duration_seconds')
        .eq('id',callId)
        .maybeSingle();
      if(error)throw error;
      if(data && ['completed','cancelled'].includes(data.status) && !finishing && currentPartner?.call_id===callId){
        await handlePartnerLeft(data.status==='cancelled'?'The other person left before the conversation started.':'Your speaking partner left the conversation.');
      }
    }catch(err){
      console.warn('Open Talk call-state watch:',err);
    }finally{
      callStatePollBusy=false;
    }
  };
  check();
  callStatePoll=setInterval(check,1500);
}

function stopCallStateWatch(){
  if(callStatePoll){clearInterval(callStatePoll);callStatePoll=null;}
  callStatePollBusy=false;
}

async function handlePartnerLeft(message='Your speaking partner left the conversation.'){
  if(finishing)return;
  finishing=true;
  stopMatchPolling();
  stopSignalPolling();
  stopCallStateWatch();
  const seconds=callStartedAt?Math.max(1,Math.floor((Date.now()-callStartedAt)/1000)):0;
  const completedPartner=currentPartner ? {...currentPartner} : null;

  try{
    await teardownCall();

    // A conversation that actually started still counts, even when the
    // partner ended it. A match that never reached a live call does not.
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
      s.stats.achievements=[...new Set(ACHIEVEMENTS.filter(x=>x[4]({...s.stats,today:Number(s.today?.conversations||0)})).map(x=>x[0]))];
      s.stats.selectedBadges=(s.stats.selectedBadges||[]).filter(k=>s.stats.achievements.includes(k)).slice(0,3);
      save();
      if(backendReady && completedPartner?.call_id){
        try{ await api('/api/complete-conversation','POST',{
          call_id:completedPartner.call_id,
          partner_id:completedPartner.id||null,
          duration_seconds:seconds
        }); }catch(err){ console.warn('Open Talk partner-left completion sync:',err); }
      }
    }

    currentPartner=null;
    remoteSelectedBadges=[];
    setMatchPhase('choose');
    $('#matchControls')?.classList.remove('hidden');
    $('.match-visual')?.classList.add('hidden');
    $('.queue-live')?.classList.add('hidden');
    $('.queue-steps')?.classList.add('hidden');
    $('#feedback')?.classList.add('hidden');
    $('#feedback').innerHTML='';
    $('#reportPanel')?.classList.add('hidden');
    $('#reportPartner').disabled=true;
    $('#partner').textContent='Conversation ended';
    $('#partnerMeta').textContent='Your speaking partner left the conversation.';
    $('#listen').textContent='Your partner has left.';
    $('#transcript').innerHTML='<div class="queue-status"><span>✓</span><b>'+message+'</b><small>Your call has been closed safely. You can find another real person whenever you’re ready.</small></div>';
    $('#timer').textContent='00:00';
    $('#finish').disabled=true;
    $('#mic').disabled=false;
    $('#mic').textContent='🎙 Find a real person';
    $('#mic').classList.remove('is-live');
    $('#mic').style.display='';
    $('#mic').onclick=null;
    $('#close').onclick=leaveConversation;
    updateMatchSelectionUI();
    toast('Your partner left. Ready for another person.');
  }finally{
    finishing=false;
  }
}

function stopSignalPolling(resetSeen=true){
  if(signalPoll){clearInterval(signalPoll);signalPoll=null;}
  signalPollBusy=false;
  if(resetSeen) signalSeen=new Set();
}

async function sendSignal(message){
  if(!currentUser||!signalingSessionId)return;
  const payload={...message,from:currentUser.id,selectedBadges:s.stats.selectedBadges||[]};
  if(['offer','answer','ice'].includes(message.type)){
    const {error}=await supabaseClient.from('call_signals').insert({call_id:signalingSessionId,sender_id:currentUser.id,kind:message.type,payload});
    if(error)throw error;
  }
  if(channel){
    try{const result=await channel.send({type:'broadcast',event:'signal',payload});if(result==='error')console.warn('Open Talk broadcast send failed; database signal is saved.');}
    catch(err){console.warn('Open Talk broadcast send:',err);}
  }
}

function waitForIceGathering(peer,timeout=6000){
  if(peer.iceGatheringState==='complete')return Promise.resolve();
  return new Promise(resolve=>{
    const done=()=>{
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange',done);
      resolve();
    };
    const timer=setTimeout(done,timeout);
    peer.addEventListener('icegatheringstatechange',done);
  });
}

async function primeRemoteAudioPlayback(){
  // iOS Safari is much more reliable when the audio output is unlocked from
  // the same user gesture that starts the microphone. Keep ONE MediaStream
  // alive for the entire call instead of replacing audio.srcObject when the
  // remote track arrives.
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(Ctx){
      if(!remoteAudioContext) remoteAudioContext=new Ctx();
      if(remoteAudioContext.state==='suspended') await remoteAudioContext.resume();
      // Do not create a MediaStreamAudioSourceNode yet: on iOS the remote
      // stream is still empty at this point. The source is created after the
      // actual remote audio track arrives.
    }
  }catch(err){console.warn('Open Talk audio unlock:',err);}
  const audio=$('#remoteAudio');
  if(audio){
    audio.autoplay=true;
    audio.playsInline=true;
    audio.muted=false;
    audio.volume=Number(document.getElementById('speakerVolume')?.value||100)/100;
    try{
      if(!audio.srcObject) audio.srcObject=remoteStream||new MediaStream();
      await audio.play().then(()=>{audioPlaybackReady=true;}).catch(()=>{});
    }catch{}
  }
}

async function enableRemoteAudio(){
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(Ctx){
      if(!remoteAudioContext) remoteAudioContext=new Ctx();
      await remoteAudioContext.resume();
      if(remoteStream && !remoteAudioSource){
        remoteAudioSource=remoteAudioContext.createMediaStreamSource(remoteStream);
        remoteAudioGain=remoteAudioContext.createGain();
        remoteAudioGain.gain.value=1;
        remoteAudioSource.connect(remoteAudioGain);
        remoteAudioGain.connect(remoteAudioContext.destination);
      }
    }
    const audio=$('#remoteAudio');
    if(audio){
      // The initial gesture unlocks playback, but the remote call must NOT
      // remain muted/at volume 0. The previous implementation did exactly
      // that, which could leave both people talking while hearing silence.
      audio.muted=false;
      audio.volume=Number(document.getElementById('speakerVolume')?.value||100)/100;
      audio.srcObject=remoteStream||audio.srcObject;
      await audio.play();
    }
    audioPlaybackReady=true;
    $('#mic').style.display='none';
    $('#mic').disabled=true;
    $('#mic').onclick=null;
    verifyAudioFlow();
  }catch(err){
    audioPlaybackReady=false;
    $('#listen').textContent='Speaker access is still blocked. Tap again or check Safari audio permissions.';
  }
}

function verifyAudioFlow(){
  if(audioFlowTimer || !pc || finishing)return;
  const deadline=Date.now()+5000;
  const check=async()=>{
    audioFlowTimer=null;
    if(!pc || finishing || pc.connectionState!=='connected')return;
    try{
      const senders=pc.getSenders().filter(s=>s.track?.kind==='audio');
      const receivers=pc.getReceivers().filter(r=>r.track?.kind==='audio');
      let inbound=false;
      let outbound=false;

      for(const sender of senders){
        const report=await sender.getStats();
        report.forEach(stat=>{
          const kind=stat.kind||stat.mediaType;
          if(stat.type==='outbound-rtp' && kind==='audio' &&
             ((stat.packetsSent||0)>0 || (stat.bytesSent||0)>0)) outbound=true;
        });
      }
      for(const receiver of receivers){
        const report=await receiver.getStats();
        report.forEach(stat=>{
          const kind=stat.kind||stat.mediaType;
          if(stat.type==='inbound-rtp' && kind==='audio' &&
             ((stat.packetsReceived||0)>0 || (stat.bytesReceived||0)>0)) inbound=true;
        });
      }

      if(inbound && outbound){
        audioFlowReady=true;
        maybeMarkRtcUsable();
        return;
      }
    }catch(err){
      console.warn('Open Talk audio stats:',err);
    }

    // Do not destroy a connected peer just because stats lag behind.
    // Chrome/Safari can expose RTP counters later than the actual track.
    if(Date.now()<deadline){
      audioFlowTimer=setTimeout(check,500);
    }else if(pc?.connectionState==='connected' && remoteTrackReady && audioPlaybackReady){
      audioFlowReady=true;
      maybeMarkRtcUsable();
      $('#listen').textContent='You’re live. Your microphone and speaker are connected.';
    }
  };
  check();
}
function ensureLiveAudioControls(){
  const actions=document.querySelector('.live-modal .actions');
  if(!actions)return;
  let panel=document.getElementById('liveAudioControls');
  if(!panel){
    panel=document.createElement('div');
    panel.id='liveAudioControls';
    panel.style.cssText='display:none;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 4px;padding:12px 14px;border:1px solid #dfe3f2;border-radius:18px;background:rgba(248,249,253,.96);';
    panel.innerHTML='<button id="toggleMic" type="button" style="border:0;border-radius:12px;padding:10px 14px;font-weight:800;background:#6257f5;color:#fff;cursor:pointer;">🎙 Microphone on</button><label style="display:flex;align-items:center;gap:8px;flex:1;min-width:190px;color:#1a2340;font-weight:700;font-size:14px;"><span>🔊 Speaker</span><input id="speakerVolume" type="range" min="0" max="100" value="100" step="1" style="flex:1;accent-color:#6257f5;"><b id="speakerVolumeValue" style="min-width:38px;text-align:right;">100%</b></label>';
    actions.parentNode.insertBefore(panel,actions);
    document.getElementById('toggleMic').addEventListener('click',toggleLocalMicrophone);
    document.getElementById('speakerVolume').addEventListener('input',e=>setRemoteSpeakerVolume(Number(e.target.value)/100));
  }
  const track=localStream?.getAudioTracks?.()[0];
  const micOn=!!track?.enabled;
  const micButton=document.getElementById('toggleMic');
  if(micButton){
    micButton.textContent=micOn?'🎙 Microphone on':'🔇 Microphone muted';
    micButton.style.background=micOn?'#6257f5':'#9aa2b8';
  }
  panel.style.display='flex';
}
function toggleLocalMicrophone(){
  const tracks=localStream?.getAudioTracks?.()||[];
  if(!tracks.length){toast('Microphone is not available.');return;}
  const next=!tracks[0].enabled;
  tracks.forEach(t=>t.enabled=next);
  const button=document.getElementById('toggleMic');
  if(button){
    button.textContent=next?'🎙 Microphone on':'🔇 Microphone muted';
    button.style.background=next?'#6257f5':'#9aa2b8';
  }
  $('#listen').textContent=next?'Your microphone is live. You can speak now.':'Your microphone is muted. Tap Microphone to speak again.';
}
function setRemoteSpeakerVolume(level){
  const value=Math.max(0,Math.min(1,Number(level)||0));
  if(remoteAudioGain)remoteAudioGain.gain.value=value;
  const audio=$('#remoteAudio');
  if(audio){
    audio.muted=false;
    audio.volume=value;
  }
  const label=document.getElementById('speakerVolumeValue');
  if(label)label.textContent=Math.round(value*100)+'%';
}
function hideLiveAudioControls(){
  const panel=document.getElementById('liveAudioControls');
  if(panel)panel.style.display='none';
}

function maybeMarkRtcUsable(){
  if(finishing || !currentPartner || !pc)return;
  if(pc.connectionState!=='connected' || !remoteTrackReady || !audioPlaybackReady)return;
  clearTimeout(rtcConnectTimer);
  if(!callStartedAt) startCallClock();
  if(supabaseClient && currentPartner.call_id){
    supabaseClient.from('calls').update({status:'active',started_at:new Date().toISOString()})
      .eq('id',currentPartner.call_id).then(()=>{}).catch(()=>{});
  }
  $('#listen').textContent='Successfully connected — you’re live with a real person.';
  $('#partnerMeta').textContent=(currentPartner.name||'Your partner')+' • LIVE HUMAN CONVERSATION';
  $('#transcript').innerHTML='<div class="queue-status success"><span>✓</span><b>Successfully connected</b><small>Your private peer-to-peer audio connection is live.</small></div>';
  $('#mic').style.display='none';
  $('#mic').disabled=true;
  $('#mic').onclick=null;
  $('#finish').disabled=false;
  ensureLiveAudioControls();
}

async function ensurePeer(){
  if(pc)return pc;
  remoteStream=null;
  remoteTrackReady=false;
  audioPlaybackReady=false;
  rtcConnected=false;
  audioFlowReady=false;
  clearTimeout(audioFlowTimer);
  audioFlowTimer=null;
  // STUN handles direct peers; TURN is the fallback for restrictive Wi-Fi,
  // carrier NAT and phone-to-phone networks that cannot connect directly.
  // Keep the relay configurable for production deployments.
  const turn=window.OPEN_TALK_TURN||{
    urls:['turn:openrelay.metered.ca:80','turn:openrelay.metered.ca:443','turn:openrelay.metered.ca:443?transport=tcp'],
    username:'openrelayproject',
    credential:'openrelayproject'
  };
  pc=new RTCPeerConnection({
    iceServers:[
      {urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']},
      turn
    ],
    iceCandidatePoolSize:10
  });

  // Trickle ICE: forward every candidate as soon as it is gathered.
  // Candidates may arrive before the remote SDP, so setupSignaling queues them
  // in pendingIce and flushes them after setRemoteDescription().
  pc.onicecandidate=e=>{
    if(e.candidate){
      sendSignal({type:'ice',candidate:e.candidate.toJSON?.()||e.candidate}).catch(err=>{
        console.warn('Open Talk ICE send:',err);
      });
    }
  };
  pc.onicecandidateerror=e=>{
    console.warn('Open Talk ICE candidate error:',e.errorCode,e.url,e.errorText);
  };
  pc.ontrack=async e=>{
    // Do not call this a successful call just because ontrack fired.
    // Mobile Safari may deliver the track before ICE/DTLS is usable, and
    // remote speaker autoplay can still be blocked.
    // Always append the negotiated track to the persistent remote stream.
    // Replacing srcObject with event.streams[0] on iOS can lose the playback
    // unlock established by the user's Find button.
    if(!remoteStream) remoteStream=new MediaStream();
    if(e.track && !remoteStream.getTracks().some(t=>t.id===e.track.id)){
      remoteStream.addTrack(e.track);
    }
    const audio=$('#remoteAudio');
    if(audio){
      audio.autoplay=true;
      audio.playsInline=true;
      // The initial user gesture in findPartner() unlocks playback. Once the
      // real remote track arrives, switch to normal speaker output and try
      // playback immediately. The old code kept this element muted at volume
      // 0, which made both users talk while hearing silence and kept the
      // call timer at 00:00 forever.
      audio.srcObject=remoteStream;
      audio.muted=false;
      audio.volume=1;
      audio.play().then(()=>{audioPlaybackReady=true;}).catch(()=>{});
    }
    remoteTrackReady=!!e.track;
    renderRemoteBadges();

    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(Ctx){
        if(!remoteAudioContext) remoteAudioContext=new Ctx();
        if(remoteAudioContext.state==='suspended') await remoteAudioContext.resume();
        if(!remoteAudioSource){
          remoteAudioSource=remoteAudioContext.createMediaStreamSource(remoteStream);
          remoteAudioGain=remoteAudioContext.createGain();
          remoteAudioGain.gain.value=1;
          remoteAudioSource.connect(remoteAudioGain);
          remoteAudioGain.connect(remoteAudioContext.destination);
        }
      }
      if(remoteTrackReady && audioPlaybackReady) verifyAudioFlow();
    }catch(err){
      audioPlaybackReady=false;
      console.warn('Open Talk remote audio setup:',err);
      $('#listen').textContent='Your partner is connected. Tap Enable speaker to hear them.';
      $('#mic').style.display='';
      $('#mic').disabled=false;
      $('#mic').textContent='🔊 Enable speaker';
      $('#mic').onclick=enableRemoteAudio;
    }
  };
  pc.onconnectionstatechange=()=>{
    const state=pc.connectionState;
    rtcConnected=state==='connected';
    if(state==='connected'){
      clearTimeout(rtcConnectTimer);
      $('#finish').disabled=false;
      verifyAudioFlow();
    }else if(state==='failed'){
      $('#listen').textContent='We couldn’t establish the voice connection. Retrying…';
      if(!finishing && signalingSessionId)scheduleRtcRecovery();
    }else if(state==='disconnected'){
      $('#listen').textContent='Voice connection interrupted. Reconnecting…';
      if(!finishing && signalingSessionId)scheduleRtcRecovery();
    }else if(state==='closed' && !finishing){
      $('#listen').textContent='Voice connection closed. Please find another person.';
    }
  };
  clearTimeout(rtcConnectTimer);
  rtcConnectTimer=setTimeout(()=>{
    if(pc && pc.connectionState!=='connected' && !finishing && signalingSessionId){
      $('#listen').textContent='Still connecting — retrying the private voice link…';
      scheduleRtcRecovery();
    }
  },12000);

  pc.oniceconnectionstatechange=()=>{
    const ice=pc?.iceConnectionState;
    if(ice==='failed' && !finishing && signalingSessionId)scheduleRtcRecovery();
  };

  if(localStream){
    localStream.getTracks().forEach(track=>{
      if(track.kind==='audio') track.enabled=true;
      pc.addTrack(track,localStream);
    });
  }
  return pc;
}

async function createOffer(){
  await ensurePeer();
  if(!pc || pc.signalingState!=='stable' || pc.localDescription)return;

  const offer=await pc.createOffer({offerToReceiveAudio:true});
  await pc.setLocalDescription(offer);

  // Send the final SDP after ICE gathering as well as trickled candidates.
  // This gives mobile Safari both paths and makes the handshake resilient to
  // a candidate message arriving before the other phone subscribes.
  await waitForIceGathering(pc);
  if(pc?.localDescription?.type==='offer'){
    await sendSignal({type:'offer',sdp:pc.localDescription});
  }
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

let reconnectingAfterBackground=false;
let rtcRecoveryTimer=null;
let rtcConnectTimer=null;

function scheduleRtcRecovery(){
  if(rtcRecoveryTimer||finishing||!signalingSessionId||!currentPartner)return;
  rtcRecoveryTimer=setTimeout(async()=>{
    rtcRecoveryTimer=null;
    if(finishing||!currentPartner||!signalingSessionId)return;
    try{
      if(pc)pc.close();
      pc=null;
      pendingIce=[];
      await setupSignaling(signalingSessionId,currentPartner);
    }catch(err){
      console.warn('Open Talk WebRTC recovery:',err);
      $('#listen').textContent='Still reconnecting…';
    }
  },1200);
}

async function resumeLiveConversation(){
  if(!currentPartner || finishing || $('#modal')?.classList.contains('hidden')) return;
  try{
    try{ if(navigator.audioSession) navigator.audioSession.type='play-and-record'; }catch{}
    const audio=$('#remoteAudio');
    if(audio?.srcObject){
      audio.muted=false;
      audio.volume=1;
      await audio.play().then(()=>{
        audioPlaybackReady=true;
      }).catch(()=>{
        audioPlaybackReady=false;
      });
      if(audioPlaybackReady) maybeMarkRtcUsable();
    }

    const micEnded=!localStream || localStream.getAudioTracks().some(t=>t.readyState==='ended');
    if(micEnded && navigator.mediaDevices?.getUserMedia){
      localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(pc){
        const track=localStream.getAudioTracks()[0];
        const sender=pc.getSenders().find(s=>s.track?.kind==='audio');
        if(sender && track) await sender.replaceTrack(track);
      }
    }

    if(pc && ['failed','disconnected','closed'].includes(pc.connectionState)){
      if(reconnectingAfterBackground) return;
      reconnectingAfterBackground=true;
      try{
        pc.close();
        pc=null;
        pendingIce=[];
        await setupSignaling(signalingSessionId,currentPartner);
      }finally{
        reconnectingAfterBackground=false;
      }
    }else if(!pc && signalingSessionId){
      await setupSignaling(signalingSessionId,currentPartner);
    }
  }catch(err){
    console.warn('Open Talk resume:',err);
    $('#listen').textContent='Reconnecting your live conversation…';
  }
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') resumeLiveConversation();
});
window.addEventListener('pageshow',()=>resumeLiveConversation());

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
  const completedPartner=currentPartner ? {...currentPartner} : null;

  try{
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
            call_id:completedPartner?.call_id||null,
            partner_id:completedPartner?.id||null,
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
        }catch(err){console.warn('Open Talk conversation completion sync:',err);}
      }
    }

    // Reset the modal after every finished call. A new match must never inherit
    // the previous partner, timer, "Conversation ended" status, or completion card.
    currentPartner=null;
    remoteSelectedBadges=[];
    setMatchPhase('choose');
    $('#matchControls')?.classList.remove('hidden');
    $('.match-visual')?.classList.add('hidden');
    $('.queue-live')?.classList.add('hidden');
    $('.queue-steps')?.classList.add('hidden');
    $('#feedback')?.classList.add('hidden');
    $('#feedback').innerHTML='';
    $('#reportPanel')?.classList.add('hidden');
    $('#reportPartner').disabled=true;
    $('#partner').textContent='Choose your match';
    $('#partnerMeta').textContent='Talk to anyone for free, or add a preference.';
    $('#listen').textContent='Ready when you are';
    $('#transcript').innerHTML='<div class="queue-status"><span class="queue-spinner"></span><b>Ready for your next conversation</b><small>Your previous conversation was saved. Choose your match and start again.</small></div>';
    $('#timer').textContent='00:00';
    $('#finish').disabled=true;
    $('#mic').disabled=false;
    $('#mic').textContent='🎙 Find a real person';
    $('#mic').classList.remove('is-live');
    $('#mic').style.display='';
    $('#mic').onclick=null;
    $('#close').onclick=leaveConversation;
    updateMatchSelectionUI();
    toast('Conversation saved. Ready for another person.');
  } finally {
    finishing=false;
  }
}

function resetMatchToFirstPage(){
  currentPartner=null;
  remoteSelectedBadges=[];
  setMatchPhase('choose');
  stopMatchPolling();
  stopCallStateWatch();
  stopSignalPolling();
  $('#matchControls')?.classList.remove('hidden');
  $('.match-visual')?.classList.add('hidden');
  $('.queue-live')?.classList.add('hidden');
  $('.queue-steps')?.classList.add('hidden');
  $('#searchExperience')?.classList.add('hidden');
  $('#feedback')?.classList.add('hidden');
  $('#feedback').innerHTML='';
  $('#reportPanel')?.classList.add('hidden');
  $('#reportPartner').disabled=true;
  $('#partner').textContent='Choose your match';
  $('#partnerMeta').textContent='Choose your preferences.';
  $('#listen').textContent='Ready when you are';
  $('#transcript').innerHTML='<div class="queue-status"><span class="queue-spinner"></span><b>Ready when you are</b></div>';
  $('#timer').textContent='00:00';
  $('#finish').disabled=true;
  $('#mic').disabled=false;
  $('#mic').textContent='🎙 Find a real person';
  $('#mic').classList.remove('is-live');
  $('#mic').style.display='';
  $('#mic').onclick=()=>findPartner();
  updateMatchSelectionUI();
}

async function leaveConversation(){
  // Leaving always returns the conversation modal to page 1.
  // Never preserve the previous searching/connected phase.
  finishing=true;
  stopMatchPolling();
  document.body.classList.remove('modal-open');
  $('#modal')?.classList.add('hidden');

  try{await teardownCall();}catch(err){console.warn('Open Talk teardown:',err);}

  resetMatchToFirstPage();

  // Server cleanup is best-effort and never blocks the UI.
  if(backendReady){
    api('/api/match','POST',{action:'leave'}).catch(err=>{
      console.warn('Open Talk leave sync:',err);
    });
  }
  finishing=false;
}

async function teardownCall(){
  hideLiveAudioControls();
  stopMatchPolling();
  stopCallStateWatch();
  stopSignalPolling();
  stopCallClock();
  clearTimeout(rtcConnectTimer);
  rtcConnectTimer=null;
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  if(pc){pc.close();pc=null;}
  if(channel&&supabaseClient){try{await supabaseClient.removeChannel(channel)}catch{} channel=null;}
  signalingSessionId=null;
  $('#remoteAudio').srcObject=null;
  try{
    if(remoteAudioSource) remoteAudioSource.disconnect();
    if(remoteAudioGain) remoteAudioGain.disconnect();
    if(remoteAudioContext && remoteAudioContext.state!=='closed') remoteAudioContext.close();
  }catch{}
  remoteAudioSource=null;
  remoteAudioGain=null;
  remoteAudioContext=null;
  remoteStream=null;
  pendingIce=[];
  remoteTrackReady=false;
  audioPlaybackReady=false;
  rtcConnected=false;
  rtcOfferInFlight=false;
  audioFlowReady=false;
  clearTimeout(audioFlowTimer);
  audioFlowTimer=null;
  try{
    if(navigator.audioSession) navigator.audioSession.type='auto';
  }catch{}
  callStartedAt=0;
  $('#timer').textContent='00:00';
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




async function submitPartnerReport(){
  if(!supabaseClient||!currentUser||!currentPartner?.id)return toast('No partner is available to report.');
  const reason=$('#reportReason')?.value||'other';
  const button=$('#submitReport');
  if(button)button.disabled=true;
  try{
    const {error}=await supabaseClient.from('reports').insert({
      reporter_id:currentUser.id,
      reported_user_id:currentPartner.id,
      reason
    });
    if(error)throw error;
    $('#reportPanel')?.classList.add('hidden');
    toast('Report submitted. Thank you for helping keep Open Talk safe.');
  }catch(err){
    console.error('Open Talk report:',err);
    toast('We could not submit the report. Please try again.');
  }finally{
    if(button)button.disabled=false;
  }
}
function openReportPanel(){
  if(!currentPartner?.id)return toast('You can report a partner after a match.');
  $('#reportPanel')?.classList.remove('hidden');
}
$('#reportPartner')?.addEventListener('click',openReportPanel);
document.querySelectorAll('[data-copy-profile]').forEach(btn=>{
  btn.addEventListener('click',async()=>{
    const key=btn.dataset.copyProfile;
    const value=key==='name'?s.profile?.name:key==='age'?s.profile?.age:key==='country'?s.profile?.country:key==='gender'?s.profile?.gender:'';
    if(!value)return;
    try{
      await navigator.clipboard.writeText(String(value));
      toast('Copied.');
    }catch{
      toast('Could not copy.');
    }
  });
});
$('#submitReport')?.addEventListener('click',submitPartnerReport);
$('#cancelReport')?.addEventListener('click',()=>$('#reportPanel')?.classList.add('hidden'));


// Expose a non-blocking cleanup hook for the inline close-button fallback.
// The UI must never depend on a network request to close.
window.__openTalkCleanup=()=>{ teardownCall().catch(err=>console.warn('Open Talk cleanup:',err)); };

render();
bootstrapBackend();