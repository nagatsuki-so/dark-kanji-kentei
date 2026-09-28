/* ============================================================
   演出・サウンド（sound.js）
   Web Audio APIで合成。外部音源ファイル不要
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

  // 重低音の衝撃音。"don"＝「ドン」、"zun"＝「ズン」（より低く長く響く）
  // ※現在はどの演出からも使っていない（再び使う可能性があるため残している）
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

  // 白い女：囁き声のようなノイズがだんだん大きくなる（最後は急に途切れる）
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

  /* ---- 通常の効果音 ---- */

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
