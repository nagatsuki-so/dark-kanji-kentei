/* ============================================================
   怪異演出（kaii.js）
   段階1：予兆 → 段階2：制限時間つきの継続演出 → 段階3：罰（誤答・時間切れ時のみ）
   途中でホームへ戻った時などは cancel() で token を進め、進行中の非同期処理をすべて打ち切る
   ============================================================ */

// 動作確認用：URLに ?kaii=eye|face|curse|onmyoji|all を付けると、怪異乱入「あり」の時に
// 全問題で怪異演出が発生し、罰演出の種類も固定される（all はランダム）
const KAII_DEBUG = new URLSearchParams(location.search).get("kaii");

// 残り秒数の表示に使う旧字体の漢数字（添字＝秒数）
const KYU_NUMERALS = ["零", "壱", "弐", "参", "肆", "伍", "陸", "漆", "捌", "玖", "拾"];
function toKyuNumeral(n){
  return KYU_NUMERALS[Math.max(0, Math.min(KYU_NUMERALS.length - 1, n))];
}

// 陰陽師の霊の最後に画面を埋め尽くす般若心経
const HANNYA_SHINGYO =
  "観自在菩薩行深般若波羅蜜多時照見五蘊皆空度一切苦厄舎利子色不異空空不異色色即是空空即是色受想行識亦復如是" +
  "舎利子是諸法空相不生不滅不垢不浄不増不減是故空中無色無受想行識無眼耳鼻舌身意無色声香味触法無眼界乃至無意識界" +
  "無無明亦無無明尽乃至無老死亦無老死尽無苦集滅道無智亦無得以無所得故菩提薩埵依般若波羅蜜多故心無罣礙無罣礙故" +
  "無有恐怖遠離一切顛倒夢想究竟涅槃三世諸仏依般若波羅蜜多故得阿耨多羅三藐三菩提故知般若波羅蜜多是大神呪是大明呪" +
  "是無上呪是無等等呪能除一切苦真実不虚故説般若波羅蜜多呪即説呪曰羯諦羯諦波羅羯諦波羅僧羯諦菩提薩婆訶般若心経";

