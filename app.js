const K = "openTalkV1";
let s = JSON.parse(localStorage.getItem(K) || "null") || {
  profile: {},
  stats: { conversations: 0, minutes: 0, level: null, achievements: [] },
  today: { conversations: 0, minutes: 0 },
};
const $ = (x) => document.querySelector(x);
function save() {
  localStorage.setItem(K, JSON.stringify(s));
  render();
}
function render() {
  let p = s.profile,
    t = s.today,
    a = s.stats;
  $("#name").value = p.name || "";
  $("#age").value = p.age || "";
  $("#country").value = p.country || "";
  $("#gender").value = p.gender || "Prefer not to say";
  let l = a.level || "Not assessed yet";
  $("#levelValue").textContent = l;
  $("#homeLevel").textContent = l;
  $("#homeMinutes").textContent = a.minutes;
  $("#statConvos").textContent = a.conversations;
  $("#statMinutes").textContent = a.minutes;
  $("#statStreak").textContent = a.streak || 0;
  $("#statAch").textContent = a.achievements.length;
  $("#goalCount").textContent = `${t.conversations}/4`;
  $("#goalProgress").style.width =
    Math.min(100, (t.conversations / 4) * 100) + "%";
  let n = { A1: 12, A2: 28, B1: 45, B2: 62, C1: 82, C2: 100 };
  $("#levelBar").style.width = (n[l] || 0) + "%";
  let lock = p.savedAt && Date.now() - p.savedAt < 30 * 86400000;
  $("#profileLock").textContent = lock
    ? "Profile locked for 30 days after your last save."
    : "Ready to save. Saving starts a 30-day lock.";
  renderMilestones();
  renderAchievements();
}
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.toggle("active", v.id === b.dataset.view));
      scrollTo(0, 0);
    }),
);
$("#profileForm").onsubmit = (e) => {
  e.preventDefault();
  if (s.profile.savedAt && Date.now() - s.profile.savedAt < 30 * 86400000)
    return alert("Profile is locked for 30 days.");
  s.profile = {
    name: $("#name").value.trim(),
    age: $("#age").value,
    country: $("#country").value,
    gender: $("#gender").value,
    savedAt: Date.now(),
  };
  save();
  alert("Profile saved and locked for 30 days.");
};
let rec = null,
  conversationState = "closed",
  sec = 0,
  startedAt = 0,
  int = null,
  restartTimeout = null;

function renderTimer() {
  if (conversationState === "listening")
    sec = Math.floor((Date.now() - startedAt) / 1000);
  $("#timer").textContent =
    String(Math.floor(sec / 60)).padStart(2, "0") +
    ":" +
    String(sec % 60).padStart(2, "0");
}

function stopTimer() {
  clearInterval(int);
  int = null;
}

function stopRecognition() {
  clearTimeout(restartTimeout);
  restartTimeout = null;
  if (!rec) return;
  const activeRecognition = rec;
  rec = null;
  activeRecognition.onend = null;
  try {
    activeRecognition.stop();
  } catch {}
}

function startRecognition() {
  if (conversationState !== "listening" || rec) return;
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new R();
  rec = recognition;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    if (conversationState !== "listening") return;
    let transcript = "";
    for (let i = 0; i < event.results.length; i++)
      transcript += event.results[i][0].transcript + " ";
    $("#transcript").textContent = transcript.trim();
  };
  recognition.onerror = (event) => {
    if (conversationState !== "listening") return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      conversationState = "ready";
      stopTimer();
      rec = null;
      $("#listen").textContent = "Microphone access is required.";
      $("#mic").disabled = false;
      $("#mic").textContent = "🎙 Start speaking";
    }
  };
  recognition.onend = () => {
    if (rec === recognition) rec = null;
    if (conversationState === "listening")
      restartTimeout = setTimeout(startRecognition, 250);
  };
  try {
    recognition.start();
  } catch {
    rec = null;
    if (conversationState === "listening")
      restartTimeout = setTimeout(startRecognition, 250);
  }
}

