const K='openTalkV1';
let s=JSON.parse(localStorage.getItem(K)||'null')||{profile:{},stats:{conversations:0,minutes:0,level:null,achievements:[]},today:{conversations:0,minutes:0}};
const $=x=>document.querySelector(x);

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
  t._timer=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateY(8px)'},2600);
}

function render(){
  let p=s.profile,t=s.today,a=s.stats;
  if(!a.achievements)a.achievements=[];
  const todayKey=new Date().toISOString().slice(0,10);
  if(t.date!==todayKey){
    s.today={conversations:0,minutes:0,date:todayKey};
    t=s.today;
  }
  $('#name').value=p.name||'';
  $('#age').value=p.age||'';
  $('#country').value=p.country||'';
  $('#gender').value=p.gender||'Prefer not to say';
  let l=a.level||'Not assessed yet';
  $('#levelValue').textContent=l;
  $('#homeLevel').textContent=l;
  $('#homeMinutes').textContent=a.minutes;
  $('#homeConvos').textContent=a.conversations;
  $('#homeMinutes2').textContent=a.minutes;
  $('#homeLevel2').textContent=a.level||'—';
  $('#homeAch').textContent=a.achievements.length;
  $('#statStreakHome').textContent=a.streak||0;
  $('#statConvos').textContent=a.conversations;
  $('#statMinutes').textContent=a.minutes;
  $('#statStreak').textContent=a.streak||0;
  $('#statAch').textContent=a.achievements.length;
  const goalDone=Math.min(t.conversations,4);
  $('#goalCount').textContent=`${goalDone}/4`;
  $('#goalStatus').textContent=t.conversations>=4?'Goal completed — beautiful work.':`${4-t.conversations} conversation${4-t.conversations===1?'':'s'} to go`;
  $('#goalProgress').style.width=Math.min(100,t.conversations/4*100)+'%';
  let n={A1:12,A2:28,B1:45,B2:62,C1:82,C2:100};
  $('#levelBar').style.width=(n[l]||0)+'%';
  $('#profileLock').textContent=p.savedAt?'Profile saved. You can update it whenever you want.':'Complete your profile to improve partner matching.';
  renderMilestones();
  renderAchievements();
}

document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
  const target=b.dataset.view;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===target));
  document.querySelectorAll('nav button[data-view]').forEach(v=>v.classList.toggle('nav-active',v.dataset.view===target));
  scrollTo({top:0,behavior:'smooth'});
});

$('#profileForm').onsubmit=e=>{
  e.preventDefault();
  s.profile={name:$('#name').value.trim(),age:$('#age').value,country:$('#country').value,gender:$('#gender').value,savedAt:Date.now()};
  save();
  toast('Profile saved — matching will now be more personalized.');
};

let rec=null;
let run=false;
let sec=0;
let startAt=0;
let timerId=null;
let finishing=false;
let recognitionStarting=false;

function formatTime(total){
  return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
}

function updateTimer(){
  if(!run||!startAt)return;
  sec=Math.max(0,Math.floor((Date.now()-startAt)/1000));
  $('#timer').textContent=formatTime(sec);
}

function startTimer(){
  clearInterval(timerId);
  startAt=Date.now();
  sec=0;
  $('#timer').textContent='00:00';
  updateTimer();
  timerId=setInterval(updateTimer,250);
}

function stopTimer(){
  updateTimer();
  clearInterval(timerId);
  timerId=null;
}

function resetConversationUi(){
  $('#timer').textContent='00:00';
  $('#listen').textContent='Ready';
  $('#partner').textContent='Your speaking partner is ready';
  $('#transcript').textContent='Press Start speaking and allow microphone access.';
  $('#feedback').classList.add('hidden');
  $('#feedback').innerHTML='';
  $('#mic').disabled=false;
  $('#mic').textContent='🎙 Start speaking';
  $('#finish').disabled=true;
}

function open(){
  if(run)return;
  finishing=false;
  recognitionStarting=false;
  sec=0;
  startAt=0;
  run=false;
  if(rec){try{rec.onend=null;rec.stop()}catch{} rec=null;}
  clearInterval(timerId);
  resetConversationUi();
  $('#modal').classList.remove('hidden');
}

$('#talkNow').onclick=open;

$('#findPartner').onclick=()=>{
  let b=$('#findPartner');
  b.disabled=true;
  b.innerHTML='<span class="loading-spinner"></span>Finding partner...';
  setTimeout(()=>{
    b.disabled=false;
    b.textContent='Find partner';
    open();
  },900);
};

$('#close').onclick=()=>{
  finishing=true;
  run=false;
  recognitionStarting=false;
  stopTimer();
  if(rec){try{rec.onend=null;rec.stop()}catch{} rec=null;}
  $('#modal').classList.add('hidden');
};

