const states = {
  start: {
    label: "当天尚未开始 · 到期复习 6 个字",
    note: "用真实短复习组验证：原版只说“一组”，修改版显示真实数量。",
    before: {
      title: ["今天先", "复习一组"],
      stamp: "拾",
      action: "开始练习",
      detail: "按自己的节奏",
      recordLabel: "今日一字",
      record: "daily",
      aria: "原版首页，当天尚未开始，有一组到期复习",
    },
    after: {
      title: ["今天先", "复习六个字"],
      stamp: "拾",
      action: "开始复习",
      detail: "",
      recordLabel: "",
      record: "hidden",
      aria: "增量优化首页，当天尚未开始；下一组是六个到期复习字；开始复习",
    },
    changes: [
      "<b>短组说真实数量：</b>把“复习一组”改为“复习六个字”；普通新组仍保留原题“今天拾十五个字”。",
      "<b>动作只说一次：</b>印章仍是“拾”，下方只保留“开始复习”；数量由标题承担，不再重复解释。",
      "<b>零记录还原留白：</b>“今日一字”暂时离开首屏；当天尚未练习时，记录标题、容器与空提示一并隐藏。",
    ],
  },
  resume: {
    label: "存在未完成组 · 已练 6 / 15 个",
    note: "同一份会话数据：6 个字已经练过，其中 2 个会在本组稍后再出现。",
    before: {
      title: ["今天拾了", "六个字"],
      stamp: "续",
      action: "继续这组",
      detail: "已练 6 / 15 个 · 另有 2 个字要再练",
      recordLabel: "今日拾得",
      record: "tiles",
      aria: "原版首页，存在未完成组，今天拾了六个字",
    },
    after: {
      title: ["上次那组", "练到这里"],
      stamp: "续",
      action: "继续练习",
      detail: "本组 6/15 · 2 个字会再出现",
      recordLabel: "今日练过",
      record: "tiles",
      aria: "增量优化首页，上次那组练到这里；继续练习；本组六个，共十五个；两个字会再出现",
    },
    changes: [
      "<b>状态不制造欠账：</b>标题改为“上次那组 / 练到这里”，既指向同一组，也允许自然停下。",
      "<b>动作与事实各司其职：</b>“续”印下只写“继续练习”；下一行只补本组进度与两个字会再出现。",
      "<b>记录口径纠正：</b>字块、位置和横向浏览方式完全不动，只把“今日拾得”改为“今日练过”。",
    ],
  },
  done: {
    label: "今天已经完成一组 · 练过 13 个不同汉字",
    note: "完成只代表一整组结束，不代表 13 个字全部写对或掌握。",
    before: {
      title: ["今日已拾", "十三个字"],
      stamp: "再",
      action: "再写一组",
      detail: "",
      recordLabel: "今日拾得",
      record: "tiles",
      aria: "原版首页，今日已拾十三个字，可以再写一组",
    },
    after: {
      title: ["今天这组", "已经练完"],
      stamp: "再",
      action: "想继续，再写一组",
      detail: "",
      recordLabel: "今日练过 · 13 个不同的字",
      record: "tiles",
      optional: true,
      aria: "增量优化首页，今天这组已经练完；想继续，再写一组；今天练过十三个不同的汉字",
    },
    changes: [
      "<b>完成事实替代能力暗示：</b>标题改为“今天这组已经练完”，不再把练过数量包装成“已拾”。",
      "<b>可选动作说短：</b>“再”印大小、位置和印文不变；下方只写“想继续，再写一组”，没有操作教程或催练语气。",
      "<b>数量只叫练过：</b>原字块区保持不动，名称改成“今日练过 · 13 个不同的字”，不暗示全部写对。",
    ],
  },
};

const sampleChars = ["尴", "嚏", "植", "眩", "酿", "辨", "裁", "漱", "辙", "撼", "缀", "遣", "瞥"];
let currentState = "start";
let toastTimer = 0;

function mottoMarkup() {
  return `
    <div class="motto" aria-hidden="true">
      <div class="motto-body">
        <span class="motto-line">心不厌精，</span>
        <span class="motto-line">手不忘熟</span>
      </div>
      <span class="motto-source">——孙过庭《书谱》</span>
    </div>`;
}

