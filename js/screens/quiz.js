/* ============================================================
   クイズ画面（quiz.js）
   出題・解答・結果シート（フィードバック）・中断確認ダイアログ
   ============================================================ */

// 出題設定（難易度・問題数）に応じた出題プールを組み立てる
// questionCount: 5 | 10 | 15 | "all-diff"（鬼＝選択中の難易度全問） | "all"（修羅＝難易度問わず全問）
function buildQuizOrder(){
  const ignoreDifficulty = state.questionCount === "all";
  const pool = ignoreDifficulty
    ? QUESTIONS
    : QUESTIONS.filter(q => q.difficulty === state.difficulty);
  const isUnlimited = ignoreDifficulty || state.questionCount === "all-diff";
  const length = isUnlimited ? pool.length : Math.min(state.questionCount, pool.length);
  return shuffle(pool).slice(0, length);
}

function startQuiz(){
  Kaii.cancel();
  if(state.kaiiEvent) Kaii.preload();
  state.order = buildQuizOrder();
  state.current = 0;
  state.score = 0;
  showScreen("quiz");
  presentQuestion();
}

function currentQuestion(){
  return state.order[state.current];
}

// 怪異演出の制限時間（秒）
const KAII_TIME_LIMIT = { choice: 7, free: 10 };

function isKaiiQuestion(q){
  return state.kaiiEvent && (!!q.kaiiEvent || !!KAII_DEBUG);
}

// 問題を出す。怪異演出の対象なら、予兆（段階1）を挟んでから表示し、制限時間（段階2）を開始する
function presentQuestion(){
  const q = currentQuestion();
  if(!isKaiiQuestion(q)){
    renderQuestion();
    return;
  }
  state.locked = true;
  // 予兆（約2.2秒）の間に、この問題の漢字のフォントを読み込んでおく
  loadKanjiFont(q.kanji);
  // 予兆の裏で前の問題が見えないように消しておく
  el.kanjiMain.textContent = "";
  el.choiceGrid.innerHTML = "";
  Kaii.begin({
    limitSec: KAII_TIME_LIMIT[state.mode],
    onReveal: renderQuestion,
    onTimeout: handleKaiiTimeout,
  });
}

/* ---- 出題漢字のフォント（Yuji Syuku）の読み込み ----
   日本語フォントは文字のグループごとに、その文字が画面に出た時点で後から読み込まれる。
   そのままだと新しい漢字が一瞬明朝体で表示されてから筆文字に切り替わるため、
   読み込みが終わるまで漢字を隠し、次の問題の漢字も先読みしておく */
const KANJI_FONT_WAIT_MS = 1000; // 通信が遅い時でも、最大この時間待ったら表示する
let kanjiRevealToken = 0;        // 前の問題の読み込み完了で、今の漢字を表示してしまわないための番号

function loadKanjiFont(text){
  if(!text || !document.fonts || !document.fonts.load) return Promise.resolve();
  return document.fonts.load('84px "Yuji Syuku"', text).catch(() => {});
}

function showKanjiWhenFontReady(text){
  const token = ++kanjiRevealToken;
  el.kanjiMain.style.visibility = "hidden";
  el.kanjiMain.textContent = text;
  const timeout = new Promise(resolve => setTimeout(resolve, KANJI_FONT_WAIT_MS));
  Promise.race([loadKanjiFont(text), timeout]).then(() => {
    if(token === kanjiRevealToken) el.kanjiMain.style.visibility = "";
  });
}

