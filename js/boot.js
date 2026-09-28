/* ============================================================
   宵闇漢字解奇譚 - 起動処理（boot.js）
   1. index.html の data-include の位置に、html/ フォルダの各画面の部品を読み込んで差し込む
   2. 差し込み終わってから、下の SCRIPTS を上から順番に読み込む
      （各JSは読み込まれた瞬間に画面の要素を探すため、必ず部品を差し込んだ後に読み込む）
   純粋な Vanilla JavaScript（jQuery等のライブラリは使用していません）
   ============================================================ */
(function boot(){
  // 読み込む順番に意味がある：後のファイルは、前のファイルで定義したもの（SoundEngine・state・el・Kaii など）を使う
  const SCRIPTS = [
    "js/data.js",            // 問題データの読み込み・正誤判定
    "js/sound.js",           // 効果音・BGM（SoundEngine）
    "js/core.js",            // 状態（state）・画面の要素（el）・画面切り替えなど全画面の共通処理
    "js/kaii.js",            // 怪異演出（Kaii）
    "js/screens/quiz.js",    // クイズ画面（出題・解答・結果シート・中断確認）
    "js/screens/result.js",  // 結果画面
    "js/screens/mode.js",    // 出題設定画面
    "js/screens/title.js",   // タイトル画面・読込エラー画面
  ];

  // 部品のHTMLを取得する
  function fetchPart(path){
    return fetch(path, { cache: "no-cache" }).then(res => {
      if(!res.ok) throw new Error(`${path} の取得に失敗しました (HTTP ${res.status})`);
      return res.text();
    });
  }

  // JSを1つ読み込み、実行が終わるまで待つ
  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`${src} の読み込みに失敗しました`));
      document.body.appendChild(s);
    });
  }

  async function start(){
    const slots = Array.from(document.querySelectorAll("[data-include]"));
    const parts = await Promise.all(slots.map(slot => fetchPart(slot.dataset.include)));
    // 差し込み口の <div> を、読み込んだ部品の中身そのものに置き換える
    slots.forEach((slot, i) => {
      const tpl = document.createElement("template");
      tpl.innerHTML = parts[i];
      slot.replaceWith(tpl.content);
    });
    for(const src of SCRIPTS){
      await loadScript(src);
    }
  }

  start().catch(err => {
    console.error(err);
    // 部品を読み込めなかった時（ファイルを直接開いた時など）は、原因が分かるように画面に表示する
    const msg = document.createElement("p");
    msg.style.cssText = "position:relative;z-index:1;margin:40px 20px;text-align:center;line-height:1.8;color:#a89a8a;font-size:13px;";
    msg.textContent = "画面の読み込みに失敗しました。ローカルサーバー経由で開いているか確認してください。（" + err.message + "）";
    document.getElementById("app").appendChild(msg);
  });
})();