function recordMarkup(view) {
  if (view.record === "daily") {
    return `
      <button class="daily-word" type="button" data-product-action="daily" aria-label="练习今日一字，眩，眩晕，拼音 xuàn">
        <span class="daily-glyph">眩</span>
        <span class="daily-meta"><b>眩晕</b><small>xuàn</small></span>
        <span class="daily-go">写一遍 ›</span>
      </button>`;
  }
  return `<div class="recent-row" aria-label="今天练过的汉字：${sampleChars.join("、")}">${sampleChars.map((char) => `<span class="char-tile" aria-hidden="true">${char}</span>`).join("")}</div>`;
}

function homeMarkup(view, modified) {
  const titleClass = modified ? "home-main change-zone" : "home-main";
  const startClass = "home-start";
  const recordHeadClass = modified ? "recent-head change-zone" : "recent-head";
  const stampMarkup = modified
    ? `<button class="stamp-control change-zone${view.optional ? " optional" : ""}${view.record === "hidden" ? " reserve-detail" : ""}" data-mark="2" type="button" data-product-action="stamp" aria-label="${view.aria}">
         <span class="stamp-face" aria-hidden="true">${view.stamp}</span>
         <span class="action-copy">${view.action}</span>
         ${view.detail ? `<span class="state-detail">${view.detail}</span>` : ""}
       </button>`
    : `<button class="stamp-only" type="button" data-product-action="stamp" aria-label="${view.action}"><span class="stamp-face" aria-hidden="true">${view.stamp}</span></button>
       <div class="start-cap">${view.action}${view.detail ? ` <span>· ${view.detail}</span>` : ""}</div>`;
  const recordSection = view.record === "hidden"
    ? `<div class="recent-hidden${modified ? " change-zone" : ""}" ${modified ? 'data-mark="3"' : ""} aria-hidden="true"></div>`
    : `<section class="recent" aria-label="${view.recordLabel}">
         <div class="${recordHeadClass}" ${modified ? 'data-mark="3"' : ""}>${view.recordLabel}</div>
         ${recordMarkup(view)}
       </section>`;

  return `
    <div class="safe-top" aria-hidden="true"></div>
    <div class="home-content">
      <div class="home-top">
        <time class="home-date" datetime="2026-09-03">九月三日 · 夜</time>
        ${mottoMarkup()}
      </div>
      <div class="${titleClass}" ${modified ? 'data-mark="1"' : ""}>
        <h1 class="home-title">${view.title[0]}<br>${view.title[1]}</h1>
      </div>
      <div class="${startClass}">${stampMarkup}</div>
      ${recordSection}
    </div>
    <nav class="bottom-nav" aria-label="主要导航">
      <span class="active" aria-current="page">习字</span><span>字库</span><span>我的</span>
    </nav>
    <div class="home-indicator" aria-hidden="true"></div>`;
}

function render() {
  const state = states[currentState];
  const before = document.getElementById("before-home");
  const after = document.getElementById("after-home");
  before.innerHTML = homeMarkup(state.before, false);
  after.innerHTML = homeMarkup(state.after, true);
  before.setAttribute("aria-label", state.before.aria);
  after.setAttribute("aria-label", state.after.aria);
  document.getElementById("state-title").textContent = state.label;
  document.getElementById("state-note").textContent = state.note;
  document.getElementById("change-list").innerHTML = state.changes.map((item) => `<li>${item}</li>`).join("");
  document.title = `拾字首页增量优化 · ${state.label}`;
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("state", currentState);
  try { window.history.replaceState({}, "", url); } catch (_) { /* file:// 预览仍可正常切换 */ }
}

function selectState(next) {
  currentState = next;
  document.querySelectorAll("[data-state]").forEach((button) => {
    const active = button.dataset.state === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateUrl();
  render();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

document.querySelectorAll("[data-state]").forEach((button) => button.addEventListener("click", () => selectState(button.dataset.state)));

document.getElementById("annotation-toggle").addEventListener("click", (event) => {
  const next = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(next));
  document.body.dataset.annotations = String(next);
});

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-product-action]");
  if (action) showToast("对照稿只验证首页表达，不进入练习流程");
});

const requested = new URLSearchParams(window.location.search).get("state");
if (Object.prototype.hasOwnProperty.call(states, requested)) currentState = requested;
selectState(currentState);
