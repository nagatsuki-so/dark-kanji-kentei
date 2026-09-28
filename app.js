/* ============================================================
   宵闇漢字解奇譚 - app.js
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
    // 怪異演出の「無音」区間でBGMだけを消すための段（LFOがbgmGainに掛かっているため別段で絞る）
    const bgmDuck = ctx.createGain();
    bgmDuck.gain.value = 1;
    bgmGain.connect(bgmDuck);
    bgmDuck.connect(masterGain);

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

    bgmNodes = { osc1, osc2, lfo, bgmGain, bgmDuck };
  }

  // BGMの一時停止/再開（陰陽師の霊の「無音」区間用）。停止は即座、再開はゆっくり戻す
  function setBgmSilenced(silent){
    if(!ctx || !bgmNodes) return;
    const now = ctx.currentTime;
    const g = bgmNodes.bgmDuck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if(silent){
      g.setValueAtTime(0, now);
    } else {
      g.linearRampToValueAtTime(1, now + 1.5);
    }
  }

  // 効果音を鳴らせる状態かどうか（ミュート中は鳴らさない）
  function ready(){
    if(muted) return false;
    ensureContext();
    return true;
  }

  // 使い回すホワイトノイズ（2秒分）
  let noiseBuffer = null;
  function noiseSource(){
    if(!noiseBuffer){
      const len = ctx.sampleRate * 2;
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for(let i=0;i<len;i++){ d[i] = Math.random()*2-1; }
    }
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer;
    s.loop = true;
    return s;
  }

  /* ---- 怪異演出用のサウンド ---- */

  // 段階1（予兆）：地鳴りと砂嵐がじわじわ迫ってくる
  function playOmenSfx(dur){
    if(!ready()) return;
    const now = ctx.currentTime;
    const rumble = ctx.createOscillator();
    rumble.type = "sawtooth";
    rumble.frequency.setValueAtTime(42, now);
    rumble.frequency.linearRampToValueAtTime(34, now + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 140;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, now);
    rg.gain.exponentialRampToValueAtTime(0.35, now + dur*0.85);
    rg.gain.setValueAtTime(0.35, now + dur);
    rg.gain.linearRampToValueAtTime(0.0001, now + dur + 0.25);
    rumble.connect(lp); lp.connect(rg); rg.connect(masterGain);
    rumble.start(now); rumble.stop(now + dur + 0.3);

    const n = noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(0.09, now + dur*0.9);
    ng.gain.linearRampToValueAtTime(0.0001, now + dur + 0.2);
    // 矩形波で音量を揺らし、電波が途切れるようなザラつきを出す
    const am = ctx.createOscillator();
    am.type = "square";
    am.frequency.value = 7;
    const amGain = ctx.createGain();
    amGain.gain.value = 0.04;
    am.connect(amGain); amGain.connect(ng.gain);
    n.connect(hp); hp.connect(ng); ng.connect(masterGain);
    n.start(now); n.stop(now + dur + 0.25);
    am.start(now); am.stop(now + dur + 0.25);
  }

  // 段階2：心音（1回分の「ドクン」）
  function playHeartbeatSfx(){
    if(!ready()) return;
    const now = ctx.currentTime;
    [[0, 0.32], [0.16, 0.22]].forEach(([t, peak]) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(70, now + t);
      o.frequency.exponentialRampToValueAtTime(38, now + t + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(peak, now + t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.18);
      o.connect(g); g.connect(masterGain);
      o.start(now + t); o.stop(now + t + 0.2);
    });
  }

  // 音を歪ませる（ザラついた迫力を出す）ための波形整形カーブ。強さごとに使い回す
  const distortionCurves = {};
  function distortion(amount){
    if(!distortionCurves[amount]){
      const n = 1024;
      const curve = new Float32Array(n);
      for(let i=0;i<n;i++){
        const x = i*2/n - 1;
        curve[i] = (1 + amount) * x / (1 + amount * Math.abs(x));
      }
      distortionCurves[amount] = curve;
    }
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurves[amount];
    shaper.oversample = "2x";
    return shaper;
  }

  // 呪：文字が1つ現れるごとの「ドッ」という重い打撃音。strength(0〜1)が大きいほど重く長い
  function playImpactSfx(strength){
    if(!ready()) return;
    const now = ctx.currentTime;
    const s = Math.max(0.1, Math.min(1, strength));
    const bus = ctx.createGain();
    bus.gain.value = 0.5 + s*0.5;
    const shaper = distortion(8);
    bus.connect(shaper); shaper.connect(masterGain);

    // 胴鳴り：ピッチが一気に落ちる低音
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, now);
    o.frequency.exponentialRampToValueAtTime(40, now + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.6, now + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.2 + s*0.3);
    o.connect(og); og.connect(bus);
    o.start(now); o.stop(now + 0.55);

    // 打ち付けた瞬間の衝撃：短く低いノイズ
    const n = noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.4, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    n.connect(lp); lp.connect(ng); ng.connect(bus);
    n.start(now, Math.random()); n.stop(now + 0.1);
  }

  // 重低音の衝撃音。"don"＝呪の最後の「ドン」、"zun"＝赤い目の「ズン」（より低く長く響く）
  function playBoomSfx(kind){
    if(!ready()) return;
    const now = ctx.currentTime;
    const zun = kind === "zun";
    const dur = zun ? 2.8 : 1.8;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const shaper = distortion(zun ? 14 : 10);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = zun ? 700 : 1400;
    bus.connect(shaper); shaper.connect(lp); lp.connect(masterGain);

    // 地響きの芯：深く沈み込む低音
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(zun ? 72 : 96, now);
    sub.frequency.exponentialRampToValueAtTime(zun ? 26 : 34, now + 0.5);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.95, now + 0.008);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    sub.connect(sg); sg.connect(bus);
    sub.start(now); sub.stop(now + dur + 0.05);

    // 厚みを足す1オクターブ上の音（すぐ消える）
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(zun ? 140 : 190, now);
    body.frequency.exponentialRampToValueAtTime(zun ? 50 : 68, now + 0.3);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.5, now);
    bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    body.connect(bg); bg.connect(bus);
    body.start(now); body.stop(now + 0.55);

    // 衝撃のノイズと、尾を引く低いうなり
    const n = noiseSource();
    const nlp = ctx.createBiquadFilter();
    nlp.type = "lowpass";
    nlp.frequency.setValueAtTime(zun ? 500 : 1000, now);
    nlp.frequency.exponentialRampToValueAtTime(90, now + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.7, now);
    ng.gain.exponentialRampToValueAtTime(0.15, now + 0.3);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    n.connect(nlp); nlp.connect(ng); ng.connect(bus);
    n.start(now); n.stop(now + dur + 0.05);
  }

  // 白い女：耳に刺さる金切り声。
  // 高い声を数本重ね、ノイズでピッチを不規則に揺らして（声帯のザラつき）、歪ませる。規則的なビブラートは使わない
  function playShriekSfx(){
    if(!ready()) return;
    const now = ctx.currentTime;
    const dur = 1.5;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.5, now + 0.04);
    out.gain.setValueAtTime(0.5, now + 0.9);
    out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const shaper = distortion(25);
    shaper.connect(out); out.connect(masterGain);

    // 声の響き（高めのフォルマント）
    const formants = [[1400, 1.5, 0.6], [2800, 2.5, 1], [3600, 3, 0.8]].map(([f, q, g]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = g;
      bp.connect(fg); fg.connect(shaper);
      return bp;
    });

    // ピッチの不規則な揺らぎ：低域だけ残したノイズで周波数を揺らす
    const jitter = noiseSource();
    const jlp = ctx.createBiquadFilter();
    jlp.type = "lowpass";
    jlp.frequency.value = 80;
    const jg = ctx.createGain();
    jg.gain.value = 400;
    jitter.connect(jlp); jlp.connect(jg);
    jitter.start(now); jitter.stop(now + dur);

    [1180, 1245, 1570, 2350].forEach(f => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f*0.9, now);
      o.frequency.exponentialRampToValueAtTime(f*1.08, now + 0.25);
      o.frequency.linearRampToValueAtTime(f*0.92, now + dur);
      jg.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.18;
      o.connect(g);
      formants.forEach(bp => g.connect(bp));
      o.start(now); o.stop(now + dur);
    });

    // 息が擦れる高音ノイズ
    const breath = noiseSource();
    const bbp = ctx.createBiquadFilter();
    bbp.type = "bandpass";
    bbp.frequency.value = 4200;
    bbp.Q.value = 1.2;
    const bgain = ctx.createGain();
    bgain.gain.value = 0.25;
    breath.connect(bbp); bbp.connect(bgain); bgain.connect(shaper);
    breath.start(now); breath.stop(now + dur);
  }

  // 白い顔：囁き声のようなノイズがだんだん大きくなる（最後は急に途切れる）
  function playWhisperSfx(dur){
    if(!ready()) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.35, now + dur);
    out.gain.setValueAtTime(0.0001, now + dur + 0.02);
    out.connect(masterGain);
    [2600, 3400, 1900].forEach((fc, i) => {
      const n = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.value = 0;
      // 不規則な「音節」を刻んで、何かを囁いているように聞かせる
      for(let t = 0; t < dur; t += 0.09 + Math.random()*0.16){
        bp.frequency.setValueAtTime(fc * (0.7 + Math.random()*0.6), now + t);
        g.gain.setValueAtTime(0, now + t);
        g.gain.linearRampToValueAtTime(0.3 + Math.random()*0.5, now + t + 0.03);
        g.gain.linearRampToValueAtTime(0.02, now + t + 0.08);
      }
      n.connect(bp); bp.connect(g); g.connect(out);
      n.start(now + i*0.05); n.stop(now + dur + 0.05);
    });
  }

  // 赤い目：無数の目が並ぶ間ずっと鳴り続ける不穏な音。stop()でぷつっと途切れる。
  // 低いうなりを音程をわずかにずらして2本重ねて濁らせ、高い音の不協和なうなりと隙間風のノイズを重ね、
  // 音量をゆっくり揺らして息をしているように聞かせる
  function playDread(){
    if(!ready()) return { stop(){} };
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.9, now + 0.3);
    out.connect(masterGain);

    // 呼吸するような音量の揺れ
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.35;
    const breatheGain = ctx.createGain();
    breatheGain.gain.value = 0.25;
    breathe.connect(breatheGain); breatheGain.connect(out.gain);

    const sources = [breathe];
    // 低いうなり（濁り）
    const lowLp = ctx.createBiquadFilter();
    lowLp.type = "lowpass";
    lowLp.frequency.value = 260;
    lowLp.connect(out);
    [55, 58.3].forEach(f => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      o.connect(g); g.connect(lowLp);
      sources.push(o);
    });
    // 高い音の不協和なうなり（半音ぶつかる2音）
    [1760, 1864].forEach(f => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.025;
      o.connect(g); g.connect(out);
      sources.push(o);
    });
    // 隙間風のようなノイズ
    const wind = noiseSource();
    const windBp = ctx.createBiquadFilter();
    windBp.type = "bandpass";
    windBp.frequency.value = 700;
    windBp.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.12;
    wind.connect(windBp); windBp.connect(windGain); windGain.connect(out);
    sources.push(wind);

    sources.forEach(s => s.start(now));
    return {
      stop(){
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(0, t);
        sources.forEach(s => { try{ s.stop(); }catch(e){} });
      }
    };
  }

  // 陰陽師の霊：何かが床を這い寄ってくる「ズリ…ズリ…」という音。
  // 不規則な間隔で引きずる音を刻み、後半ほど間隔が詰まって大きくなる（クレッシェンド）。dur秒で急に途切れる
  function playCrawl(dur){
    if(!ready()) return { stop(){} };
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.05, now);
    out.gain.exponentialRampToValueAtTime(1.2, now + dur);
    out.gain.setValueAtTime(0, now + dur);
    out.connect(masterGain);

    // 引きずる1回ごとの「ズリッ」
    const n = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
    for(let t = 0; t < dur; ){
      const p = t / dur;
      const len = 0.2 + Math.random()*0.18 - p*0.06;
      const peak = 0.35 + Math.random()*0.25;
      bp.frequency.setValueAtTime(380 + Math.random()*320, now + t);
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.linearRampToValueAtTime(peak, now + t + len*0.3);
      // 引きずっている最中のざらつき：細かく音量を揺らす
      for(let k = 0.3; k < 1; k += 0.08){
        g.gain.setValueAtTime(peak * (0.5 + Math.random()*0.5), now + t + len*k);
      }
      g.gain.linearRampToValueAtTime(0.0001, now + t + len);
      t += len + (0.35 - p*0.28) * (0.6 + Math.random()*0.8);
    }
    n.start(now); n.stop(now + dur + 0.05);

    // 床をこする低いうなり（途切れずに鳴り続ける）
    const rumble = noiseSource();
    const rlp = ctx.createBiquadFilter();
    rlp.type = "lowpass";
    rlp.frequency.value = 140;
    const rg = ctx.createGain();
    rg.gain.value = 0.35;
    rumble.connect(rlp); rlp.connect(rg); rg.connect(out);
    rumble.start(now, Math.random()); rumble.stop(now + dur + 0.05);

    return {
      stop(){
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(0, t);
        try{ n.stop(); rumble.stop(); }catch(e){}
      }
    };
  }

  // 陰陽師の霊：聞き取れない祝詞。
  // 人の声の響き（母音ごとの共鳴＝フォルマント）を持たせた低い声を3声重ね、母音を不規則に変えて唱えさせる。
  // 反響（エコー）は付けない。笛のように聞こえないよう共鳴は緩めにし、声の胴鳴りと息の音で人の声に近づけている。
  // distortAt秒からこもって音程が崩れていき、duration秒で急に途切れる
  function playChant(duration, distortAt){
    if(!ready()) return { stop(){} };
    const now = ctx.currentTime;
    const end = now + duration;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(1.0, now + 0.8);
    out.gain.setValueAtTime(1.0, end - 0.01);
    out.gain.setValueAtTime(0, end);
    out.connect(masterGain);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3000, now);
    lp.frequency.setValueAtTime(3000, now + distortAt);
    lp.frequency.exponentialRampToValueAtTime(350, end);
    lp.connect(out);

    const FORMANTS = { a:[730, 1090], i:[270, 2290], u:[300, 870], e:[530, 1840], o:[570, 840] };
    const vowels = Object.keys(FORMANTS);
    const sources = [];
    // [基本周波数, 唱え始めのずれ]
    [[92, 0], [92*1.008, 0.11], [61.5, 0.05]].forEach(([f0, offset], vi) => {
      const src = ctx.createOscillator();
      src.type = "sawtooth";
      src.frequency.setValueAtTime(f0, now);
      src.detune.setValueAtTime(0, now + distortAt);
      src.detune.linearRampToValueAtTime(-500 - vi*150, end);
      const f1 = ctx.createBiquadFilter();
      f1.type = "bandpass";
      f1.Q.value = 5;
      const f2 = ctx.createBiquadFilter();
      f2.type = "bandpass";
      f2.Q.value = 7;
      // 声の胴鳴り（低い帯域をそのまま少し混ぜる）
      const bodyLp = ctx.createBiquadFilter();
      bodyLp.type = "lowpass";
      bodyLp.frequency.value = 600;
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = 0.35;
      // 息の音
      const breath = noiseSource();
      const breathBp = ctx.createBiquadFilter();
      breathBp.type = "bandpass";
      breathBp.frequency.value = 1200;
      breathBp.Q.value = 0.8;
      const breathGain = ctx.createGain();
      breathGain.gain.value = 0.06;
      const env = ctx.createGain();
      env.gain.value = 0;
      src.connect(f1); src.connect(f2); src.connect(bodyLp);
      bodyLp.connect(bodyGain);
      breath.connect(breathBp); breathBp.connect(breathGain);
      f1.connect(env); f2.connect(env); bodyGain.connect(env); breathGain.connect(env);
      env.connect(lp);

      for(let t = now + offset; t < end; ){
        const len = 0.16 + Math.random()*0.22;
        const [a, b] = FORMANTS[vowels[Math.floor(Math.random()*vowels.length)]];
        f1.frequency.setTargetAtTime(a, t, 0.03);
        f2.frequency.setTargetAtTime(b, t, 0.03);
        env.gain.setTargetAtTime(0.8 + Math.random()*0.4, t, 0.02);
        env.gain.setTargetAtTime(0.2, t + len*0.7, 0.04);
        // 句の切れ目で音程を少し落とし、唱えている抑揚を出す
        src.frequency.setTargetAtTime(Math.random() < 0.12 ? f0*0.89 : f0, t, 0.05);
        t += len;
      }
      src.start(now); src.stop(end + 0.05);
      breath.start(now, Math.random()); breath.stop(end + 0.05);
      sources.push(src, breath);
    });

    return {
      stop(){
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(0, t);
        sources.forEach(s => { try{ s.stop(); }catch(e){} });
      }
    };
  }

  // 時間内に正解：柏手（二拍）と澄んだ鈴
  function playPurifySfx(){
    if(!ready()) return;
    const now = ctx.currentTime;
    [0, 0.3].forEach(t => {
      const n = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1300;
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.5, now + t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.09);
      n.connect(bp); bp.connect(g); g.connect(masterGain);
      n.start(now + t, Math.random()); n.stop(now + t + 0.1);
    });
    [0.62, 0.74, 0.88].forEach((t, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 1320 + i*330;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.14, now + t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 1.2);
      o.connect(g); g.connect(masterGain);
      o.start(now + t); o.stop(now + t + 1.25);
    });
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
    setBgmSilenced, playOmenSfx, playHeartbeatSfx, playImpactSfx, playBoomSfx,
    playShriekSfx, playWhisperSfx, playDread, playCrawl, playChant, playPurifySfx,
    get muted(){ return muted; },
    get isUnlocked(){ return !!bgmNodes; }
  };
})();

