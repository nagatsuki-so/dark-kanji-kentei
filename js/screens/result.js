/* ============================================================
   結果画面（result.js）
   ============================================================ */
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

document.getElementById("btn-retry-same").addEventListener("click", () => {
  startQuiz();
});
document.getElementById("btn-retry-mode").addEventListener("click", () => {
  showScreen("mode");
});
document.getElementById("btn-result-home").addEventListener("click", () => {
  SoundEngine.playTapSfx();
  showScreen("title");
});