function renderQuestion(){
  state.locked = false;
  const q = currentQuestion();
  const total = state.order.length;

  el.progressLabel.textContent = `問 ${state.current+1} / ${total} ・ 正解 ${state.score}`;
  el.progressFill.style.width = `${(state.current/total)*100}%`;
  showKanjiWhenFontReady(q.kanji);
  // 解答している間に、次の問題の漢字のフォントを裏で読み込んでおく
  const next = state.order[state.current + 1];
  if(next) loadKanjiFont(next.kanji);
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

// 怪異演出の制限時間切れ：誤答と同じ扱いで罰演出へ進む
function handleKaiiTimeout(){
  if(state.locked) return;
  state.locked = true;
  // 中断確認ダイアログを開いていても時間は止まらない（怪異は待ってくれない）
  closeConfirmHome();
  const q = currentQuestion();
  if(state.mode === "choice"){
    Array.from(el.choiceGrid.children).forEach(b => {
      b.disabled = true;
      if(isCorrectAnswer(b.textContent, q)) b.classList.add("is-correct");
    });
  } else {
    el.freeInput.disabled = true;
    el.btnSubmit.disabled = true;
  }
  finishAnswer(false, true);
}

/* ---- 結果シート（解答直後のフィードバック） ---- */

// 結果シートの見た目を切り替える（null：通常 / "purified"：怪異を祓った / "cursed"：怪異に憑かれた）
function setFeedbackStyle(kind){
  el.feedbackOverlay.classList.toggle("kaii-purified", kind === "purified");
  el.feedbackOverlay.classList.toggle("kaii-cursed", kind === "cursed");
}

function finishAnswer(isRight, timedOut = false){
  const q = currentQuestion();
  const isKaii = Kaii.isPressuring();
  const remainMs = isKaii ? Kaii.stopPressure() : 0;
  if(isRight) state.score++;
  el.progressLabel.textContent = `問 ${state.current+1} / ${state.order.length} ・ 正解 ${state.score}`;
  el.progressFill.style.width = `${((state.current+1)/state.order.length)*100}%`;

  el.fbResult.className = "fb-result " + (isRight ? "correct" : "wrong");
  el.fbReadingText.textContent = q.answers[0];
  el.fbTriviaText.textContent = q.trivia;
  const isLastQuestion = state.current >= state.order.length - 1;
  el.btnNext.textContent = isLastQuestion ? "結果確認へ" : "次の漢字へ";

  if(!isKaii){
    if(isRight) SoundEngine.playCorrectSfx(); else SoundEngine.playWrongSfx();
    setFeedbackStyle(null);
    el.fbResult.textContent = isRight ? "正解" : "不正解";
    el.feedbackOverlay.classList.add("show");
    return;
  }

  // ---- 怪異演出中の解答 ----
  if(isRight){
    // 時間内に正解：段階3をスキップし、祓いの演出と専用シートへ
    SoundEngine.playPurifySfx();
    Kaii.purify();
    setFeedbackStyle("purified");
    el.fbResult.textContent = "祓い清めた";
    el.fbKaiiNote.textContent = `正解 ― 残り${toKyuNumeral(Math.ceil(remainMs / 1000))}秒で退けた`;
    el.feedbackOverlay.classList.add("show");
  } else {
    // 誤答・時間切れ：段階3（罰演出）のあと専用シートへ
    el.freeInput.blur();
    Kaii.runPunish(() => {
      setFeedbackStyle("cursed");
      el.fbResult.textContent = timedOut ? "時間切れ――憑かれた" : "憑かれた";
      el.fbKaiiNote.textContent = timedOut ? "制限時間内に祓えなかった" : "不正解 ― 読みを誤り、怪異に魅入られた";
      el.feedbackOverlay.classList.add("show");
    });
  }
}

el.btnNext.addEventListener("click", () => {
  el.feedbackOverlay.classList.remove("show");
  Kaii.clearResidue();
  state.current++;
  if(state.current >= state.order.length){
    showResult();
  } else {
    presentQuestion();
  }
});

/* ---- クイズ中断（ホームへ戻る）確認ダイアログ ---- */
function openConfirmHome(){
  el.confirmOverlay.classList.add("show");
}
function closeConfirmHome(){
  el.confirmOverlay.classList.remove("show");
}
function goHome(){
  Kaii.cancel();
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