/* ============================================================
   ⑥ 怪異演出（SPEC 2.1）
   段階1：予兆 → 段階2：制限時間つきの継続演出 → 段階3：罰（誤答・時間切れ時のみ）
   途中でホームへ戻った時などは cancel() で token を進め、進行中の非同期処理をすべて打ち切る
   ============================================================ */
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
    // 1. 赤い目：闇に浮かぶ赤い目だけが見開き、その瞬間に「ズン」（約2.6秒）
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

    // 4. 陰陽師の霊：祝詞（3秒）→ 歪み（2秒）→ 無音の闇（2秒）→ 般若心経が埋め尽くす（無音・約3.7秒）
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

/* ============================================================
   ④⑤ 画面制御・出題ロジック
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

// 動作確認用：URLに ?kaii=eye|face|curse|onmyoji|all を付けると、怪異乱入「あり」の時に
// 全問題で怪異演出が発生し、罰演出の種類も固定される（all はランダム）
const KAII_DEBUG = new URLSearchParams(location.search).get("kaii");

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

/* ---- 出題設定：各項目の説明モーダル ---- */
const infoOverlay = document.getElementById("info-overlay");
document.getElementById("btn-mode-info").addEventListener("click", () => {
  SoundEngine.playTapSfx();
  infoOverlay.classList.add("show");
});
document.getElementById("btn-info-close").addEventListener("click", () => {
  SoundEngine.playTapSfx();
  infoOverlay.classList.remove("show");
});

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
    applyQuestionStatsToUI();
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

