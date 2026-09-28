/* ============================================================
   出題設定画面（mode.js）
   4つの選択グループ、選択肢の吹き出し（問題数・怪異発生率）、各項目の説明モーダル
   ============================================================ */

/* ---- 各項目の説明モーダル ---- */
const infoOverlay = document.getElementById("info-overlay");
document.getElementById("btn-mode-info").addEventListener("click", () => {
  SoundEngine.playTapSfx();
  infoOverlay.classList.add("show");
});
document.getElementById("btn-info-close").addEventListener("click", () => {
  SoundEngine.playTapSfx();
  infoOverlay.classList.remove("show");
});

/* ---- 4つの選択グループ配線 ---- */
// グループ内のボタンを単一選択（ラジオ的）に配線する共通ヘルパー
function setupOptionGroup(buttons, onSelect){
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      if(btn.disabled) return;
      SoundEngine.playTapSfx();
      buttons.forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      onSelect(btn.dataset.value);
    });
  });
}

const difficultyButtons = Array.from(document.querySelectorAll("#group-difficulty .option-pill"));
const countButtons = Array.from(document.querySelectorAll("#group-count .option-pill"));
const formatButtons = Array.from(document.querySelectorAll("#group-format .mode-card"));
const kaiiButtons = Array.from(document.querySelectorAll("#group-kaii .option-pill"));

// 難易度別の問題数・怪異発生率（怪異演出フラグ有の問題数÷全問題数×100）を集計する
function computeQuestionStats(){
  const diffs = ["easy", "normal", "hard"];
  const byDiff = {};
  diffs.forEach(d => {
    const list = QUESTIONS.filter(q => q.difficulty === d);
    const kaiiCount = list.filter(q => q.kaiiEvent).length;
    byDiff[d] = { count: list.length, kaiiRate: list.length ? (kaiiCount / list.length * 100) : 0 };
  });
  const total = QUESTIONS.length;
  const totalKaiiCount = QUESTIONS.filter(q => q.kaiiEvent).length;
  return { total, byDiff, totalKaiiRate: total ? (totalKaiiCount / total * 100) : 0 };
}

let questionStats = null;
const pct = n => n.toFixed(1);

// 「全問：鬼」下部の問題数表示、「あり」下部の怪異発生率は選択中の難易度に連動するため、難易度変更のたびに更新する
function updateCountAllDiffSub(){
  if(!questionStats) return;
  document.getElementById("count-all-diff").textContent = `${questionStats.byDiff[state.difficulty].count}問`;
}

// 「全問：忌」を選んでいる間は難易度が使われないため、全問に対する発生確率を表示する
function updateKaiiRateSub(){
  if(!questionStats) return;
  const rate = state.questionCount === "all"
    ? questionStats.totalKaiiRate
    : questionStats.byDiff[state.difficulty].kaiiRate;
  document.getElementById("kaii-rate-sub").textContent = `発生確率：${pct(rate)}%`;
}

// データ読込直後に一度だけ計算し、モーダルの統計欄・各ボタン下部のキャプションへ反映する
function applyQuestionStatsToUI(){
  questionStats = computeQuestionStats();
  const { total, byDiff, totalKaiiRate } = questionStats;

  document.getElementById("info-stats-count").textContent =
    `易しい ${byDiff.easy.count}問 ／ 普通 ${byDiff.normal.count}問 ／ 難しい ${byDiff.hard.count}問 ／ 全体 ${total}問`;
  document.getElementById("info-stats-kaii").innerHTML =
    `▼発生確率<br>易しい ${pct(byDiff.easy.kaiiRate)}%／普通 ${pct(byDiff.normal.kaiiRate)}%／難しい ${pct(byDiff.hard.kaiiRate)}%／全体 ${pct(totalKaiiRate)}%`;

  document.getElementById("count-all").textContent = `${total}問`;

  updateCountAllDiffSub();
  updateKaiiRateSub();
}

setupOptionGroup(difficultyButtons, (value) => {
  state.difficulty = value;
  updateCountAllDiffSub();
  updateKaiiRateSub();
});

setupOptionGroup(countButtons, (value) => {
  state.questionCount = (value === "all" || value === "all-diff") ? value : Number(value);
  // 「全問（修羅）」の時だけ難易度指定が無意味になるため難易度ボタンを無効化する
  const isAll = state.questionCount === "all";
  difficultyButtons.forEach(b => { b.disabled = isAll; });
  // 「全問：忌」に切り替えた時・戻した時に、怪異乱入の発生確率の吹き出しも切り替える
  updateKaiiRateSub();
});

setupOptionGroup(formatButtons, (value) => { state.mode = value; });

setupOptionGroup(kaiiButtons, (value) => { state.kaiiEvent = (value === "on"); });

document.getElementById("btn-mode-start").addEventListener("click", () => {
  SoundEngine.playTapSfx();
  startQuiz();
});

document.getElementById("btn-mode-back").addEventListener("click", () => {
  showScreen("title");
});
