/* ============================================================
   ダーク漢字検定 〜怪異・呪術・難読漢字〜 - app.js
   純粋な Vanilla JavaScript（jQuery等のライブラリは使用していません）
   ============================================================ */

/* ============================================================
   ① データ：questions.json を実行時に fetch で読み込む
   同一オリジン（同じサーバー配下）に questions.json を置いておくこと。
   ⑤の自動生成バッチ（generate_questions.js）が更新するのはこのファイル。
   answers は「ゆらぎ吸収」後の比較に使う正解候補の配列
   ============================================================ */
let QUESTIONS = [];
let questionsPromise = null;

function loadQuestions(){
  // 一度取得したPromiseはキャッシュし、ボタン押下時に二重fetchしないようにする
  if(!questionsPromise){
    questionsPromise = fetch('./questions.json', { cache: "no-store" })
      .then(res => {
        if(!res.ok) throw new Error(`questions.json の取得に失敗しました (HTTP ${res.status})`);
        return res.json();
      })
      .then(data => {
        if(!Array.isArray(data) || data.length === 0){
          throw new Error("questions.json の中身が空、または不正な形式です");
        }
        return data;
      })
      .catch(err => {
        questionsPromise = null; // 失敗時は次回リトライできるようキャッシュを捨てる
        throw err;
      });
  }
  return questionsPromise;
}

// ページ表示時点でバックグラウンド先読みを開始（失敗はここでは無視し、ボタン押下時に検知する）
loadQuestions().catch(() => {});

/* ============================================================
   ② ゆらぎ吸収（入力の正規化）機能
   ・全角/半角統一、スペース除去、カタカナ→ひらがな統一
   ・送り仮名の有無ゆらぎ：出題文（kanji）末尾の送り仮名（ひらがな部分）を
     正解から取り除いたバージョンも許容候補に加える
     例）「祟り」→ answers:["たたり"] の場合、「たた」でも正解扱いにする
     　　「禍々しい」→ answers:["まがまがしい"] の場合、「まがまが」でも正解扱いにする
   ============================================================ */
function normalizeAnswer(str){
  if(!str) return "";
  return str
    // 全角英数字・記号 → 半角
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    // カタカナ → ひらがな
    .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    // 全角スペース・半角スペース・タブ類を全除去
    .replace(/[\s\u3000]/g, "")
    .trim()
    .toLowerCase();
}

// 出題文（kanji）の末尾に連続するひらがな（＝送り仮名）を抽出する
function getTrailingOkurigana(kanjiText){
  const hiraganaRe = /[\u3041-\u3096\u309d\u309e]/;
  let suffix = "";
  for(let i = kanjiText.length - 1; i >= 0; i--){
    if(hiraganaRe.test(kanjiText[i])){
      suffix = kanjiText[i] + suffix;
    } else {
      break;
    }
  }
  return suffix;
}

// answers配列に、送り仮名の有無どちらでも許容されるバリエーションを加えた集合を作る
function buildAcceptedAnswers(question){
  const suffix = getTrailingOkurigana(question.kanji);
  const accepted = new Set(question.answers);
  if(suffix){
    question.answers.forEach(a => {
      if(a.endsWith(suffix)){
        const stripped = a.slice(0, a.length - suffix.length);
        if(stripped) accepted.add(stripped);
      }
    });
  }
  return Array.from(accepted);
}

function isCorrectAnswer(userInput, question){
  const normalizedInput = normalizeAnswer(userInput);
  if(!normalizedInput) return false;
  const accepted = buildAcceptedAnswers(question);
  return accepted.some(a => normalizeAnswer(a) === normalizedInput);
}

/* ============================================================
   ③ 演出・サウンド（Web Audio APIで合成。外部音源ファイル不要）
   ============================================================ */