const Kaii = (() => {
  const OMEN_MS = 2200;          // 段階1の長さ
  const OMEN_FADE_MS = 300;      // 予兆が消えて問題が見えるまで
  const PUNISH_FADE_MS = 360;    // 罰演出が消えて結果シートが見えるまで
  const VARIANTS = ["eye", "face", "curse", "onmyoji"];
  const CURSE_COLORS = ["#6e0a16", "#8b1a2b", "#a3121f", "#c92a3d", "#d3141f"];  // 赤系のみ（黒背景に映える）

  const app = document.getElementById("app");
  const omen = document.getElementById("kaii-omen");
  const punish = document.getElementById("kaii-punish");
  const purifyLayer = document.getElementById("kaii-purify");
  const timerBox = document.getElementById("kaii-timer");
  const timerNum = document.getElementById("kaii-timer-num");
  const timerFill = document.getElementById("kaii-timer-fill");
  const curseLayer = document.getElementById("kp-curse-layer");
  const curseScene = document.getElementById("kp-curse");
  const onmyojiScene = document.getElementById("kp-onmyoji");
  const sutraLayer = document.getElementById("kp-sutra");
  const warpNoise = document.getElementById("kaii-warp-noise");
  const warpMap = document.getElementById("kaii-warp-map");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 実写素材の動画（assets/kaii/）
  const allVideos = Array.from(document.querySelectorAll("video[data-kaii-video]"));
  const omenStatic = omen.querySelector(".kaii-static");
  const ambientStatic = document.querySelector(".kaii-ambient .kaii-static");
  const faceStatic = punish.querySelector(".kp-face .kaii-static");
  const eyeVideo = document.getElementById("kp-eye-video");
  const eyeScene = document.getElementById("kp-eye");
  const eyeGrid = document.getElementById("kp-eye-grid");
  const faceVideo = document.getElementById("kp-face-video");
  const smokeVideo = document.getElementById("kp-smoke-video");
  const sceneVideos = [faceStatic, eyeVideo, faceVideo, smokeVideo];
  let preloaded = false;

  let token = 0;            // cancel() のたびに進める。古い非同期処理は自分の token と比べて打ち切る
  let lastVariant = null;   // 同じ罰演出が2回連続しないようにする
  let pressure = null;      // 段階2の進行状態 { start, totalMs, rafId, beatId }
  let chant = null;         // 再生中の祝詞
  let crawl = null;         // 再生中の這い寄る音
  let dread = null;         // 再生中の不穏な音（赤い目）

  const alive = t => t === token;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

  // 陰陽師の霊の冷気の粒（一度だけ生成）
  (function spawnFrost(){
    const layer = document.getElementById("kp-frost");
    for(let i=0;i<26;i++){
      const p = document.createElement("div");
      p.className = "kp-frost-p";
      p.style.left = (Math.random()*100) + "%";
      p.style.setProperty("--dx", (Math.random()*80 - 40).toFixed(0) + "px");
      p.style.animationDuration = (4 + Math.random()*3) + "s";
      p.style.animationDelay = (-Math.random()*6) + "s";
      layer.appendChild(p);
    }
  })();

  /* ---- 実写素材の動画 ---- */
  // 怪異乱入「あり」でクイズを始めた時に一度だけ読み込んでおき、演出の開始時に止まらないようにする
  function preload(){
    if(preloaded) return;
    preloaded = true;
    allVideos.forEach(v => { v.preload = "auto"; v.load(); });
    // 赤い目のマス目に使う画像も先に読み込んでおく
    ["eye_closed.jpg", "eye_open.jpg"].forEach(name => { new Image().src = "assets/kaii/" + name; });
    // 「呪」の筆文字フォントも先に読み込んでおく（初回表示で別のフォントにならないように）
    if(document.fonts && document.fonts.load) document.fonts.load('100px "Yuji Boku"', "呪").catch(() => {});
  }

  // 頭から再生する。視差効果を減らす設定では再生せず、stillAt秒の1コマを止めて見せる
  function showVideo(v, stillAt = 0){
    if(reduceMotion){
      v.pause();
      try{ v.currentTime = stillAt; }catch(e){}
      return;
    }
    try{ v.currentTime = 0; }catch(e){}
    const p = v.play();
    if(p && p.catch) p.catch(() => {}); // 再生が拒否されても演出自体は続ける
  }

  /* ---- 段階1 → 段階2 ---- */
  async function begin({ limitSec, onReveal, onTimeout }){
    const t = token;
    showTimer(limitSec, 1);
    omen.classList.remove("fade-out");
    omen.classList.add("show");
    showVideo(omenStatic);
    showVideo(ambientStatic);
    // 段階2の赤い背景も予兆の裏で先に出しておき、予兆が消えた時に赤いまま問題が見えるようにする
    app.classList.add("kaii-active");
    SoundEngine.playOmenSfx(OMEN_MS / 1000);
    await wait(OMEN_MS);
    if(!alive(t)) return;

    // 赤い画面のまま問題を表示し、予兆のレイヤーを消していく
    onReveal();
    omen.classList.add("fade-out");
    await wait(OMEN_FADE_MS);
    if(!alive(t)) return;
    omen.classList.remove("show", "fade-out");
    omenStatic.pause();
    startPressure(t, limitSec, onTimeout);
  }

  function showTimer(sec, ratio){
    timerNum.textContent = toKyuNumeral(sec);
    timerFill.style.width = (ratio * 100) + "%";
    timerBox.classList.toggle("danger", sec <= 3);
  }

  function startPressure(t, limitSec, onTimeout){
    const totalMs = limitSec * 1000;
    const start = performance.now();
    let shownSec = null;
    pressure = { start, totalMs, rafId: 0, beatId: 0 };

    const tick = now => {
      if(!pressure || !alive(t)) return;
      const remain = Math.max(0, totalMs - (now - start));
      const sec = Math.ceil(remain / 1000);
      if(sec !== shownSec){
        shownSec = sec;
        showTimer(sec, remain / totalMs);
      } else {
        timerFill.style.width = (remain / totalMs * 100) + "%";
      }
      if(remain <= 0){
        onTimeout();
        return;
      }
      pressure.rafId = requestAnimationFrame(tick);
    };
    pressure.rafId = requestAnimationFrame(tick);

    // 心音：残り時間が減るほど間隔が短くなる（約1.1秒 → 0.38秒）
    const beat = () => {
      if(!pressure || !alive(t)) return;
      SoundEngine.playHeartbeatSfx();
      const ratio = Math.max(0, 1 - (performance.now() - start) / totalMs);
      pressure.beatId = setTimeout(beat, 380 + 720 * ratio);
    };
    beat();
  }

  // 段階2を止め、残り時間（ミリ秒）を返す
  function stopPressure(){
    if(!pressure) return 0;
    cancelAnimationFrame(pressure.rafId);
    clearTimeout(pressure.beatId);
    const remain = Math.max(0, pressure.totalMs - (performance.now() - pressure.start));
    pressure = null;
    return remain;
  }

  function isPressuring(){
    return pressure !== null;
  }

  /* ---- 時間内に正解：光が流れて赤い闇が晴れる ---- */
  function purify(){
    app.classList.remove("kaii-active");
    purifyLayer.classList.remove("run");
    void purifyLayer.offsetWidth; // アニメーションを最初から再生し直すためのリフロー
    purifyLayer.classList.add("run");
  }

  /* ---- 段階3：罰演出 ---- */
  function pickVariant(){
    if(VARIANTS.includes(KAII_DEBUG)) return KAII_DEBUG;
    const candidates = VARIANTS.filter(v => v !== lastVariant);
    const v = candidates[Math.floor(Math.random() * candidates.length)];
    lastVariant = v;
    return v;
  }

  // onEnd：罰演出が消え始めるタイミングで呼ばれる（結果シートを出す）
  async function runPunish(onEnd){
    const t = token;
    app.classList.remove("kaii-active");
    resetScenes();
    punish.dataset.variant = pickVariant();
    punish.classList.remove("fade-out");
    punish.classList.add("show");

    await SCENES[punish.dataset.variant](t);
    if(!alive(t)) return;

    app.classList.add("kaii-residue");
    SoundEngine.setBgmSilenced(false);
    onEnd();
    punish.classList.add("fade-out");
    await wait(PUNISH_FADE_MS);
    if(!alive(t)) return;
    punish.classList.remove("show", "fade-out");
    delete punish.dataset.variant;
    resetScenes();
  }

  // 赤い目：画面の縦横に合わせて、横長（16:9）の目の画像を均等なマス目に敷き詰める
  function buildEyeGrid(){
    const w = window.innerWidth, h = window.innerHeight;
    const cols = Math.max(2, Math.round(w / 140));
    const rows = Math.max(3, Math.round(h / ((w / cols) * 9 / 16)));
    eyeGrid.style.setProperty("--cols", cols);
    eyeGrid.style.setProperty("--rows", rows);
    eyeGrid.textContent = "";
    for(let i = 0; i < cols * rows; i++){
      const cell = document.createElement("div");
      cell.className = "kp-eye-cell";
      eyeGrid.appendChild(cell);
    }
  }

  function resetScenes(){
    eyeScene.dataset.phase = "video";
    eyeGrid.dataset.state = "off";
    eyeGrid.textContent = "";
    sceneVideos.forEach(v => v.pause());
    curseLayer.textContent = "";
    curseScene.dataset.phase = "dark";
    punish.classList.remove("shake");
    sutraLayer.textContent = "";
    onmyojiScene.dataset.phase = "chant";
    warpMap.setAttribute("scale", "0");
    app.classList.remove("kaii-warping");
  }

  const SCENES = {
    // 1. 赤い目
    // ① 目が見開く動画（無音・約2.6秒）
    // → ② 閉じた目が無数に並ぶ（0.5秒）と ③ 黒画面（1.5秒）を、2回目以降は長さを不規則に変えて合計4回。
    //   この間ずっと不穏な音が鳴る（BGMは止める）
    // → ⑤ 黒画面（1秒・音は続く）→ ⑥ 黒画面（0.5秒・音がぷつっと途切れる）→ ⑦ 開いた目が無数に並ぶ（無音・1.5秒）
    // 光への配慮：閉じた目は最短0.2秒、黒画面は最短0.3秒にして、切り替えが1秒に3回を超えないようにしている
    async eye(t){
      showVideo(eyeVideo, 2.4);
      await wait(2600);
      if(!alive(t)) return;

      buildEyeGrid();
      eyeScene.dataset.phase = "grid";
      SoundEngine.setBgmSilenced(true);
      dread = SoundEngine.playDread();
      const cycles = [[500, 1500]];
      for(let i = 1; i < 4; i++) cycles.push([200 + Math.random() * 400, 300 + Math.random() * 1200]);
      for(const [closedMs, blackMs] of cycles){
        eyeGrid.dataset.state = "closed";
        await wait(closedMs);
        if(!alive(t)) return;
        eyeGrid.dataset.state = "off";
        await wait(blackMs);
        if(!alive(t)) return;
      }

      await wait(1000);
      if(!alive(t)) return;
      if(dread){ dread.stop(); dread = null; }
      await wait(500);
      if(!alive(t)) return;

      eyeGrid.dataset.state = "open";
      await wait(1500);
    },

    // 2. 白い女：砂嵐越しに約4秒じっと見つめてきて、最後に金切り声（約5.2秒）
    async face(t){
      showVideo(faceStatic);
      showVideo(faceVideo, 2);
      SoundEngine.playWhisperSfx(4);
      await wait(4000);
      if(!alive(t)) return;
      SoundEngine.playShriekSfx();
      if(!reduceMotion) punish.classList.add("shake");
      await wait(1200);
    },

    // 3. 呪：暗闇・無音（1.5秒）→ 赤い墨の「呪」が加速しながら増えて埋め尽くす（約2.3秒）
    //   → 無音で真っ赤な画面（1秒）→「貴方ノ身体　オ終イ」（3秒）→ 静止画（無音・1秒）
    async curse(t){
      curseScene.dataset.phase = "dark";
      SoundEngine.setBgmSilenced(true);
      await wait(1500);
      if(!alive(t)) return;

      curseScene.dataset.phase = "write";
      const fillMs = 2300;
      const w = window.innerWidth, h = window.innerHeight;
      const count = Math.round(Math.min(240, Math.max(110, w * h / 2500)));
      // 画面が広いほど字も大きくし、PCでも埋め尽くせるようにする
      const sizeScale = Math.min(2.6, Math.max(1, Math.sqrt(w * h / 300000)));
      const start = performance.now();
      let spawned = 0;
      let lastImpact = -Infinity;
      while(alive(t)){
        const now = await nextFrame();
        const elapsed = now - start;
        const p = Math.min(1, elapsed / fillMs);
        // 経過時間の2乗で増やす＝最初はまばら、後半ほど一気に増える
        const target = Math.min(count, Math.floor(count * p * p));
        // 文字が現れるたびに打撃音。後半ほど間隔が詰まり（260ms→70ms）、重くなる
        if(target > spawned && now - lastImpact > 260 - 190 * p){
          SoundEngine.playImpactSfx(0.3 + 0.7 * p);
          lastImpact = now;
        }
        while(spawned < target){
          curseLayer.appendChild(makeCurseGlyph(sizeScale));
          spawned++;
        }
        if(elapsed >= fillMs) break;
      }
      if(!alive(t)) return;

      curseScene.dataset.phase = "red";
      await wait(1000);
      if(!alive(t)) return;

      curseScene.dataset.phase = "message";
      await wait(3000);
      if(!alive(t)) return;

      curseScene.dataset.phase = "still";
      await wait(1000);
    },

    // 4. 陰陽師の霊：祝詞（3秒）→ 歪み（2秒）→ 無音の闇（2秒）→ 般若心経が埋め尽くす（約3秒）→ 黒画面（1.5秒）
    async onmyoji(t){
      showVideo(smokeVideo, 1);
      chant = SoundEngine.playChant(5, 3);
      await wait(3000);
      if(!alive(t)) return;

      onmyojiScene.dataset.phase = "warp";
      if(reduceMotion) await wait(2000); else await runWarp(t, 2000);
      if(!alive(t)) return;

      app.classList.remove("kaii-warping");
      warpMap.setAttribute("scale", "0");
      onmyojiScene.dataset.phase = "void";
      smokeVideo.pause();
      if(chant){ chant.stop(); chant = null; }
      SoundEngine.setBgmSilenced(true);
      await wait(2000);
      if(!alive(t)) return;

      // 般若心経が増えていく間、何かが這い寄る音がだんだん大きくなり、埋め尽くした瞬間に音も画面もぷつっと消える
      onmyojiScene.dataset.phase = "sutra";
      crawl = SoundEngine.playCrawl(3);
      await fillSutra(t, 3000);
      if(!alive(t)) return;
      if(crawl){ crawl.stop(); crawl = null; }
      onmyojiScene.dataset.phase = "void";
      sutraLayer.textContent = "";
      await wait(1500);
    },
  };

  function makeCurseGlyph(sizeScale){
    const s = document.createElement("span");
    s.className = "kp-curse-glyph";
    s.textContent = "呪";
    s.style.left = (Math.random() * 104 - 2) + "%";
    s.style.top = (Math.random() * 104 - 2) + "%";
    s.style.fontSize = Math.round((22 + Math.pow(Math.random(), 1.8) * 140) * sizeScale) + "px";
    s.style.color = CURSE_COLORS[Math.floor(Math.random() * CURSE_COLORS.length)];
    s.style.setProperty("--r", (Math.random() * 60 - 30).toFixed(1) + "deg");
    s.style.setProperty("--ink", (0.72 + Math.random() * 0.28).toFixed(2)); // 墨の濃淡
    return s;
  }

  // SVGフィルタ（feDisplacementMap）の強さを上げていき、画面を波打つように歪ませる
  async function runWarp(t, ms){
    app.classList.add("kaii-warping");
    const start = performance.now();
    while(alive(t)){
      const elapsed = (await nextFrame()) - start;
      const p = Math.min(1, elapsed / ms);
      const s = elapsed / 1000;
      warpMap.setAttribute("scale", (p * p * 90).toFixed(1));
      warpNoise.setAttribute("baseFrequency",
        `${(0.006 + 0.004 * Math.sin(s * 3)).toFixed(4)} ${(0.02 + 0.012 * Math.cos(s * 2.3)).toFixed(4)}`);
      if(p >= 1) break;
    }
  }

  // 般若心経を縦書きで少しずつ書き足し、最後は画面いっぱいにする
  async function fillSutra(t, ms){
    const fontSize = parseFloat(getComputedStyle(sutraLayer).fontSize) || 20;
    const cols = Math.ceil(window.innerWidth / (fontSize * 1.2)) + 1;
    const rows = Math.ceil(window.innerHeight / fontSize) + 1;
    const need = Math.ceil(cols * rows * 1.1);
    const text = HANNYA_SHINGYO.repeat(Math.ceil(need / HANNYA_SHINGYO.length)).slice(0, need);
    const start = performance.now();
    while(alive(t)){
      const p = Math.min(1, ((await nextFrame()) - start) / ms);
      // 序盤はゆっくり、後半ほど一気に増える
      sutraLayer.textContent = text.slice(0, Math.ceil(need * Math.pow(p, 2.2)));
      if(p >= 1) break;
    }
  }

  // 結果シートを閉じた時：罰演出の余韻を消す
  function clearResidue(){
    app.classList.remove("kaii-residue", "kaii-active");
    ambientStatic.pause();
    SoundEngine.setBgmSilenced(false);
  }

  // 途中で抜けた時：進行中の演出・タイマー・音をすべて止める
  function cancel(){
    token++;
    stopPressure();
    allVideos.forEach(v => v.pause());
    if(chant){ chant.stop(); chant = null; }
    if(crawl){ crawl.stop(); crawl = null; }
    if(dread){ dread.stop(); dread = null; }
    omen.classList.remove("show", "fade-out");
    punish.classList.remove("show", "fade-out");
    delete punish.dataset.variant;
    resetScenes();
    app.classList.remove("kaii-active", "kaii-residue");
    SoundEngine.setBgmSilenced(false);
  }

  return { preload, begin, stopPressure, isPressuring, purify, runPunish, clearResidue, cancel };
})();