function open() {
  stopTimer();
  stopRecognition();
  $("#modal").classList.remove("hidden");
  sec = 0;
  startedAt = 0;
  conversationState = "ready";
  $("#timer").textContent = "00:00";
  $("#listen").textContent = "Ready";
  $("#partner").textContent = "Your speaking partner is ready";
  $("#transcript").textContent =
    "Press Start speaking and allow microphone access.";
  $("#feedback").classList.add("hidden");
  $("#feedback").innerHTML = "";
  $("#mic").disabled = false;
  $("#mic").textContent = "🎙 Start speaking";
  $("#close").disabled = false;
  $("#finish").disabled = false;
  $("#finish").textContent = "Finish";
}
$("#talkNow").onclick = open;
$("#findPartner").onclick = () => {
  let b = $("#findPartner");
  b.disabled = true;
  b.innerHTML = '<span class="loading-spinner"></span>Finding partner...';
  setTimeout(() => {
    b.disabled = false;
    b.textContent = "Find partner";
    open();
  }, 900);
};
$("#close").onclick = () => {
  if (conversationState === "finishing") return;
  conversationState = "closed";
  $("#modal").classList.add("hidden");
  stopRecognition();
  stopTimer();
};
$("#mic").onclick = () => {
  if (conversationState !== "ready") return;
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window))
    return ($("#listen").textContent =
      "Speech recognition unavailable in this browser.");
  conversationState = "listening";
  startedAt = Date.now();
  sec = 0;
  $("#listen").textContent = "Listening…";
  $("#mic").textContent = "🔴 Listening";
  $("#mic").disabled = true;
  renderTimer();
  int = setInterval(renderTimer, 250);
  startRecognition();
};
$("#finish").onclick = async () => {
  if (
    conversationState === "finishing" ||
    conversationState === "finished" ||
    conversationState === "closed"
  )
    return;
  if (conversationState === "listening") renderTimer();
  conversationState = "finishing";
  stopRecognition();
  stopTimer();
  $("#mic").disabled = true;
  $("#close").disabled = true;
  $("#finish").disabled = true;
  $("#finish").innerHTML =
    '<span class="loading-spinner"></span>Finishing...';
  $("#listen").textContent = "Finishing…";

  // Let the stopped controls and loading state render before saving progress.
  await new Promise((resolve) => setTimeout(resolve, 150));

  let mins = Math.max(1, Math.round(sec / 60));
  s.stats.conversations++;
  s.stats.minutes += mins;
  s.today.conversations++;
  s.today.minutes += mins;
  let lv = ["A1", "A2", "B1", "B2", "C1", "C2"];
  s.stats.level =
    s.stats.level || lv[Math.min(5, Math.floor(s.stats.conversations / 2) + 1)];
  if (s.stats.conversations >= 1)
    s.stats.achievements = [...new Set([...s.stats.achievements, "first"])];
  if (s.stats.conversations >= 4)
    s.stats.achievements = [...new Set([...s.stats.achievements, "four"])];
  if (s.stats.minutes >= 30)
    s.stats.achievements = [...new Set([...s.stats.achievements, "thirty"])];
  save();
  conversationState = "finished";
  $("#partner").textContent = "Conversation complete";
  $("#listen").textContent = "Finished";
  $("#finish").textContent = "Finished";
  $("#close").disabled = false;
  $("#feedback").classList.remove("hidden");
  $("#feedback").innerHTML =
    "<b>🤖 AI review</b><ul><li>Give longer answers to build fluency.</li><li>Reduce repeated filler words.</li><li>Ask a follow-up question next time.</li></ul><small>This frontend is ready for a production realtime AI analysis backend.</small>";
};
function renderMilestones() {
  let a = s.stats,
    m = [
      [
        "🌱",
        "First conversation",
        "Complete your first conversation.",
        a.conversations >= 1,
      ],
      [
        "⚡",
        "Conversation sprint",
        "Complete 4 conversations.",
        a.conversations >= 4,
      ],
      ["⏱", "30 minute club", "Speak for 30 minutes.", a.minutes >= 30],
      [
        "🚀",
        "10 conversations",
        "Become a regular speaker.",
        a.conversations >= 10,
      ],
    ];
  $("#milestoneList").innerHTML = m
    .map(
      (x) =>
        `<div class="card"><b>${x[0]} ${x[1]} ${x[3] ? "✓" : ""}</b><p>${x[2]}</p></div>`,
    )
    .join("");
}
function renderAchievements() {
  let a = s.stats.achievements,
    x = [
      ["first", "🎙", "First Words"],
      ["four", "⚡", "Conversation Sprint"],
      ["thirty", "⏱", "30 Minute Club"],
      ["streak", "🔥", "On Fire"],
      ["level", "🧠", "Level Up"],
    ];
  $("#achievementGrid").innerHTML = x
    .map(
      (q) =>
        `<article style="opacity:${a.includes(q[0]) ? 1 : 0.45}"><b style="font-size:32px">${q[1]}</b><h3>${q[2]}</h3><p>${a.includes(q[0]) ? "Unlocked" : "Locked"}</p></article>`,
    )
    .join("");
}
render();