const SoundEngine = (() => {
  let ctx = null;
  let bgmNodes = null;
  let muted = false;
  let masterGain = null;

  function ensureContext(){
    if(!ctx){
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(ctx.destination);
    }
    return ctx;
  }

  function unlock(){
    ensureContext();
    if(ctx.state === "suspended") ctx.resume();
    if(!bgmNodes) startBGM();
  }

  function startBGM(){
    const now = ctx.currentTime;
    const bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.05;
    bgmGain.connect(masterGain);

    // 不穏な低音ドローン（2声のデチューンで揺らぎを出す）
    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.value = 55; // A1
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 55 * 1.005;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;

    // LFOでゆっくり音量が明滅する＝呼吸するような不気味さ
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain);
    lfoGain.connect(bgmGain.gain);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(bgmGain);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);

    bgmNodes = { osc1, osc2, lfo, bgmGain };
  }

  function playCorrectSfx(){
    if(muted) return;
    ensureContext();
    const now = ctx.currentTime;
    // お経の鈴（りん）を模した澄んだ短音の連打
    [0, 0.12, 0.26].forEach((t, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 880 + i * 220;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.18, now + t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.5);
      o.connect(g); g.connect(masterGain);
      o.start(now + t); o.stop(now + t + 0.55);
    });
  }

  function playWrongSfx(){
    if(muted) return;
    ensureContext();
    const now = ctx.currentTime;
    // 低い唸り＋ノイズの悲鳴風
    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){ data[i] = (Math.random()*2-1) * (1 - i/bufferSize); }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    noise.connect(filter); filter.connect(g); g.connect(masterGain);
    noise.start(now); noise.stop(now + 0.45);

    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(60, now + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.15, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    o.connect(og); og.connect(masterGain);
    o.start(now); o.stop(now + 0.4);
  }

  function playTapSfx(){
    if(muted) return;
    ensureContext();
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.08, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.12);
    o.connect(g); g.connect(masterGain);
    o.start(now); o.stop(now+0.15);
  }

  function toggleMute(){
    muted = !muted;
    if(masterGain) masterGain.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return {
    unlock, playCorrectSfx, playWrongSfx, playTapSfx, toggleMute,
    get muted(){ return muted; },
    get isUnlocked(){ return !!bgmNodes; }
  };
})();

/* ============================================================
   ④⑤ 画面制御・出題ロジック
   ============================================================ */
const QUIZ_LENGTH = 10; // 1回のクイズで出題する問題数

const state = {
  mode: null,       // "choice" | "free"
  order: [],        // 出題順（シャッフルの上、先頭からQUIZ_LENGTH件抜き出したquestionsインデックス）
  current: 0,
  score: 0,
  locked: false      // 二重回答防止
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

function startQuiz(mode){
  state.mode = mode;
  const shuffledIndices = shuffle(QUESTIONS.map((_,i)=>i));
  state.order = shuffledIndices.slice(0, Math.min(QUIZ_LENGTH, shuffledIndices.length));
  state.current = 0;
  state.score = 0;
  showScreen("quiz");
  renderQuestion();
}

function currentQuestion(){
  return QUESTIONS[state.order[state.current]];
}

function renderQuestion(){
  state.locked = false;
  const q = currentQuestion();
  const total = state.order.length;

  el.progressLabel.textContent = `問 ${state.current+1} / ${total} ・ 正解 ${state.score}`;
  el.progressFill.style.width = `${(state.current/total)*100}%`;
  el.kanjiMain.textContent = q.kanji;
  el.kanjiIndexLabel.textContent = "この漢字の読みは？";

  if(state.mode === "choice"){
    el.choiceGrid.style.display = "grid";
    el.freeInputRow.style.display = "none";
    el.freeHint.style.display = "none";
    el.choiceGrid.innerHTML = "";
    shuffle(q.choices).forEach(choiceText => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.textContent = choiceText;
      btn.addEventListener("click", () => handleChoiceAnswer(choiceText, btn));
      el.choiceGrid.appendChild(btn);
    });
  } else {
    el.choiceGrid.style.display = "none";
    el.freeInputRow.style.display = "flex";
    el.freeHint.style.display = "block";
    el.freeInput.value = "";
    el.freeInput.disabled = false;
    el.btnSubmit.disabled = false;
    setTimeout(()=> el.freeInput.focus(), 200);
  }
}

function handleChoiceAnswer(choiceText, btnEl){
  if(state.locked) return;
  state.locked = true;
  const q = currentQuestion();
  // 正誤判定は answers 配列（送り仮名・ゆらぎ許容込み）との比較で行う
  const isRight = isCorrectAnswer(choiceText, q);

  Array.from(el.choiceGrid.children).forEach(b => {
    b.disabled = true;
    if(isCorrectAnswer(b.textContent, q)) b.classList.add("is-correct");
  });
  if(!isRight) btnEl.classList.add("is-wrong");

  finishAnswer(isRight);
}

el.btnSubmit.addEventListener("click", submitFreeAnswer);
el.freeInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") submitFreeAnswer(); });