/* ---- 出題設定画面：4つの選択グループ配線 ---- */
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

function updateKaiiRateSub(){
  if(!questionStats) return;
  document.getElementById("kaii-rate-sub").textContent = `発生確率：${pct(questionStats.byDiff[state.difficulty].kaiiRate)}%`;
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

/* ---- タイトル「宵闇漢字解奇譚」の「解」が、不規則に一瞬だけ「怪」に入れ替わる演出 ----
   2〜6秒のランダムな間隔で約0.3秒だけ入れ替え、ときどき2回続けてチラつかせる。
   光への配慮として1秒に3回を超えないようにし、視差効果を減らす設定では行わない。
   タイトル画面を表示している間だけ動かす */
(function titleSubliminal(){
  const span = document.getElementById("title-flicker");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(!span || reduceMotion) return;

  const FLASH_MS = 300;
  // 「怪」は普段画面に出ないため、初めてのチラつきで明朝体にならないよう筆文字フォントを先読みしておく
  if(document.fonts && document.fonts.load) document.fonts.load('42px "Yuji Syuku"', "怪").catch(() => {});

  function flash(){
    span.textContent = "怪";
    span.classList.add("is-kai");
    setTimeout(() => {
      span.textContent = "解";
      span.classList.remove("is-kai");
    }, FLASH_MS);
  }

  function schedule(){
    setTimeout(() => {
      if(el.screens.title.classList.contains("active") && !document.hidden){
        flash();
        // 3割の確率でもう一度（1回目が消えた0.3秒後＝開始から0.6秒後。1秒に3回は超えない）
        if(Math.random() < 0.3) setTimeout(flash, 600);
      }
      schedule();
    }, 2000 + Math.random() * 4000);
  }
  schedule();
})();

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