function setupRecognition(){
  if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window)){
    $('#listen').textContent='Speech recognition unavailable in this browser.';
    return null;
  }

  let R=window.SpeechRecognition||window.webkitSpeechRecognition;
  let r=new R();
  r.continuous=true;
  r.interimResults=true;
  r.lang='en-US';

  r.onstart=()=>{
    if(finishing||!run)return;
    recognitionStarting=false;
    $('#listen').textContent='Listening…';
    $('#mic').textContent='🔴 Listening';
    $('#finish').disabled=false;
  };

  r.onresult=e=>{
    if(finishing||!run)return;
    let x='';
    for(let i=e.resultIndex;i<e.results.length;i++)x+=e.results[i][0].transcript+' ';
    let text=x.trim();
    if(text)$('#transcript').textContent=text;
    $('#listen').textContent='Listening…';
  };

  r.onerror=e=>{
    if(finishing||!run)return;
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      recognitionStarting=false;
      run=false;
      stopTimer();
      $('#listen').textContent='Microphone permission denied.';
      $('#mic').textContent='🎙 Start speaking';
      $('#finish').disabled=false;
      return;
    }
    if(e.error!=='no-speech'&&e.error!=='aborted'){
      $('#listen').textContent='Listening…';
    }
  };

  r.onend=()=>{
    if(finishing||!run)return;
    // Chrome can end continuous recognition after silence. Keep the
    // conversation active and restart recognition without touching timing.
    recognitionStarting=false;
    $('#listen').textContent='Listening…';
    $('#mic').textContent='🔴 Listening';
    setTimeout(()=>{
      if(!finishing&&run&&rec===r){
        try{
          recognitionStarting=true;
          r.start();
        }catch{
          recognitionStarting=false;
          // If start races with a browser restart, leave the active
          // conversation/timer untouched and let the next event recover.
        }
      }
    },100);
  };

  return r;
}

$('#mic').onclick=()=>{
  if(run||recognitionStarting)return;
  if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window)){
    $('#listen').textContent='Speech recognition unavailable in this browser.';
    return;
  }

  finishing=false;
  run=true;
  recognitionStarting=true;
  $('#listen').textContent='Starting microphone…';
  $('#mic').disabled=true;
  $('#mic').textContent='🔴 Starting…';
  $('#finish').disabled=false;

  // Start timing from the user's click, not from SpeechRecognition.onstart.
  // Permission prompts and browser speech events must never freeze the timer.
  startTimer();

  rec=setupRecognition();
  if(!rec){
    run=false;
    recognitionStarting=false;
    stopTimer();
    $('#mic').disabled=false;
    $('#mic').textContent='🎙 Start speaking';
    $('#finish').disabled=true;
    return;
  }

  try{
    rec.start();
    setTimeout(()=>{
      if(run&&!finishing){
        recognitionStarting=false;
        $('#mic').disabled=false;
        $('#mic').textContent='🔴 Listening';
        $('#listen').textContent='Listening…';
      }
    },300);
  }catch{
    recognitionStarting=false;
    run=false;
    stopTimer();
    $('#mic').disabled=false;
    $('#mic').textContent='🎙 Start speaking';
    $('#finish').disabled=true;
    $('#listen').textContent='Could not start the microphone. Please try again.';
  }
};

$('#finish').onclick=()=>{
  if(finishing)return;

  // Capture elapsed time before changing run state so Finish works even
  // when the user ends immediately after starting.
  updateTimer();
  finishing=true;
  run=false;
  recognitionStarting=false;

  if(rec){try{rec.onend=null;rec.stop()}catch{} rec=null;}
  stopTimer();

  $('#mic').disabled=true;
  $('#finish').disabled=true;
  $('#listen').textContent='Finishing…';

  let mins=Math.max(1,Math.round(sec/60));
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

  let lv=['A1','A2','B1','B2','C1','C2'];
  s.stats.level=s.stats.level||lv[Math.min(5,Math.floor(s.stats.conversations/2)+1)];
  if(s.stats.conversations>=1)s.stats.achievements=[...new Set([...s.stats.achievements,'first'])];
  if(s.stats.level)s.stats.achievements=[...new Set([...s.stats.achievements,'level'])];
  if(s.stats.conversations>=4)s.stats.achievements=[...new Set([...s.stats.achievements,'four'])];
  if(s.stats.minutes>=30)s.stats.achievements=[...new Set([...s.stats.achievements,'thirty'])];
  if((s.stats.streak||0)>=7)s.stats.achievements=[...new Set([...s.stats.achievements,'streak'])];

  save();

  $('#feedback').classList.remove('hidden');
  $('#feedback').innerHTML='<b>🤖 AI review</b><ul><li>Give longer answers to build fluency.</li><li>Reduce repeated filler words.</li><li>Ask a follow-up question next time.</li></ul><small>This frontend is ready for a production realtime AI analysis backend.</small>';
  $('#mic').textContent='🎙 Start speaking';
  $('#finish').disabled=true;
  $('#listen').textContent='Completed';
  toast('Conversation saved. Your progress has been updated.');
};

function renderMilestones(){
  let a=s.stats,m=[
    ['🌱','First conversation','Complete your first conversation.',a.conversations>=1],
    ['⚡','Conversation sprint','Complete 4 conversations.',a.conversations>=4],
    ['⏱','30 minute club','Speak for 30 minutes.',a.minutes>=30],
    ['🚀','10 conversations','Become a regular speaker.',a.conversations>=10]
  ];
  $('#milestoneList').innerHTML=m.map(x=>`<div class="card"><b>${x[0]} ${x[1]} ${x[3]?'✓':''}</b><p>${x[2]}</p></div>`).join('');
}

function renderAchievements(){
  let a=s.stats.achievements,x=[
    ['first','🎙','First Words'],
    ['four','⚡','Conversation Sprint'],
    ['thirty','⏱','30 Minute Club'],
    ['streak','🔥','On Fire'],
    ['level','🧠','Level Up']
  ];
  $('#achievementGrid').innerHTML=x.map(q=>`<article style="opacity:${a.includes(q[0])?1:.45}"><b style="font-size:32px">${q[1]}</b><h3>${q[2]}</h3><p>${a.includes(q[0])?'Unlocked':'Locked'}</p></article>`).join('');
}

render();