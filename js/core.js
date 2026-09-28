/* ============================================================
   全画面の共通処理（core.js）
   状態（state）、画面の要素（el）、画面切り替え、BGMボタン、背景の熾火
   ============================================================ */
const state = {
  difficulty: "normal",  // "easy" | "normal" | "hard"（questionCountが"all"の間は無視される）
  questionCount: 10,     // 5 | 10 | 15 | "all"（修羅モード＝全問）
  mode: "choice",        // 解答形式："choice" | "free"
  kaiiEvent: false,      // 怪異乱入の有無（true かつ問題に kaiiEvent フラグがあれば怪異演出が発生）
  order: [],             // 出題順（シャッフル済みのquestionオブジェクト配列）
  current: 0,
  score: 0,
  locked: false          // 二重回答防止
};

const el = {
  screens: {
    title: document.getElementById("screen-title"),
    mode: document.getElementById("screen-mode"),
    quiz: document.getElementById("screen-quiz"),
    result: document.getElementById("screen-result"),
    error: document.getElementById("screen-error"),
  },
  titleHint: document.getElementById("title-hint"),
  btnOpenSeal: document.getElementById("btn-open-seal"),
  errorDetail: document.getElementById("error-detail"),
  btnRetryLoad: document.getElementById("btn-retry-load"),
  progressLabel: document.getElementById("progress-label"),
  progressFill: document.getElementById("progress-fill"),
  kanjiMain: document.getElementById("kanji-main"),
  kanjiIndexLabel: document.getElementById("kanji-index-label"),
  choiceGrid: document.getElementById("choice-grid"),
  freeInputRow: document.getElementById("free-input-row"),
  freeInput: document.getElementById("free-input"),
  freeHint: document.getElementById("free-hint"),
  btnSubmit: document.getElementById("btn-submit"),
  feedbackOverlay: document.getElementById("feedback-overlay"),
  fbResult: document.getElementById("fb-result"),
  fbReadingText: document.getElementById("fb-reading-text"),
  fbTriviaText: document.getElementById("fb-trivia-text"),
  fbKaiiNote: document.getElementById("fb-kaii-note"),
  btnNext: document.getElementById("btn-next"),
  btnMute: document.getElementById("btn-mute"),
  btnQuizHome: document.getElementById("btn-quiz-home"),
  confirmOverlay: document.getElementById("confirm-overlay"),
  btnConfirmCancel: document.getElementById("btn-confirm-cancel"),
  btnConfirmHome: document.getElementById("btn-confirm-home"),
  resultScoreNum: document.getElementById("result-score-num"),
  resultScoreTotal: document.getElementById("result-score-total"),
  resultRank: document.getElementById("result-rank"),
};

function showScreen(name){
  Object.values(el.screens).forEach(s => s.classList.remove("active"));
  el.screens[name].classList.add("active");
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/* ---- サウンドON/OFF（ホーム画面含む全画面から共通で操作可能） ----
   まだ音声が一度も解禁されていない場合はクリックで解禁（BGM開始）、
   解禁済みならミュートのトグルとして働く。 */
el.btnMute.addEventListener("click", () => {
  if(!SoundEngine.isUnlocked){
    SoundEngine.unlock();
    el.btnMute.textContent = "🔊";
  } else {
    const isMuted = SoundEngine.toggleMute();
    el.btnMute.textContent = isMuted ? "🔇" : "🔊";
  }
});

/* ---- 背景の熾火パーティクル生成 ---- */
(function spawnEmbers(){
  const layer = document.getElementById("embers");
  const count = 14;
  for(let i=0;i<count;i++){
    const e = document.createElement("div");
    e.className = "ember";
    const left = Math.random()*100;
    const duration = 9 + Math.random()*10;
    const delay = Math.random()*12;
    e.style.left = left + "vw";
    e.style.animationDuration = duration + "s";
    e.style.animationDelay = delay + "s";
    layer.appendChild(e);
  }
})();