function submitFreeAnswer(){
  if(state.locked) return;
  const val = el.freeInput.value;
  if(!val.trim()) return;
  state.locked = true;
  el.freeInput.disabled = true;
  el.btnSubmit.disabled = true;
  const q = currentQuestion();
  const isRight = isCorrectAnswer(val, q);
  finishAnswer(isRight);
}

function finishAnswer(isRight){
  const q = currentQuestion();
  if(isRight){
    state.score++;
    SoundEngine.playCorrectSfx();
  } else {
    SoundEngine.playWrongSfx();
  }
  el.progressLabel.textContent = `問 ${state.current+1} / ${state.order.length} ・ 正解 ${state.score}`;
  el.progressFill.style.width = `${((state.current+1)/state.order.length)*100}%`;

  el.fbResult.textContent = isRight ? "正解" : "不正解";
  el.fbResult.className = "fb-result " + (isRight ? "correct" : "wrong");
  el.fbReadingText.textContent = q.answers[0];
  el.fbTriviaText.textContent = q.trivia;
  const isLastQuestion = state.current >= state.order.length - 1;
  el.btnNext.textContent = isLastQuestion ? "結果確認へ" : "次の漢字へ";
  el.feedbackOverlay.classList.add("show");
}

el.btnNext.addEventListener("click", () => {
  el.feedbackOverlay.classList.remove("show");
  state.current++;
  if(state.current >= state.order.length){
    showResult();
  } else {
    renderQuestion();
  }
});

function showResult(){
  showScreen("result");
  const total = state.order.length;
  el.resultScoreNum.textContent = state.score;
  el.resultScoreTotal.textContent = total;
  const rate = state.score / total;
  let rank, glyph, tier;
  if(rate === 1){ rank = "闇を統べる大祓魔師"; glyph = "封"; tier = "seal"; }
  else if(rate >= 0.8){ rank = "一人前の祓魔師"; glyph = "鬼"; tier = "oni"; }
  else if(rate >= 0.5){ rank = "見習い祓魔師"; glyph = "霊"; tier = "rei"; }
  else { rank = "怪異に憑かれし者"; glyph = "呪"; tier = "noroi"; }
  el.resultRank.textContent = rank;
  document.getElementById("result-glyph").textContent = glyph;
  document.getElementById("result-glyph-block").dataset.rank = tier;
}

/* ---- クイズ中断（ホームへ戻る）確認ダイアログ ---- */
function openConfirmHome(){
  el.confirmOverlay.classList.add("show");
}
function closeConfirmHome(){
  el.confirmOverlay.classList.remove("show");
}
function goHome(){
  closeConfirmHome();
  el.feedbackOverlay.classList.remove("show");
  state.locked = true;
  showScreen("title");
}

el.btnQuizHome.addEventListener("click", () => {
  SoundEngine.playTapSfx();
  openConfirmHome();
});
el.btnConfirmCancel.addEventListener("click", closeConfirmHome);
el.btnConfirmHome.addEventListener("click", goHome);

/* ---- 起動時のデータ読込＆画面遷移イベント ---- */
async function handleOpenSeal(){
  SoundEngine.unlock();
  SoundEngine.playTapSfx();

  el.btnOpenSeal.disabled = true;
  el.titleHint.textContent = "問題を召喚中…";

  try{
    QUESTIONS = await loadQuestions();
    el.btnOpenSeal.disabled = false;
    el.titleHint.textContent = "";
    showScreen("mode");
  }catch(err){
    console.error(err);
    el.btnOpenSeal.disabled = false;
    el.titleHint.textContent = "";
    el.errorDetail.textContent = err.message || "questions.json を読み込めませんでした。";
    showScreen("error");
  }
}

el.btnOpenSeal.addEventListener("click", handleOpenSeal);
el.btnRetryLoad.addEventListener("click", () => {
  showScreen("title");
});

document.querySelectorAll(".mode-card").forEach(card => {
  card.addEventListener("click", () => {
    SoundEngine.playTapSfx();
    startQuiz(card.dataset.mode);
  });
});

document.getElementById("btn-mode-back").addEventListener("click", () => {
  showScreen("title");
});

document.getElementById("btn-retry-same").addEventListener("click", () => {
  startQuiz(state.mode);
});
document.getElementById("btn-retry-mode").addEventListener("click", () => {
  showScreen("mode");
});
document.getElementById("btn-result-home").addEventListener("click", () => {
  SoundEngine.playTapSfx();
  showScreen("title");
});

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
