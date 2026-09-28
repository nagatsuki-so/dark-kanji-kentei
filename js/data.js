/* ============================================================
   問題データ・正誤判定（data.js）
   ============================================================ */

/* ============================================================
   ① データ：questions/ フォルダの難易度別の3ファイルを実行時に fetch で読み込み、1つにまとめて使う
   同一オリジン（同じサーバー配下）に questions/ を置いておくこと。
   各問題の difficulty（難易度）はファイルに関係なく問題ごとに持たせているので、出題・集計はこれを見る。
   answers は「ゆらぎ吸収」後の比較に使う正解候補の配列
   ============================================================ */
const QUESTION_FILES = ["questions/easy.json", "questions/normal.json", "questions/hard.json"];

let QUESTIONS = [];
let questionsPromise = null;

function fetchQuestionFile(path){
  return fetch(path, { cache: "no-store" })
    .then(res => {
      if(!res.ok) throw new Error(`${path} の取得に失敗しました (HTTP ${res.status})`);
      return res.json();
    })
    .then(data => {
      if(!Array.isArray(data)) throw new Error(`${path} の中身が不正な形式です`);
      return data;
    });
}

function loadQuestions(){
  // 一度取得したPromiseはキャッシュし、ボタン押下時に二重fetchしないようにする
  if(!questionsPromise){
    questionsPromise = Promise.all(QUESTION_FILES.map(fetchQuestionFile))
      .then(lists => {
        const all = lists.flat();
        if(all.length === 0) throw new Error("問題データが空です");
        return all;
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
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    // 全角スペース・半角スペース・タブ類を全除去
    .replace(/[\s　]/g, "")
    .trim()
    .toLowerCase();
}

// 出題文（kanji）の末尾に連続するひらがな（＝送り仮名）を抽出する
function getTrailingOkurigana(kanjiText){
  const hiraganaRe = /[ぁ-ゖゝゞ]/;
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
