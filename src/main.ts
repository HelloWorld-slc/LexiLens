import "./style.css";
import { platform, native, type Loaded, type ModelResult } from "./platform";
import { payloadFor, type Task } from "./model";
import {
  decodeJson,
  readableSummary,
  dateName,
  selectionKey,
  firstExplanation,
  compactMeaning,
  newLibrary,
  newProject,
  uid,
  now,
  paragraph,
  currentText,
  editParagraph,
  expandWords,
  sentenceRange,
  anchorFor,
  resolveAnchor,
  saveFavorite,
  reviewBatch,
  purgeProject,
  expireTrash,
  parseOutput,
  cacheKey,
  SelectionController,
  importAsCopy,
  splitParagraph,
  validateCitations,
  RequestScope,
} from "./core.mjs";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let lib: any = newLibrary(),
  revision = 0,
  libraryPath = "",
  view = "home",
  projectId: string | null = null,
  articleId: string | null = null;
let panel = "explain",
  selected: any = null,
  activeResult: any = null,
  showPanel = false,
  showSource = false,
  filter = "",
  collapsed = new Set<string>();
let saveChain = Promise.resolve(),
  saveError = "",
  status = "",
  requestBusy = false,
  ocrBusy = false,
  ocrQueueBusy = false,
  cardIds: string[] = [],
  cardIndex = 0,
  flipped = false,
  cardMode = "en",
  hideSentence = false,
  batchSize = 10,
  bookList = false;
const requests = new RequestScope();
const summaryRequests = new RequestScope();
let queryState = "",
  queryToken = 0,
  importProgress = "",
  importBusy = false;
let summaryBusy: string | null = null;
const loading = (text: string) =>
  `<div class="loading-state" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${escape(text)}</span></div>`;
const storageHint = /Android/i.test(navigator.userAgent)
  ? "Android 安装包目录只读，此选项使用应用内部资料目录。卸载会清除资料，请先导出完整备份。"
  : "资料保存在程序所在目录的 LexiLensData 文件夹。安装目录需可写。";

function stopRequests() {
  controller.cancel();
  requests.cancel();
  requestBusy = false;
  queryState = "";
  queryToken++;
}
const getProject = () => lib.projects.find((p: any) => p.id === projectId);
const getArticle = () =>
  getProject()?.articles.find((a: any) => a.id === articleId);
function toast(text: string) {
  status = text;
  const el = $("#toast");
  if (el) {
    el.textContent = text;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 4200);
  }
}
function showError(e: unknown) {
  toast(String(e instanceof Error ? e.message : e));
}
async function commit() {
  if (!libraryPath) throw Error("请先选择资料目录");
  const snapshot = JSON.stringify(lib);
  const job = saveChain
    .catch(() => {})
    .then(async () => {
      try {
        revision = await platform.save(snapshot, revision);
        saveError = "";
        $("#save-status")?.replaceChildren(
          document.createTextNode("已保存到本机"),
        );
      } catch (e) {
        saveError = String(e);
        $("#save-status")?.replaceChildren(
          document.createTextNode("未保存 · 保留当前窗口，可导出草稿"),
        );
        throw e;
      }
    });
  saveChain = job;
  return job;
}
async function load(result: Loaded | null) {
  if (!result) return;
  libraryPath = result.path;
  revision = result.revision;
  lib = result.data ? JSON.parse(result.data) : newLibrary();
  expireTrash(lib);
  await commit();
  projectId = lib.lastProject;
  const p = getProject();
  if (p && !p.deletedAt) {
    articleId = p.lastArticle ?? p.articles[0]?.id;
    view = "reader";
    if (
      p.lastSelection?.articleId === articleId &&
      resolveAnchor(lib, p.lastSelection).status === "valid"
    ) {
      selected = p.lastSelection;
      showPanel = true;
      activeResult = firstExplanation(lib, selected, lib.settings.model);
    }
  } else view = "home";
  render();
}
function btn(action: string, text: string, extra = "") {
  return `<button type="button" data-action="${action}" ${extra}>${text}</button>`;
}
function favorites(global = false) {
  return lib.favorites.filter(
    (f: any) =>
      (global || f.anchor.projectId === projectId) &&
      (!filter ||
        `${f.original} ${f.lemma} ${f.meaning} ${f.anchor.projectTitle}`
          .toLowerCase()
          .includes(filter.toLowerCase())),
  );
}
const toolbarItems = [
  ["explain", "解释"],
  ["favorite", "收藏"],
  ["cancel", "取消"],
  ["sentence", "整句"],
  ["speak", "发音"],
  ["summary", "总结"],
  ["project-summary", "项目总结"],
  ["pages", "上传"],
  ["saved-summaries", "已存总结"],
  ["multi-analysis", "多段分析"],
  ["settings", "设置"],
  ["backup", "备份"],
  ["home", "首页"],
  ["select-help", "划词帮助"],
];
const alwaysInMore = new Set(["saved-summaries", "settings", "backup"]);
const toolIcons: Record<string, string> = {
  explain:
    '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Z"/><path d="M8 8h9M8 12h6"/>',
  favorite:
    '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
  sentence: '<path d="M4 5h16M4 10h12M4 15h16M4 20h9"/>',
  speak:
    '<path d="M4 9h4l5-4v14l-5-4H4Z M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
  summary: '<path d="M6 3h9l4 4v14H6Z M14 3v5h5M9 12h7M9 16h5"/>',
  "project-summary":
    '<path d="M7 3h12v15H7Z M4 7v14h12M10 7h6M10 11h6M10 15h4"/>',
  pages: '<path d="M4 15v5h16v-5M12 16V3m-5 5 5-5 5 5"/>',
  "saved-summaries": '<path d="M5 3h14v18H5ZM8 7h8M8 11h8m-7 5 2 2 4-4"/>',
  "multi-analysis":
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><path d="M6 13v4h12v-4M12 17v4"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  backup: '<path d="M4 9h16v12H4ZM3 4h18v5H3ZM9 14h6"/>',
  home: '<path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/>',
  "select-help": '<path d="m5 3 14 9-7 1-3 7Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
function toolButton(action: string, label: string, menu = false) {
  return btn(
    action,
    `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${toolIcons[action] || toolIcons.more}</svg><span class="${menu ? "menu-tool-label" : "tool-label"}">${escape(label)}</span>`,
    `class="${menu ? "menu-tool" : "icon-tool"}" aria-label="${escape(label)}" title="${escape(label)}"`,
  );
}
let hiddenTools = new Set<string>();
function resizeToolbar() {
  const host = $("#toolbar-actions"),
    bar = $(".toolbar");
  if (!host || !bar || bar.hidden) return;
  host.innerHTML = toolbarItems
    .filter(([action]) => !alwaysInMore.has(action))
    .map(([action, title]) => toolButton(action, title))
    .join("");
  const more = $<HTMLButtonElement>('.toolbar [data-action="more"]');
  more.hidden = false;
  bar.style.width = `${Math.min(1400, window.innerWidth - 28)}px`;
  const caption = $("#selection-caption");
  caption.hidden = window.innerWidth < 900;
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  const widths = buttons.map((b) => b.getBoundingClientRect().width + 5);
  const space = bar.clientWidth - 24 - (caption.hidden ? 0 : 160);
  const available = space - more.offsetWidth - 5;
  let used = 0;
  hiddenTools = new Set(alwaysInMore);
  buttons.forEach((b, i) => {
    if (used + widths[i] > available) {
      b.hidden = true;
      hiddenTools.add(b.dataset.action!);
    } else used += widths[i];
  });
  more.hidden = hiddenTools.size === 0;
  bar.style.width = "fit-content";
  updateSummaryButtons();
}
window.addEventListener("resize", resizeToolbar);
document.fonts.ready.then(resizeToolbar);
function updateSummaryButtons() {
  document
    .querySelectorAll<HTMLButtonElement>(
      '[data-action="summary"], [data-action="article-summary"], [data-action="project-summary"]',
    )
    .forEach((b) => {
      b.disabled = !!summaryBusy;
      b.title = summaryBusy
        ? "总结正在生成，请稍候"
        : "正文未变时复用已保存总结";
    });
}
function summaryLoading() {
  dialog(
    "正在生成总结",
    `${loading("正在阅读正文并整理带原句引用的总结…")}<p>结果会保存在左侧项目的“总结与分析”。可以关闭此窗口继续阅读；请勿重复申请。</p>${btn("cancel-summary", "取消生成")}`,
  );
  $("#dialog").dataset.summaryLoading = "true";
  updateSummaryButtons();
}
function savedSummaries(projectWide = false) {
  const rs = lib.results.filter(
    (r: any) =>
      ["summary", "project-summary", "analysis"].includes(r.task) &&
      (projectWide ? r.projectId === projectId : r.articleId === articleId),
  );
  dialog(
    "已保存的总结 / 分析",
    `${summaryBusy ? loading("有一篇总结正在生成…") : ""}${rs.map((r: any) => `<section><h3>${escape(r.task === "project-summary" ? "项目全部总结" : getProject()?.articles.find((a: any) => a.id === r.articleId)?.title || "文章")}</h3><p>${escape(new Date(r.created).toLocaleString())} · ${r.data ? "已校验引用" : "原稿待核对"}</p>${btn("open-saved-summary", "查看", `data-id="${r.id}"`)}</section>`).join("") || "<p>还没有总结。打开文章后点击“生成总结”，结果会留在这里。</p>"}`,
  );
}
let guideShown = false;
async function maybeGuide() {
  if (!native || guideShown) return;
  if (!(await platform.hasKey())) {
    guideShown = true;
    apiGuide();
  }
}
function apiGuide() {
  dialog(
    "开始之前 · 配置个人 API",
    `<p>填入个人 DeepSeek API Key 后，即可识别图片和查询词句。已有资料可以离线阅读。</p><form id="api-form"><label>DeepSeek API Key<input id="guide-key" type="password" autocomplete="off" required placeholder="sk-…"></label><p class="muted">仅在本机系统加密保存，用于 DeepSeek 官方接口鉴权，不写入资料库、备份或项目代码。</p><div class="row"><button class="primary">保存并继续</button>${btn("close-dialog", "稍后配置")}</div><p id="guide-status" role="status"></p></form>`,
  );
  $("#api-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("#guide-key"),
      button = $<HTMLButtonElement>(
        '#api-form button[type="submit"], #api-form button.primary',
      );
    button.disabled = true;
    try {
      await platform.setKey(input.value.trim());
      input.value = "";
      $<HTMLDialogElement>("#dialog").close();
      toast("API Key 已在本机加密保存");
    } catch (e) {
      $("#guide-status").textContent = String(e);
    } finally {
      button.disabled = false;
    }
  };
}
let dragDepth = 0;
function clearDrop() {
  dragDepth = 0;
  $("#drop-overlay")?.remove();
}
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  dragDepth++;
  if (!$("#drop-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "drop-overlay";
    overlay.setAttribute("role", "status");
    overlay.innerHTML = `<div><span>＋</span><h2>松手添加图片</h2><p>${libraryPath ? (getProject() && view !== "home" ? `添加到「${escape(getProject().title)}」` : "自动新建日期项目") : "请先选择资料保存位置"}</p><small>支持 JPG / PNG · 按文件顺序添加</small></div>`;
    document.body.append(overlay);
  }
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget || --dragDepth <= 0) clearDrop();
});
document.addEventListener("drop", (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  clearDrop();
  importFiles([...e.dataTransfer.files]).catch(showError);
});
window.addEventListener("blur", clearDrop);
document.addEventListener("contextmenu", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-project-row]",
  );
  if (!row) return;
  e.preventDefault();
  dialog(
    "项目快捷访问",
    `<p>关闭后仍可从项目首页重新打开。</p>${btn("close-project", "关闭快捷访问", `data-id="${row.dataset.projectRow}"`)}`,
  );
});
function layout() {
  return `<header><button class="brand" data-action="home"><span class="logo">L</span>LexiLens</button><span class="breadcrumb">${escape(getProject()?.title || "我的学习资料")}</span><div class="row">${btn("navigation", "目录", 'class="mobile-only"')}${btn("theme", "◐", 'aria-label="切换深浅主题"')}${btn("settings", "设置")}</div></header><div class="workspace"><nav aria-label="主导航">${btn("home", "▦　项目首页", view === "home" ? 'class="current"' : "")}${btn("global", "▱　全局生词本", view === "global" ? 'class="current"' : "")}${btn("new-project", "＋　新项目")}<div class="nav-projects">${lib.projects
    .filter((p: any) => !p.deletedAt && !p.quickAccessClosed)
    .map(
      (p: any) =>
        `<div class="project-nav-row" data-project-row="${p.id}"><button class="project-nav" data-action="collapse" data-id="${p.id}" aria-expanded="${!collapsed.has(p.id)}">${collapsed.has(p.id) ? "▸" : "▾"} ${escape(p.title)}</button>${btn("close-project", "×", `data-id="${p.id}" class="close-project" aria-label="关闭快捷访问" title="关闭快捷访问，资料仍保留在首页"`)}</div><div class="project-links ${collapsed.has(p.id) ? "collapsed" : ""}" ${collapsed.has(p.id) ? "inert" : ""}><div>${btn("open-project", "精读", `data-id="${p.id}"`)}${btn("project-book", "项目生词本", `data-id="${p.id}"`)}${btn("project-pages", "上传与页面", `data-id="${p.id}"`)}${btn("project-sections", "非文章部分", `data-id="${p.id}"`)}${btn("project-summaries", "总结与分析", `data-id="${p.id}"`)}${p.articles.map((a: any, i: number) => btn("article", `${String(i + 1).padStart(2, "0")}　${escape(a.title)}`, `data-project="${p.id}" data-id="${a.id}"`)).join("")}</div></div>`,
    )
    .join(
      "",
    )}</div><div class="nav-foot">${btn("trash", "回收站")}${btn("backup", "备份与迁移")}<small id="save-status">${!native ? "网页检查模式 · 不保存" : saveError ? "未保存" : libraryPath ? "本机资料" : "尚未选择资料目录"}</small></div></nav><main id="main-view" tabindex="0"></main><aside class="inspector ${showPanel && ["reader", "sections"].includes(view) ? "open" : ""}" ${showPanel && ["reader", "sections"].includes(view) ? "" : "inert"} aria-label="伴读面板"><div class="panel-head"><div class="row">${btn("explain-panel", "解释", panel === "explain" ? 'class="active"' : "")}${btn("book-panel", "生词本", panel === "book" ? 'class="active"' : "")}</div>${btn("close-panel", "×", 'aria-label="收起面板"')}</div><div id="panel-content"></div></aside></div><footer class="toolbar" ${["reader", "sections"].includes(view) ? "" : "hidden"}><div id="toolbar-actions"></div>${toolButton("more", "更多")}<span id="selection-caption">${escape(selected?.quote || "点选一个单词开始")}</span></footer><div id="toast" role="status" aria-live="polite"></div><dialog id="dialog"></dialog>`;
}
function render() {
  const oldScroll = $("#main-view")?.scrollTop ?? 0;
  document.documentElement.dataset.theme = lib.settings.theme;
  document.documentElement.style.setProperty(
    "--reading-size",
    `${lib.settings.fontSize}px`,
  );
  document.documentElement.style.setProperty(
    "--reading-line",
    String(lib.settings.lineHeight),
  );
  document.documentElement.style.setProperty(
    "--reading-width",
    `${lib.settings.width}px`,
  );
  $("#app").innerHTML = layout();
  resizeToolbar();
  const main = $("#main-view");
  if (!libraryPath) {
    main.innerHTML = `<section class="welcome"><p class="eyebrow">YOUR WORDS. YOUR CONTEXT.</p><h1>从一页文字，<br>读得更深一点。</h1><p>把材料、语境和每一次理解，留在自己的设备里。</p>${btn("choose-library", "选择本机资料目录", 'class="primary"')}<div class="storage-option">${btn("install-library", "存储到安装位置")}<small>${storageHint}</small></div>${btn("api-guide", "配置 DeepSeek API")}<p class="muted">${native ? "首次使用选择资料保存位置。已有资料可离线阅读。" : "此页仅供界面检查。实际保存、图像导入与模型请求需要运行安装版。"}</p></section>`;
    return;
  }
  if (view === "home") renderHome();
  else if (view === "global") {
    main.innerHTML = `<section class="page"><p class="eyebrow">VOCABULARY</p><h1>全局生词本</h1><p class="muted">一个词，保留每一次相遇的语境。</p><div id="global-book"></div></section>`;
    renderBook($("#global-book"), true);
  } else if (view === "trash") renderTrash();
  else if (view === "sections") renderNonArticles();
  else renderReader();
  if (["reader", "sections"].includes(view)) {
    $("#main-view").scrollTop = oldScroll || getProject()?.scroll || 0;
    renderPanel();
    bindSelection();
    $("#main-view").addEventListener("scroll", onScroll, { passive: true });
  }
  updateSummaryButtons();
}
function renderHome() {
  const projects = lib.projects
    .filter(
      (p: any) =>
        !p.deletedAt &&
        (!filter || p.title.toLowerCase().includes(filter.toLowerCase())),
    )
    .sort((a: any, b: any) => b.updated.localeCompare(a.updated));
  $("#main-view").innerHTML =
    `<section class="page"><p class="eyebrow">MY LIBRARY</p><div class="row spread"><div><h1>继续你的阅读</h1><p class="muted">每篇材料，都有自己的积累。</p></div>${btn("new-project", "＋ 新项目", 'class="primary"')}</div><input id="search" aria-label="搜索项目" placeholder="搜索项目…" value="${escape(filter)}"><div class="project-grid">${projects.map((p: any) => `<article class="project-card"><button class="project-cover" data-action="open-project" data-id="${p.id}">${p.pages[0] ? `<img data-asset="${p.pages[0].original.id}" alt="${escape(p.title)}封面">` : "<span>Aa</span>"}</button><div class="card-body"><button class="title-button" data-action="open-project" data-id="${p.id}">${escape(p.title)}</button><p class="muted">${p.pages.length} 页 · ${p.articles.length} 篇 ${p.archived ? "· 已归档" : ""}</p><div class="row">${btn("rename", "重命名", `data-id="${p.id}"`)}${btn("archive", p.archived ? "取消归档" : "归档", `data-id="${p.id}"`)}${btn("delete-project", "删除", `data-id="${p.id}"`)}</div></div></article>`).join("") || '<div class="empty"><h2>第一份材料，从这里开始</h2><p>新建项目后导入图片。原图始终保留。</p></div>'}</div></section>`;
  bindSearch();
  loadImages();
}
function renderReader() {
  const p = getProject(),
    a = getArticle();
  if (!p) {
    view = "home";
    render();
    return;
  }
  $("#main-view").innerHTML =
    `<div class="reader-head"><div><p class="eyebrow">${escape(p.title)}</p><h1>${escape(a?.title || "导入你的阅读材料")}</h1></div><div class="row wrap">${btn("import", "导入图片")}${btn("pages", "上传与页面")}${btn("project-sections", "非文章部分", `data-id="${p.id}"`)}${btn("source", "原图", 'aria-pressed="' + showSource + '"')}${btn("book-panel", "生词本")}</div></div>${
      a
        ? `<article class="reading" data-article="${a.id}">${a.paragraphs
            .filter((p: any) => p.kind === "body")
            .map((p: any, i: number) => paragraphHtml(p, i))
            .join(
              "",
            )}</article><div class="reading-end">${btn("edit-article", "文章组织")}${btn("article-summary", "生成当前文章总结")}${btn("project-summary", "项目全部总结")}${btn("export-article", "导出文章")}</div>`
        : `<div class="empty"><span class="empty-symbol">Aa</span><h2>文字开始之前，先放入原图</h2><p>支持 JPG / PNG，也可粘贴或拖入截图。</p>${btn("import", "导入图片", 'class="primary"')}<p class="muted">默认使用原图。识别与解题始终分开。</p></div>`
    }`;
}
function renderNonArticles() {
  const project = getProject();
  if (!project) {
    view = "home";
    renderHome();
    return;
  }
  const groups = new Map<string, { article: any; block: any }[]>();
  for (const article of project.articles)
    for (const block of article.paragraphs.filter(
      (x: any) => x.kind !== "body",
    )) {
      const name =
        block.sectionName ||
        (
          {
            question: "题目区",
            table: "表格区",
            caption: "图注区",
            introduction: "介绍区",
            vocabulary: "生词积累区",
          } as Record<string, string>
        )[block.kind] ||
        "其它资料";
      groups.set(name, [...(groups.get(name) || []), { article, block }]);
    }
  $("#main-view").innerHTML =
    `<section class="page non-articles"><p class="eyebrow">${escape(project.title)}</p><h1>非文章部分</h1><p class="muted">介绍、题目与词汇等内容集中在这里。各区默认折叠，保留文章和页面来源。</p>${[...groups].map(([name, blocks]) => `<details class="questions"><summary>${escape(name)} · ${blocks.length} 个内容块</summary>${blocks.map(({ article, block }) => `<section class="section-block"><p class="muted">${escape(article.title)} · ${escape(project.pages.find((p: any) => p.id === block.pageId)?.name || "文字资料")}</p>${block.kind === "question" ? `<label><input type="checkbox" class="verified-questions" data-article="${article.id}" ${article.questionsVerified ? "checked" : ""}>已核对题型与文章归属</label>` : ""}${btn("edit-paragraph", "编辑", `data-id="${block.id}" data-article="${article.id}"`)}<p class="paragraph" data-paragraph="${block.id}" data-owner="${article.id}">${escape(currentText(block))}</p></section>`).join("")}</details>`).join("") || '<div class="empty">当前项目没有非正文内容。</div>'}</section>`;
}
function highlightedSentence(a: any) {
  const start = a.start - a.sentence.start,
    end = a.end - a.sentence.start;
  return (
    escape(a.sentence.quote.slice(0, start)) +
    `<mark>${escape(a.sentence.quote.slice(start, end))}</mark>` +
    escape(a.sentence.quote.slice(end))
  );
}
function paragraphHtml(p: any, i: number) {
  return `<section class="paragraph-wrap"><div class="paragraph-meta">${lib.settings.showNumbers ? `<span>${String(i + 1).padStart(2, "0")}</span>` : ""}${p.uncertain ? '<span class="warning">需核对</span>' : ""}${btn("edit-paragraph", "编辑", `data-id="${p.id}"`)}</div><p class="paragraph" data-paragraph="${p.id}">${escape(currentText(p))}</p></section>`;
}
function renderPanel() {
  const el = $("#panel-content");
  if (!el) return;
  if (panel === "book") {
    renderBook(el, false);
    return;
  }
  el.innerHTML = `${showSource && getProject()?.pages.length ? `<div class="source-preview"><img data-asset="${getProject().pages.find((p: any) => p.id === resolveAnchor(lib, selected ?? {}).paragraph?.pageId)?.original.id ?? getProject().pages[0].original.id}" alt="原图对照"></div>` : ""}${selected ? `<p class="eyebrow">IN CONTEXT</p><div class="word-heading"><h2 class="selected-word">${escape(selected.quote)}</h2>${btn("speak", "▷", 'class="pronounce" aria-label="朗读选中词句" title="朗读选中词句"')}</div><p class="compact-meaning">${escape(compactMeaning(firstExplanation(lib, selected, lib.settings.model)?.data || activeResult?.data))}</p><blockquote>${highlightedSentence(selected)}${btn("speak-sentence", "▷ 原句发音", 'class="sentence-speak"')}</blockquote><div id="explanation">${queryState ? loading(queryState) : ""}${activeResult ? resultHtml(activeResult) : `<p class="muted">${queryState ? "查询完成后自动显示，重复点选不会重复请求。" : "点击解释后查询"}</p>`}</div><div class="row wrap">${btn("favorite", lib.favorites.some((f: any) => f.key === JSON.stringify([selected.projectId, selected.paragraphId, selected.versionId, selected.start, selected.end])) ? "已收藏" : "收藏", 'class="primary"')}${btn("speak", "发音")}${btn("structure", "句子结构")}${btn("refresh", "刷新")}${btn("edit-meaning", "改释义")}${getArticle()?.questionsVerified ? btn("answer", "题目解释 / 解答") : ""}</div><div class="followup"><label for="followup">围绕这个词句继续问</label><textarea id="followup" placeholder="例如：这里为什么使用这个时态？"></textarea>${btn("followup", "发送追问")}</div>` : '<div class="empty"><h2>让每个词回到语境里</h2><p>点一下单词，或拖选短语与句子。</p><p class="muted">默认延时自动解释，底部可随时取消。</p></div>'}`;
  loadImages();
}
function resultHtml(result: any) {
  return `<div class="meaning"><p>${escape(result.userMeaning ?? result.data?.meaning_zh ?? result.error ?? "结果待核对")}</p>${result.data?.pos ? `<small>${escape(result.data.pos)}</small>` : ""}${result.data?.structure?.length ? `<ul>${result.data.structure.map((x: any) => `<li>${escape(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>` : ""}${result.raw ? `<details><summary>查看 AI 原稿</summary><pre>${escape(result.raw)}</pre></details>` : ""}</div>`;
}
function renderBook(el: HTMLElement, global: boolean) {
  const fs = favorites(global);
  if (!cardIds.length) cardIds = reviewBatch(fs, batchSize);
  const f = fs.find((f: any) => f.id === cardIds[cardIndex]);
  el.innerHTML = `<div class="book"><div class="row wrap"><input id="search" aria-label="搜索词句" placeholder="词形、释义或来源…" value="${escape(filter)}">${btn("book-view", bookList ? "卡片" : "列表")}${btn("export-book", "导出")}</div><div class="row wrap"><select id="card-mode" aria-label="卡片语言"><option value="en" ${cardMode === "en" ? "selected" : ""}>英文 → 中文</option><option value="zh" ${cardMode === "zh" ? "selected" : ""}>中文 → 英文</option><option value="both" ${cardMode === "both" ? "selected" : ""}>双语同显</option></select><label><input id="hide-sentence" type="checkbox" ${hideSentence ? "checked" : ""}>隐藏原句</label><select id="batch-size" aria-label="每轮数量"><option ${batchSize === 10 ? "selected" : ""}>10</option><option ${batchSize === 20 ? "selected" : ""}>20</option></select></div>${bookList ? groupBook(fs) : !fs.length ? '<div class="empty">还没有收藏。阅读时一键保存到这里。</div>' : !f ? `<div class="empty"><h2>这一轮完成了</h2><p>下一轮会优先未掌握与最近收藏。</p>${btn("next-round", "开始下一轮")}</div>` : `<p class="muted">${cardIndex + 1} / ${cardIds.length}</p><button class="vocab-card ${flipped ? "flipped" : ""}" data-action="flip" aria-label="翻转词句卡片"><span class="card-inner"><span class="card-front">${cardMode === "zh" ? escape(f.meaning) : escape(f.original)}${cardMode === "both" ? `<small>${escape(f.meaning)}</small>` : ""}</span><span class="card-back">${cardMode === "zh" ? escape(f.original) : escape(f.meaning)}</span></span></button>${!hideSentence ? `<blockquote>${escape(f.anchor.sentence.quote)}</blockquote>` : ""}<p class="muted">${escape(f.anchor.projectTitle)} · ${escape(f.lemma)}</p><div class="row wrap">${btn("locate", "回到原句", `data-id="${f.id}"`)}${btn("edit-lemma", "基础词形", `data-id="${f.id}"`)}${btn("unfavorite", "取消收藏", `data-id="${f.id}"`)}</div><div class="ratings">${["unknown", "fuzzy", "known"].map((r, i) => btn("rate", ["不认识", "模糊", "认识"][i], `data-rating="${r}" data-id="${f.id}" ${!flipped && cardMode !== "both" ? "disabled" : ""}`)).join("")}</div>`}</div>`;
  bindSearch();
}
function groupBook(fs: any[]) {
  const groups = new Map<string, any[]>();
  fs.forEach((f) => groups.set(f.lemma, [...(groups.get(f.lemma) ?? []), f]));
  return [...groups]
    .map(
      ([lemma, items]) =>
        `<section class="word-group"><h3>${escape(lemma)} <small>${items.length} 个语境</small></h3>${items.map((f) => `<div class="word-entry"><strong>${escape(f.original)}</strong><p>${escape(f.meaning)}</p>${!hideSentence ? `<blockquote>${escape(f.anchor.sentence.quote)}</blockquote>` : ""}<small>${escape(f.anchor.projectTitle)}${f.sourceDeleted ? " · 项目已删除" : ""}</small><div class="row">${btn("locate", "来源", `data-id="${f.id}"`)}${btn("unfavorite", "取消收藏", `data-id="${f.id}"`)}</div></div>`).join("")}</section>`,
    )
    .join("");
}
function refreshBook() {
  cardIds = cardIds.filter((id) => lib.favorites.some((f: any) => f.id === id));
  if (view === "global") renderBook($("#global-book"), true);
  else renderPanel();
}
function bindSearch() {
  let timer: ReturnType<typeof setTimeout>;
  $("#search")?.addEventListener("input", () => {
    const input = $<HTMLInputElement>("#search"),
      pos = input.selectionStart;
    clearTimeout(timer);
    timer = setTimeout(() => {
      filter = input.value;
      cardIds = [];
      cardIndex = 0;
      if (view === "home") renderHome();
      else refreshBook();
      $("#search")?.focus();
      $<HTMLInputElement>("#search")?.setSelectionRange(pos, pos);
    }, 180);
  });
}
async function loadImages() {
  await Promise.allSettled(
    [...document.querySelectorAll<HTMLImageElement>("img[data-asset]")].map(
      async (img) => {
        try {
          img.src = await platform.readImage(img.dataset.asset!);
        } catch {
          img.alt = "原图暂不可访问（可能为轻量恢复）";
        }
      },
    ),
  );
}
function dialog(title: string, body: string) {
  const d = $<HTMLDialogElement>("#dialog");
  delete d.dataset.summaryLoading;
  d.innerHTML = `<div class="dialog-head"><h2>${title}</h2>${btn("close-dialog", "×", 'aria-label="关闭"')}</div>${body}`;
  d.showModal();
}
async function nameDialog(
  title: string,
  value = "",
  callback: (s: string) => Promise<void>,
) {
  dialog(
    title,
    `<form id="name-form"><label>名称<input id="name" value="${escape(value)}" ${title === "新建项目" ? 'placeholder="留空使用今天的日期"' : "required"} maxlength="120"></label><button class="primary">保存</button></form>`,
  );
  $("#name-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await callback($<HTMLInputElement>("#name").value);
      $<HTMLDialogElement>("#dialog").close();
      render();
    } catch (e) {
      showError(e);
    }
  };
}
function cancel() {
  stopRequests();
  requestBusy = false;
  renderPanel();
  toast("已取消；已发送的请求不保证停止计费");
}
const controller = new SelectionController({
  delay: 650,
  request: async (a: any, signal: AbortSignal) => {
    const token = ++queryToken;
    queryState = "正在查询词句…";
    renderPanel();
    try {
      return await runModel("explain", a, signal);
    } finally {
      if (token === queryToken) {
        queryState = "";
        renderPanel();
      }
    }
  },
  render: ({ selection, result, error }: any) => {
    if (
      selected?.paragraphId === selection.paragraphId &&
      selected?.versionId === selection.versionId &&
      selected?.start === selection.start &&
      selected?.end === selection.end
    ) {
      activeResult = result ?? { error };
      renderPanel();
    }
  },
});
async function consent() {
  if (lib.settings.uploadConsent) return true;
  return new Promise<boolean>((resolve) => {
    dialog(
      "首次联网说明",
      `<p>新解释发送选区、原句及必要上下文；识别发送所选页或处理副本到 DeepSeek 官方接口。上传前请检查姓名、学号等信息。</p><p>已有资料保存在本机，无云同步。Key 仅用于接口鉴权。</p>${btn("consent-yes", "知道了，继续", 'class="primary"')}${btn("consent-no", "取消")}`,
    );
    $("#dialog").addEventListener("close", () => resolve(false), {
      once: true,
    });
    $('[data-action="consent-yes"]').onclick = async () => {
      lib.settings.uploadConsent = true;
      await commit();
      resolve(true);
      $<HTMLDialogElement>("#dialog").close();
    };
    $('[data-action="consent-no"]').onclick = () => {
      $<HTMLDialogElement>("#dialog").close();
      resolve(false);
    };
  });
}
async function runModel(
  task: Task,
  a: any,
  signal?: AbortSignal,
  extra = "",
  force = false,
) {
  if (signal?.aborted) throw Error("已取消");
  const source = resolveAnchor(lib, a);
  if (source.status !== "valid") throw Error("来源待重新定位");
  const context = currentText(source.paragraph),
    model = lib.settings.model,
    key = cacheKey(task, a, model, context, extra);
  const cached =
    task === "explain"
      ? firstExplanation(lib, a, model)
      : lib.results.find((r: any) => r.key === key && r.data && !r.error);
  if (cached && !force) return cached;
  if (!(await consent())) throw Error("已取消上传");
  if (signal?.aborted) throw Error("已取消");
  const requestId = uid(),
    isCurrent = requests.begin(requestId, () =>
      platform.cancel(requestId).catch(() => {}),
    );
  const taskRecord: any = {
    id: requestId,
    projectId: a.projectId,
    type: task,
    status: "running",
    created: now(),
    usage: null,
  };
  lib.tasks.push(taskRecord);
  await commit();
  const abort = () => {
    platform.cancel(requestId).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const result: any = {
    id: uid(),
    key,
    task,
    requestedModel: model,
    anchor: structuredClone(a),
    created: now(),
    raw: "",
    data: null,
  };
  try {
    if (signal?.aborted) throw Error("已取消");
    const history =
      task === "followup"
        ? lib.results
            .filter(
              (r: any) =>
                r.task === "followup" &&
                r.anchor?.paragraphId === a.paragraphId &&
                r.anchor?.versionId === a.versionId &&
                r.anchor?.start === a.start &&
                r.anchor?.end === a.end,
            )
            .slice(-6)
            .map((r: any) => ({
              question: r.question,
              answer: r.data?.meaning_zh,
            }))
        : [];
    const response = await platform.model(
      requestId,
      payloadFor(
        task,
        {
          selection: a.quote,
          sentence: a.sentence.quote,
          context,
          question: extra,
          history,
        },
        model,
      ),
    );
    Object.assign(result, {
      raw: response.raw,
      model: response.model,
      usage: response.usage,
      question: extra,
    });
    taskRecord.usage = response.usage;
    if (
      signal?.aborted ||
      !isCurrent() ||
      resolveAnchor(lib, a).status !== "valid"
    ) {
      taskRecord.status = "cancelled";
      throw Error("结果已过时，未覆盖当前正文或选区");
    }
    if (response.finish_reason !== "stop")
      throw Error("输出不完整，原稿已保留");
    result.data = parseOutput(task, response.raw, a);
    taskRecord.status = "success";
    lib.results.push(result);
    await commit();
    return result;
  } catch (e) {
    taskRecord.status =
      signal?.aborted || !isCurrent() ? "cancelled" : "failed";
    result.error = String(e instanceof Error ? e.message : e);
    if (result.raw && !lib.results.some((r: any) => r.id === result.id))
      lib.results.push(result);
    await commit();
    throw e;
  } finally {
    requests.finish(requestId);
    signal?.removeEventListener("abort", abort);
  }
}
function choose(a: any) {
  if (
    selectionKey(selected) === selectionKey(a) &&
    (activeResult || queryState)
  ) {
    panel = "explain";
    showPanel = true;
    $(".inspector").classList.add("open");
    $(".inspector").removeAttribute("inert");
    renderPanel();
    return;
  }
  stopRequests();
  selected = a;
  activeResult = firstExplanation(lib, a, lib.settings.model);
  panel = "explain";
  showPanel = true;
  controller.delay = lib.settings.delay;
  controller.mode = lib.settings.mode;
  if (!activeResult) {
    queryState = controller.mode === "auto" ? "准备查询…" : "";
    controller.choose(a);
  }
  if (getProject()) getProject().lastSelection = a;
  $(".inspector").classList.add("open");
  $(".inspector").removeAttribute("inert");
  $("#selection-caption").textContent = a.quote;
  renderPanel();
}
let selectionTimer: ReturnType<typeof setTimeout>;
document.addEventListener("selectionchange", () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    if (
      !["reader", "sections"].includes(view) ||
      pointer ||
      suppressSelection ||
      $<HTMLDialogElement>("#dialog")?.open
    )
      return;
    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.anchorNode ||
      !selection.focusNode
    )
      return;
    const element =
      selection.anchorNode.parentElement?.closest<HTMLElement>(".paragraph");
    if (!element || !element.contains(selection.focusNode)) return;
    if (element.dataset.owner) articleId = element.dataset.owner;
    const pg = getArticle()?.paragraphs.find(
      (p: any) => p.id === element.dataset.paragraph,
    );
    if (!pg) return;
    const range = expandWords(
      currentText(pg),
      offsetIn(element, selection.anchorNode, selection.anchorOffset),
      offsetIn(element, selection.focusNode, selection.focusOffset),
    );
    if (
      !range ||
      (selected?.paragraphId === pg.id &&
        selected?.versionId === pg.currentVersion &&
        selected?.start === range.start &&
        selected?.end === range.end)
    )
      return;
    captureSelection(element);
  }, 250);
});
let scrollTimer: ReturnType<typeof setTimeout>,
  pointer: { x: number; y: number; type: string; moved: boolean } | null = null,
  suppressSelection = false;
function onScroll() {
  if (pointer) pointer.moved = true;
  if (controller.timer !== undefined) stopRequests();
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    if (getProject()) {
      getProject().scroll = $("#main-view")?.scrollTop ?? 0;
      commit().catch(showError);
    }
  }, 300);
}
function offsetIn(p: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(p);
  range.setEnd(node, offset);
  return range.toString().length;
}
function bindSelection() {
  const main = $("#main-view");
  main.onpointerdown = (e) => {
    if ((e.target as HTMLElement).closest("button,input,textarea,select"))
      return;
    pointer = { x: e.clientX, y: e.clientY, type: e.pointerType, moved: false };
    suppressSelection = false;
  };
  main.onpointermove = (e) => {
    if (pointer && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 9)
      pointer.moved = true;
  };
  main.onpointercancel = () => {
    pointer = null;
    stopRequests();
  };
  main.onpointerup = (e) => {
    const gesture = pointer;
    pointer = null;
    if (
      !gesture ||
      suppressSelection ||
      (gesture.type === "touch" && gesture.moved)
    )
      return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(".paragraph");
    if (!target) return;
    setTimeout(() => captureSelection(target, e.clientX, e.clientY), 0);
  };
  main.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
      /^image\/(jpeg|png)$/.test(f.type),
    );
    if (files.length) {
      e.preventDefault();
      importFiles(files).catch(showError);
    }
  });
}
function captureSelection(target: HTMLElement, x?: number, y?: number) {
  if (target.dataset.owner) articleId = target.dataset.owner;
  const p = getArticle()?.paragraphs.find(
    (p: any) => p.id === target.dataset.paragraph,
  );
  if (!p) return;
  const s = window.getSelection();
  let start: number, end: number;
  if (s && !s.isCollapsed && s.anchorNode && s.focusNode) {
    if (!target.contains(s.anchorNode) || !target.contains(s.focusNode)) {
      toast("跨段选区请使用更多中的多段分析");
      return;
    }
    start = offsetIn(target, s.anchorNode, s.anchorOffset);
    end = offsetIn(target, s.focusNode, s.focusOffset);
  } else {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const range =
      x !== undefined && y !== undefined
        ? doc.caretRangeFromPoint?.(x, y)
        : null;
    if (!range || !target.contains(range.startContainer)) return;
    start = end = offsetIn(target, range.startContainer, range.startOffset);
  }
  const expanded = expandWords(currentText(p), start, end);
  if (!expanded) return;
  const a = anchorFor(
    getProject(),
    getArticle(),
    p,
    expanded.start,
    expanded.end,
  );
  const range = document.createRange(),
    walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let node: Node | null,
    total = 0,
    started = false;
  while ((node = walker.nextNode())) {
    const n = node.textContent?.length ?? 0;
    if (!started && expanded.start <= total + n) {
      range.setStart(node, expanded.start - total);
      started = true;
    }
    if (expanded.end <= total + n) {
      range.setEnd(node, expanded.end - total);
      break;
    }
    total += n;
  }
  if (started) {
    s?.removeAllRanges();
    s?.addRange(range);
  }
  choose(a);
}
async function importFiles(files: File[]) {
  if (importBusy) throw Error("正在保存图片，请稍候");
  if (!libraryPath) throw Error("请先选择资料保存位置，再拖入图片");
  if (!files.length) return;
  if (
    files.some(
      (file) =>
        !/\.(png|jpe?g)$/i.test(file.name) &&
        !/^image\/(png|jpeg)$/.test(file.type),
    )
  )
    throw Error("只支持 JPG / PNG");
  let p = getProject();
  if (!p || p.deletedAt || view === "home") {
    p = newProject();
    lib.projects.push(p);
    projectId = p.id;
    articleId = null;
    lib.lastProject = p.id;
    view = "reader";
    await commit();
    render();
  }
  importBusy = true;
  try {
    for (const [i, file] of files.entries()) {
      importProgress = `正在保存 ${i + 1} / ${files.length}：${file.name}`;
      pagesDialog();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await platform.importImage(Array.from(bytes));
      p.pages.push({
        id: uid(),
        name: file.name,
        original: asset,
        current: asset,
        transforms: [],
        ocr: null,
      });
      p.updated = now();
      await commit();
    }
  } finally {
    importBusy = false;
    importProgress = "";
    if (projectId === p.id) {
      render();
      pagesDialog();
    }
  }
}
function pickFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg";
  input.multiple = true;
  input.onchange = () => importFiles([...(input.files ?? [])]).catch(showError);
  input.click();
}
function pagesDialog() {
  const p = getProject();
  dialog(
    "上传与页面",
    `<p>已上传 <strong>${p.pages.length}</strong> 张图片 · 按下方序号识别。可拖入窗口、粘贴或继续添加图片。</p>${importProgress ? loading(importProgress) : ""}${ocrBusy ? loading("正在识别文章、正文与其它分区…") : ""}<div class="pages">${p.pages.map((page: any, i: number) => `<div class="page-row"><img data-asset="${page.current.id}" alt="第${i + 1}页"><div><strong>${i + 1}. ${escape(page.name)}</strong><p>${escape(page.ocr?.status ?? "未识别")}</p><div class="row wrap">${btn("page-up", "上移", `data-id="${page.id}" ${i === 0 ? "disabled" : ""}`)}${btn("page-down", "下移", `data-id="${page.id}" ${i === p.pages.length - 1 ? "disabled" : ""}`)}${btn("rotate-page", "旋转90°", `data-id="${page.id}"`)}${btn("crop-page", "裁切/增强", `data-id="${page.id}"`)}${btn("reset-page", "原图", `data-id="${page.id}"`)}${btn("ocr-page", page.ocr ? "重新识别" : "识别本页", `data-id="${page.id}" ${ocrBusy ? "disabled" : ""}`)}${page.ocr?.raw ? btn("ocr-raw", "原稿", `data-id="${page.id}"`) : ""}</div></div></div>`).join("")}</div><div class="row">${btn("import", "再导入")}${/Android/i.test(navigator.userAgent) ? btn("camera", "拍照") : ""}${btn("ocr-all", "识别未完成页", 'class="primary" ' + (ocrBusy ? "disabled" : ""))}</div>`,
  );
  loadImages();
}
async function ocrPage(id: string, review = true) {
  if (ocrBusy) throw Error("识别队列正在运行");
  ocrBusy = true;
  try {
    if (!(await consent())) return;
    const project = getProject(),
      page = project.pages.find((x: any) => x.id === id);
    if (!page) return;
    ocrBusy = true;
    pagesDialog();
    const requestId = uid(),
      versionAsset = page.current.id,
      isCurrent = requests.begin(requestId, () =>
        platform.cancel(requestId).catch(() => {}),
      );
    const task: any = {
      id: requestId,
      projectId: project.id,
      pageId: id,
      type: "ocr",
      status: "running",
      usage: null,
      created: now(),
    };
    lib.tasks.push(task);
    await commit();
    toast("正在转写本页，可先阅读已完成内容");
    try {
      const image = await platform.readImage(page.current.id);
      const result = await platform.model(
        requestId,
        payloadFor("ocr", { image }),
      );
      if (!isCurrent()) throw Error("识别已取消");
      page.ocr = {
        raw: result.raw,
        status: "needs_review",
        usage: result.usage,
        assetId: versionAsset,
      };
      task.usage = result.usage;
      if (result.finish_reason !== "stop")
        throw Error("转写被截断，原稿已保留");
      const draft = decodeJson(result.raw);
      const missingTitles = Array.isArray(draft.articles)
        ? draft.articles.filter(
            (a: any) =>
              a &&
              typeof a.id === "string" &&
              (!String(a.title || "").trim() ||
                /^[A-F](?:[（(]选做[）)])?$/.test(String(a.title))),
          )
        : [];
      if (missingTitles.length && Array.isArray(draft.paragraphs)) {
        const titlesResult = await platform.model(
          requestId,
          payloadFor(
            "titles",
            {
              articles: missingTitles.map((a: any) => ({
                id: a.id,
                body: draft.paragraphs
                  .filter((p: any) => p.article === a.id && p.kind === "body")
                  .map((p: any) => p.text)
                  .join("\n"),
              })),
            },
            "deepseek-flash",
          ),
        );
        page.ocr.titleRaw = titlesResult.raw;
        task.usage = page.ocr.usage = {
          ocr: result.usage,
          titles: titlesResult.usage,
        };
        if (!isCurrent()) throw Error("识别已取消");
        if (titlesResult.finish_reason !== "stop")
          throw Error("文章标题未完整返回，转写原稿已保留");
        const titles = decodeJson(titlesResult.raw).titles;
        for (const a of missingTitles) {
          const t = Array.isArray(titles)
            ? titles.find(
                (t: any) =>
                  t.id === a.id &&
                  typeof t.title === "string" &&
                  t.title.trim(),
              )
            : null;
          if (!t) throw Error("文章标题仍需核对，转写原稿已保留");
          a.title = t.title;
          a.title_inferred = true;
        }
      }
      const parsed = parseOutput("ocr", JSON.stringify(draft));
      if (!parsed.articles)
        throw Error("识别缺少文章标题和分区，请重试本页；原稿已保留");
      page.ocr.parsed = parsed;
      if (page.current.id !== versionAsset)
        throw Error("图片已变化，请核对原稿后再应用");
      task.status = "success";
      page.ocr.status = "待核对 / 应用";
      await commit();
      if (review && projectId === project.id) showOcrReview(page, project);
    } catch (e) {
      task.status = "failed";
      if (page.ocr) page.ocr.status = "格式或字段失败 · 原稿已保留";
      await commit();
      showError(e);
    } finally {
      requests.finish(requestId);
      ocrBusy = false;
    }
  } finally {
    ocrBusy = false;
  }
}
function showOcrReview(page: any, project: any) {
  const parsed = page.ocr?.parsed;
  if (!parsed) {
    dialog(
      "转写原稿 · 未通过结构校验",
      `<pre>${escape(page.ocr?.raw)}</pre><p>保留原稿，未替换正文；可以重试本页。</p>`,
    );
    return;
  }
  dialog(
    "核对转写与文章分组",
    `<p>识别到 <strong>${parsed.articles?.length ?? new Set(parsed.paragraphs.map((x: any) => x.article)).size}</strong> 篇文章。</p>${(parsed.articles || []).map((a: any) => `<section class="article-detection"><h3>${escape(a.title)}${a.title_inferred ? "（概括标题）" : ""}</h3><p>起点：${escape(parsed.paragraphs.find((p: any) => p.id === a.boundary.start_id)?.text.slice(0, 90))}</p><p>终点：${escape(parsed.paragraphs.find((p: any) => p.id === a.boundary.end_id)?.text.slice(-90))}</p><small>正文 ${a.body_ids.length} 段 · ${(a.sections || []).map((x: any) => escape(x.name)).join(" / ")}</small></section>`).join("")}<p>逐段核对原词、题目归属及疑难标记。重新识别作为新文章导入，既有手改内容保留。</p><div class="ocr-review">${parsed.paragraphs.map((x: any) => `<section><small>${escape(x.article ?? "未分组")} · ${escape(x.kind)} ${x.uncertain ? "· 疑难" : ""}</small><p>${escape(x.text)}</p></section>`).join("")}</div><details><summary>单独的手写批注 / 排版建议</summary><pre>${escape(JSON.stringify({ notes: parsed.notes, suggestions: parsed.punctuation_suggestions }, null, 2))}</pre></details>${btn("apply-ocr", "核对后作为新文章导入", 'class="primary"')}`,
  );
  $('[data-action="apply-ocr"]').onclick = async () => {
    try {
      const groups = new Map<string, any[]>();
      parsed.paragraphs.forEach((x: any) => {
        const group = x.article || "待分组";
        groups.set(group, [...(groups.get(group) ?? []), x]);
      });
      for (const [name, ps] of groups) {
        const meta = parsed.articles?.find((a: any) => a.id === name);
        const a = {
          id: uid(),
          title:
            meta?.title || (name === "unknown" ? "待归属内容" : `文章 ${name}`),
          detection: meta ? { ...meta, pageId: page.id } : null,
          paragraphs: ps.map((x: any) => ({
            ...paragraph(x.text, x.kind, page.id),
            uncertain: x.uncertain,
            sectionName: meta?.sections.find((s: any) =>
              s.block_ids.includes(x.id),
            )?.name,
          })),
          questionsVerified: false,
          notes: parsed.notes,
        };
        project.articles.push(a);
        if (!articleId) articleId = a.id;
      }
      page.ocr.status = "已导入";
      project.lastArticle = articleId;
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      render();
      toast("转写已保存，原稿与手改版本保留");
    } catch (e) {
      showError(e);
    }
  };
}
async function transformPage(
  id: string,
  rotation = 90,
  crop?: { x: number; y: number; w: number; h: number; contrast: number },
) {
  const page = getProject().pages.find((p: any) => p.id === id),
    url = await platform.readImage(page.current.id),
    img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas"),
    ctx = c.getContext("2d")!;
  const area = crop ?? {
    x: 0,
    y: 0,
    w: img.naturalWidth,
    h: img.naturalHeight,
    contrast: 1,
  };
  if (
    area.w < 1 ||
    area.h < 1 ||
    area.x < 0 ||
    area.y < 0 ||
    area.x + area.w > img.naturalWidth ||
    area.y + area.h > img.naturalHeight
  )
    throw Error("裁切范围越界");
  if (!Number.isFinite(rotation) || Math.abs(rotation) > 360)
    throw Error("旋转角度无效");
  const radians = (rotation * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  c.width = Math.round(Math.abs(area.w * cos) + Math.abs(area.h * sin));
  c.height = Math.round(Math.abs(area.w * sin) + Math.abs(area.h * cos));
  if (c.width * c.height > 40_000_000) throw Error("处理图像过大，请先裁切");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(radians);
  ctx.translate(-area.w / 2, -area.h / 2);
  ctx.filter = `contrast(${area.contrast})`;
  ctx.drawImage(img, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
  const output = c.toDataURL("image/png");
  dialog(
    "处理预览",
    `<img class="transform-preview" src="${output}" alt="处理副本预览"><p>确认后保存为副本，原图不变。仅应用到本页。</p>${btn("apply-transform", "确认副本", 'class="primary"')}`,
  );
  $('[data-action="apply-transform"]').onclick = async () => {
    try {
      const bytes = Uint8Array.from(atob(output.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      const previous = page.current;
      page.current = await platform.importImage(Array.from(bytes));
      page.transforms.push({
        from: previous.id,
        to: page.current.id,
        source: previous,
        output: page.current,
        rotation,
        crop: area,
        coordinate: "continuous-pixel-boundary",
        matrix: [
          cos,
          -sin,
          c.width / 2 -
            cos * (area.x + area.w / 2) +
            sin * (area.y + area.h / 2),
          sin,
          cos,
          c.height / 2 -
            sin * (area.x + area.w / 2) -
            cos * (area.y + area.h / 2),
          0,
          0,
          1,
        ],
      });
      await commit();
      pagesDialog();
    } catch (e) {
      showError(e);
    }
  };
}
async function summary(projectWide = false) {
  const a = getArticle(),
    p = getProject();
  if (!p || (!projectWide && !a)) throw Error("先打开项目或文章");
  const task: Task = projectWide ? "project-summary" : "summary";
  if (summaryBusy) {
    toast("总结请求正在处理中，请稍候");
    return;
  }
  summaryBusy = projectWide ? p.id : a.id;
  try {
    const body = (projectWide ? p.articles : [a]).flatMap((article: any) =>
      article.paragraphs
        .filter((x: any) => x.kind === "body")
        .map((x: any) => ({
          paragraphId: x.id,
          versionId: x.currentVersion,
          text: currentText(x),
          ...(projectWide
            ? { articleId: article.id, articleTitle: article.title }
            : {}),
        })),
    );
    if (!body.length) throw Error("这篇文章暂无正文，请先核对识别分区");
    const cached = lib.results.find(
      (r: any) =>
        r.task === task &&
        (projectWide ? r.projectId === p.id : r.articleId === a.id) &&
        r.data &&
        r.versions === JSON.stringify(body),
    );
    if (cached) {
      showSummary(cached);
      return;
    }
    if (!(await consent())) return;
    summaryLoading();
    const snapshot = JSON.stringify(body),
      id = uid(),
      isCurrent = summaryRequests.begin(id, () =>
        platform.cancel(id).catch(() => {}),
      );
    const t: any = {
      id,
      projectId: p.id,
      type: task,
      status: "running",
      created: now(),
      usage: null,
    };
    lib.tasks.push(t);
    await commit();
    toast("正在生成本篇总结");
    let stored: any = null;
    try {
      const r = await platform.model(
        id,
        payloadFor(
          task,
          { title: projectWide ? p.title : a.title, paragraphs: body },
          lib.settings.model,
        ),
      );
      stored = {
        id: uid(),
        task,
        projectId: p.id,
        articleId: projectWide ? null : a.id,
        versions: snapshot,
        raw: r.raw,
        model: r.model,
        usage: r.usage,
        created: now(),
      };
      lib.results.push(stored);
      t.usage = r.usage;
      const validate = (raw: string) => {
        const parsed = parseOutput("summary", raw);
        validateCitations(parsed.points, body);
        if (projectWide) {
          const covered = new Set(
            parsed.points.flatMap((point: any) =>
              point.citations.map(
                (c: any) =>
                  body.find((x: any) => x.paragraphId === c.paragraphId)
                    ?.articleId,
              ),
            ),
          );
          if (new Set(body.map((x: any) => x.articleId)).size !== covered.size)
            throw Error("项目总结有文章未覆盖");
        }
        return parsed;
      };
      let parsed;
      try {
        if (r.finish_reason !== "stop") throw Error("总结被截断");
        parsed = validate(r.raw);
      } catch {
        if (!isCurrent()) throw Error("总结已取消");
        if ($<HTMLDialogElement>("#dialog")?.dataset.summaryLoading) {
          summaryLoading();
          $("#dialog .loading-state span:last-child").textContent =
            "正在校正总结格式与原句引用…";
        }
        const repaired = await platform.model(
          id,
          payloadFor(
            "summary-repair",
            {
              scope: projectWide ? "project" : "article",
              title: projectWide ? p.title : a.title,
              paragraphs: body,
              previous: r.raw,
            },
            lib.settings.model,
          ),
        );
        stored.repairRaw = repaired.raw;
        stored.usage = t.usage = { initial: r.usage, repair: repaired.usage };
        if (!isCurrent()) throw Error("总结已取消");
        if (repaired.finish_reason !== "stop")
          throw Error("校正结果不完整，已保留可读内容");
        parsed = validate(repaired.raw);
      }
      stored.data = parsed;
      t.status = "success";
      await commit();
      if (
        isCurrent() &&
        projectId === p.id &&
        (projectWide || articleId === a.id)
      ) {
        render();
        showSummary(stored);
      }
    } catch (e) {
      t.status = isCurrent() ? "failed" : "cancelled";
      if (stored)
        stored.validationError = String(e instanceof Error ? e.message : e);
      await commit();
      if (stored && isCurrent() && projectId === p.id) {
        render();
        showSummary(stored);
      } else if ($<HTMLDialogElement>("#dialog")?.dataset.summaryLoading) {
        dialog(
          "总结未完成",
          `<p>${escape(String(e))}</p><p>已有结果仍在左侧“总结与分析”中。</p>${btn("summary", "重试")}`,
        );
      }
      showError(e);
    } finally {
      summaryRequests.finish(id);
    }
  } finally {
    summaryBusy = null;
    updateSummaryButtons();
  }
}
function showSummary(r: any) {
  const display = readableSummary(r);
  const project = lib.projects.find((p: any) => p.id === r.projectId);
  const title =
    r.task === "analysis"
      ? "多段分析"
      : r.task === "project-summary"
        ? "项目全部总结"
        : "当前文章总结";
  const prose = (text: string) => {
    const inline = (line: string) =>
      escape(line)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "$1");
    let html = "",
      list = false;
    for (const line of text
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (/^```/.test(line)) continue;
      const item = line.match(/^(?:[-*•]|\d+[.)、])\s+(.+)$/);
      if (item) {
        if (!list) html += "<ul>";
        list = true;
        html += `<li>${inline(item[1])}</li>`;
      } else {
        if (list) html += "</ul>";
        list = false;
        html += /^#{1,6}\s/.test(line)
          ? `<h4>${inline(line.replace(/^#{1,6}\s*/, ""))}</h4>`
          : `<p>${inline(line)}</p>`;
      }
    }
    return html + (list ? "</ul>" : "");
  };
  dialog(
    title,
    `<article class="summary-document"><p class="eyebrow">${escape(project?.title)}</p><h3>内容概览</h3>${prose(display.summary)}${!r.data ? `<p class="warning">引用待核对 · ${escape(r.validationError || "原稿的结构或原句引用尚未通过校验")}</p>` : ""}${display.points
      .map((point: any, i: number) => {
        const source = project?.articles.find((a: any) =>
          a.paragraphs.some(
            (p: any) => p.id === point.citations[0]?.paragraphId,
          ),
        );
        return `<section><h3>${i + 1}. ${r.task === "project-summary" ? escape(source?.title || "文章要点") : point.inference ? "推断" : "原文要点"}</h3>${prose(point.text)}${point.citations.length ? `<details class="summary-citations"><summary>原句依据${r.data ? " · 可定位" : " · 待核对"}</summary>${point.citations.map((c: any, j: number) => (r.data ? btn("summary-locate", escape(c.quote), `data-point="${i}" data-citation="${j}" class="citation"`) : `<blockquote>${escape(c.quote)}</blockquote>`)).join("")}</details>` : ""}</section>`;
      })
      .join(
        "",
      )}<details class="summary-raw"><summary>查看接口原始返回</summary><pre>${escape(r.raw)}${r.repairRaw ? "\n\n格式校正返回：\n" + escape(r.repairRaw) : ""}</pre></details></article>`,
  );
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="summary-locate"]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          const c =
              r.data.points[Number(b.dataset.point)].citations[
                Number(b.dataset.citation)
              ],
            project = lib.projects.find((p: any) => p.id === r.projectId),
            a = project?.articles.find((a: any) =>
              a.paragraphs.some((p: any) => p.id === c.paragraphId),
            ),
            p = a?.paragraphs.find((p: any) => p.id === c.paragraphId);
          if (
            !p ||
            p.currentVersion !== c.versionId ||
            !currentText(p).includes(c.quote)
          ) {
            toast("来源待重新定位");
            return;
          }
          const start = currentText(p).indexOf(c.quote);
          $<HTMLDialogElement>("#dialog").close();
          locateAnchor(anchorFor(project, a, p, start, start + c.quote.length));
        }),
    );
}
function multiAnalysis() {
  const a = getArticle();
  if (!a) throw Error("先打开文章");
  dialog(
    "选择多段分析",
    `<p>仅发送勾选段落及你的问题。结果与单词解释分开保存。</p><form id="analysis-form"><div class="ocr-review">${a.paragraphs
      .filter((p: any) => p.kind === "body")
      .map(
        (p: any, i: number) =>
          `<label><input type="checkbox" name="analysis-paragraph" value="${p.id}">段落 ${i + 1} · ${escape(currentText(p).slice(0, 100))}</label>`,
      )
      .join(
        "",
      )}</div><label>分析问题<textarea id="analysis-question" required placeholder="例如：这些段落如何推进作者的论点？"></textarea></label><button class="primary">分析所选段落</button></form>`,
  );
  $("#analysis-form").onsubmit = async (e) => {
    e.preventDefault();
    const ids = [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[name="analysis-paragraph"]:checked',
        ),
      ].map((x) => x.value),
      question = $<HTMLTextAreaElement>("#analysis-question").value.trim();
    if (ids.length < 2) {
      toast("请至少选择两个段落");
      return;
    }
    const body = a.paragraphs
      .filter((p: any) => ids.includes(p.id))
      .map((p: any) => ({
        paragraphId: p.id,
        versionId: p.currentVersion,
        text: currentText(p),
      }));
    $<HTMLDialogElement>("#dialog").close();
    await analyzeParagraphs(a, body, question).catch(showError);
  };
}
async function analyzeParagraphs(a: any, body: any[], question: string) {
  if (!(await consent())) return;
  const p = getProject(),
    id = uid(),
    isCurrent = requests.begin(id, () => platform.cancel(id).catch(() => {}));
  const task: any = {
    id,
    projectId: p.id,
    type: "analysis",
    status: "running",
    created: now(),
    usage: null,
  };
  lib.tasks.push(task);
  await commit();
  toast("正在分析所选段落");
  try {
    const response = await platform.model(
      id,
      payloadFor(
        "analysis",
        { title: a.title, paragraphs: body, question },
        lib.settings.model,
      ),
    );
    task.usage = response.usage;
    const result: any = {
      id: uid(),
      task: "analysis",
      projectId: p.id,
      articleId: a.id,
      versions: JSON.stringify(body),
      raw: response.raw,
      model: response.model,
      usage: response.usage,
      created: now(),
    };
    lib.results.push(result);
    if (response.finish_reason !== "stop")
      throw Error("分析被截断，已保存原稿");
    const data = parseOutput("summary", response.raw);
    validateCitations(data.points, body);
    result.data = data;
    task.status = isCurrent() ? "success" : "cancelled";
    await commit();
    if (isCurrent() && articleId === a.id) showSummary(result);
  } catch (e) {
    task.status = isCurrent() ? "failed" : "cancelled";
    await commit();
    throw e;
  } finally {
    requests.finish(id);
  }
}
function locateAnchor(a: any) {
  const hit = resolveAnchor(lib, a);
  if (hit.status !== "valid") {
    toast("来源待重新定位；保留原句快照");
    return;
  }
  stopRequests();
  projectId = a.projectId;
  articleId = a.articleId;
  view = hit.paragraph.kind === "body" ? "reader" : "sections";
  selected = a;
  showPanel = true;
  panel = "explain";
  render();
  const element = $(`[data-paragraph="${a.paragraphId}"]`);
  const folded = element?.closest("details");
  if (folded) folded.open = true;
  element?.scrollIntoView({
    block: "center",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
  if (element) {
    const text = currentText(hit.paragraph),
      s = a.sentence;
    element.innerHTML = `${escape(text.slice(0, s.start))}<mark>${escape(text.slice(s.start, s.end))}</mark>${escape(text.slice(s.end))}`;
    setTimeout(() => {
      if (element.isConnected) element.textContent = text;
    }, 4500);
  }
}
function renderTrash() {
  $("#main-view").innerHTML =
    `<section class="page"><h1>回收站</h1><p>保留7天。默认保留的全局词句快照不随项目永久删除。</p>${
      lib.projects
        .filter((p: any) => p.deletedAt)
        .map(
          (p: any) =>
            `<div class="word-entry"><h3>${escape(p.title)}</h3><p>${escape(p.deletedAt)} · ${p.deleteFavorites ? "到期同时删除词句" : "保留全局词句快照"}</p>${btn("restore-project", "恢复", `data-id="${p.id}"`)}${btn("purge-project", "永久删除", `data-id="${p.id}"`)}</div>`,
        )
        .join("") || '<p class="muted">回收站为空</p>'
    }</section>`;
}
function settings() {
  dialog(
    "设置",
    `<form id="settings-form"><label>个人 DeepSeek Key（留空保持现有）<input id="api-key" type="password" autocomplete="off" placeholder="仅本机系统加密保存"></label><p class="muted">默认 Flash；Pro 仅在你选择后用于文本任务，识别始终使用 Flash。</p><label>文本模型<select id="model"><option value="deepseek-flash">Flash（默认）</option><option value="deepseek-v4-pro" ${lib.settings.model === "deepseek-v4-pro" ? "selected" : ""}>Pro（手动选择）</option></select></label><label>解释触发<select id="mode"><option value="auto">松手延时自动查</option><option value="confirm" ${lib.settings.mode === "confirm" ? "selected" : ""}>二次确认</option></select></label><label>字号<input id="font-size" type="range" min="16" max="28" value="${lib.settings.fontSize}"></label><label>行距<input id="line-height" type="range" min="1.4" max="2.4" step="0.1" value="${lib.settings.lineHeight}"></label><label>阅读宽度<input id="reading-width" type="range" min="540" max="960" step="20" value="${lib.settings.width}"></label><label><input id="numbers" type="checkbox" ${lib.settings.showNumbers ? "checked" : ""}>段落编号</label><p class="muted">${escape(libraryPath || "尚未选目录")}</p><div class="row"><button class="primary">保存设置</button>${btn("choose-library", "切换资料目录")}${btn("install-library", "存储到安装位置")}<small>${storageHint}</small>${btn("usage", "用量记录")}</div></form>`,
  );
  $("#settings-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const key = $<HTMLInputElement>("#api-key");
      if (key.value.trim()) {
        await platform.setKey(key.value);
        key.value = "";
      }
      Object.assign(lib.settings, {
        model: $<HTMLSelectElement>("#model").value,
        mode: $<HTMLSelectElement>("#mode").value,
        fontSize: Number($<HTMLInputElement>("#font-size").value),
        lineHeight: Number($<HTMLInputElement>("#line-height").value),
        width: Number($<HTMLInputElement>("#reading-width").value),
        showNumbers: $<HTMLInputElement>("#numbers").checked,
      });
      stopRequests();
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      render();
      toast("设置已保存");
    } catch (e) {
      showError(e);
    }
  };
}
async function speak(sentence = false) {
  if (!selected) throw Error("先选择词句");
  if (native) {
    await platform.speak(sentence ? selected.sentence.quote : selected.quote);
    toast("已交给本机英语语音引擎");
    return;
  }
  if (!("speechSynthesis" in window)) throw Error("当前容器缺少语音引擎");
  const voices = speechSynthesis
    .getVoices()
    .filter((v) => v.localService && /^en[-_]/i.test(v.lang));
  if (!voices.length)
    throw Error(
      "未找到本机英语声音，请在系统语言设置中安装英语语音包后重试。没有使用云发音。",
    );
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    sentence ? selected.sentence.quote : selected.quote,
  );
  utterance.voice = voices[0];
  utterance.lang = voices[0].lang;
  utterance.onerror = () => toast("语音未能播放，请检查本机声音包");
  utterance.onstart = () => toast("正在使用本机英语声音");
  speechSynthesis.speak(utterance);
}
function backupDialog() {
  dialog(
    "备份与迁移",
    `<p>完整备份含原图/处理副本、正文版本、词句和结果。轻量备份不含图片，恢复后无法查看未携带的原图。均不含 Key。</p><div class="row wrap">${btn("backup-full", "全库完整备份", 'class="primary"')}${btn("backup-light", "全库轻量备份")}${btn("backup-project-full", "本项目完整备份")}${btn("backup-project-light", "本项目轻量备份")}${btn("restore-backup", "预览导入")}</div><p class="muted">导入为新副本，重新分配资料ID，不覆盖现有项目。当前包安全上限128MiB，超出请分项目导出。</p>${saveError ? btn("export-draft", "导出未保存草稿JSON") : ""}`,
  );
}
function projectSnapshot() {
  const copy = structuredClone(lib);
  copy.projects = copy.projects.filter((p: any) => p.id === projectId);
  if (!copy.projects.length) throw Error("请先打开项目");
  copy.favorites = copy.favorites.filter(
    (f: any) => f.anchor.projectId === projectId,
  );
  copy.results = copy.results.filter(
    (r: any) => r.projectId === projectId || r.anchor?.projectId === projectId,
  );
  copy.tasks = copy.tasks.filter((t: any) => t.projectId === projectId);
  return copy;
}
async function exportBackup(full: boolean, one = false) {
  await saveChain;
  const path = await platform.exportBackup(
    JSON.stringify(one ? projectSnapshot() : lib),
    full,
  );
  if (path) toast("备份已写入所选文件");
}
async function restoreBackup() {
  const preview = await platform.inspectBackup();
  if (!preview) return;
  const source = JSON.parse(preview.data);
  dialog(
    "确认导入副本",
    `<p>${source.projects.length} 个项目，${source.favorites.length} 条词句，${preview.assets} 个图像文件。</p><p>${preview.full ? "完整备份" : "轻量备份：原图未随包提供"}</p><p>现有资料不覆盖，导入项目使用新的身份。</p>${btn("confirm-restore", "导入为新副本", 'class="primary"')}`,
  );
  $('[data-action="confirm-restore"]').onclick = async () => {
    try {
      await platform.restoreAssets(preview.token);
      const next = structuredClone(lib);
      importAsCopy(next, source);
      lib = next;
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      view = "home";
      render();
      toast("副本导入完成");
    } catch (e) {
      showError(e);
    }
  };
}
function articleOrganization() {
  const a = getArticle();
  dialog(
    "文章组织",
    `<form id="article-form"><label>文章标题<input id="article-name" value="${escape(a.title)}"></label><p>可将本篇段落移动到另一篇；跨页文章通过同一目标文章连续阅读。</p><label>合并到<select id="merge-target"><option value="">保持独立</option>${getProject()
      .articles.filter((x: any) => x.id !== a.id)
      .map((x: any) => `<option value="${x.id}">${escape(x.title)}</option>`)
      .join(
        "",
      )}</select></label><label>将某段及之后拆成新文章<select id="split-article"><option value="">不拆分</option>${a.paragraphs
      .slice(1)
      .map(
        (p: any, i: number) =>
          `<option value="${i + 1}">从段落 ${i + 2} 开始</option>`,
      )
      .join(
        "",
      )}</select></label><div class="ocr-review">${a.paragraphs.map((p: any, i: number) => `<section><p>${i + 1}. ${escape(currentText(p).slice(0, 90))}</p>${btn("paragraph-up", "上移", `data-id="${p.id}" ${i === 0 ? "disabled" : ""}`)}${btn("paragraph-down", "下移", `data-id="${p.id}" ${i === a.paragraphs.length - 1 ? "disabled" : ""}`)}</section>`).join("")}</div><button class="primary">保存</button></form>`,
  );
  $("#article-form").onsubmit = async (e) => {
    e.preventDefault();
    a.title = $<HTMLInputElement>("#article-name").value;
    const id = $<HTMLSelectElement>("#merge-target").value;
    const split = $<HTMLSelectElement>("#split-article").value;
    if (id && split) {
      toast("请分两次操作合并与拆分");
      return;
    }
    if (split) {
      const at = Number(split),
        paragraphs = a.paragraphs.splice(at);
      getProject().articles.push({
        id: uid(),
        title: a.title + "（续）",
        paragraphs,
        questionsVerified: false,
      });
    }
    if (id) {
      const target = getProject().articles.find((x: any) => x.id === id);
      target.paragraphs.push(...a.paragraphs);
      getProject().articles = getProject().articles.filter(
        (x: any) => x.id !== a.id,
      );
      articleId = id;
    }
    await commit();
    $<HTMLDialogElement>("#dialog").close();
    render();
  };
}

document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!b) return;
  handle(b.dataset.action!, b).catch(showError);
});
async function handle(action: string, b: HTMLButtonElement) {
  const id = b.dataset.id,
    p = getProject();
  if (action === "choose-library" || action === "install-library") {
    if (summaryBusy || importBusy || ocrBusy)
      throw Error("请等待当前导入、识别或总结完成，再切换资料目录");
    stopRequests();
    await saveChain.catch(() => {});
    await load(
      await (action === "install-library"
        ? platform.installLocation()
        : platform.choose()),
    );
    await maybeGuide();
    return;
  }
  if (action === "close-dialog") {
    $<HTMLDialogElement>("#dialog").close();
    return;
  }
  if (action === "home" || action === "global" || action === "trash") {
    stopRequests();
    view = action;
    filter = "";
    cardIds = [];
    cardIndex = 0;
    render();
    return;
  }
  if (action === "theme") {
    lib.settings.theme = lib.settings.theme === "dark" ? "light" : "dark";
    if (libraryPath) await commit();
    render();
    return;
  }
  if (action === "settings") {
    settings();
    return;
  }
  if (action === "navigation") {
    dialog(
      "资料目录",
      `<div class="menu">${btn("home", "项目首页")}${btn("global", "全局生词本")}${btn("new-project", "新项目")}${lib.projects
        .filter((p: any) => !p.deletedAt && !p.quickAccessClosed)
        .map(
          (p: any) =>
            `<details><summary>${escape(p.title)}</summary>${btn("open-project", "精读", `data-id="${p.id}"`)}${btn("project-book", "项目生词本", `data-id="${p.id}"`)}${btn("project-pages", "上传与页面", `data-id="${p.id}"`)}${btn("project-sections", "非文章部分", `data-id="${p.id}"`)}${btn("project-summaries", "总结与分析", `data-id="${p.id}"`)}${p.articles.map((a: any) => btn("article", escape(a.title), `data-project="${p.id}" data-id="${a.id}"`)).join("")}</details>`,
        )
        .join(
          "",
        )}${btn("trash", "回收站")}${btn("backup", "备份与迁移")}</div>`,
    );
    return;
  }
  if (action === "new-project") {
    if (!libraryPath) throw Error("请先选择资料目录");
    await nameDialog("新建项目", dateName(), async (title) => {
      const project = newProject(title);
      lib.projects.push(project);
      projectId = project.id;
      lib.lastProject = project.id;
      articleId = null;
      view = "reader";
      await commit();
    });
    return;
  }
  if (action === "close-project") {
    const target = lib.projects.find((p: any) => p.id === id);
    target.quickAccessClosed = true;
    if (projectId === id) {
      stopRequests();
      projectId = null;
      articleId = null;
      selected = null;
      activeResult = null;
      lib.lastProject = null;
      view = "home";
    }
    await commit();
    render();
    toast("已关闭快捷访问；可从项目首页重新打开");
    return;
  }
  if (action === "api-guide") {
    apiGuide();
    return;
  }
  if (action === "collapse") {
    collapsed.has(id!) ? collapsed.delete(id!) : collapsed.add(id!);
    render();
    return;
  }
  if (
    [
      "open-project",
      "project-book",
      "article",
      "project-pages",
      "project-summaries",
      "project-sections",
    ].includes(action)
  ) {
    stopRequests();
    projectId = action === "article" ? b.dataset.project! : id!;
    const p = getProject();
    articleId =
      action === "article" ? id! : (p.lastArticle ?? p.articles[0]?.id ?? null);
    p.quickAccessClosed = false;
    p.lastArticle = articleId;
    p.updated = now();
    lib.lastProject = projectId;
    view = action === "project-sections" ? "sections" : "reader";
    selected = null;
    activeResult = null;
    showPanel = action === "project-book";
    panel = action === "project-book" ? "book" : "explain";
    cardIds = [];
    cardIndex = 0;
    await commit();
    render();
    if (action === "project-pages") pagesDialog();
    if (action === "project-summaries") savedSummaries(true);
    return;
  }
  if (action === "rename") {
    await nameDialog(
      "项目名称",
      lib.projects.find((p: any) => p.id === id).title,
      async (name) => {
        lib.projects.find((p: any) => p.id === id).title = name;
        await commit();
      },
    );
    return;
  }
  if (action === "archive") {
    const p = lib.projects.find((p: any) => p.id === id);
    p.archived = !p.archived;
    await commit();
    render();
    return;
  }
  if (action === "delete-project") {
    const p = lib.projects.find((p: any) => p.id === id);
    dialog(
      "移入回收站",
      `<p>「${escape(p.title)}」将保留7天。默认保留全局词句快照。</p><label><input id="delete-favorites" type="checkbox">到期永久删除时，同时删除该项目词句</label>${btn("confirm-delete", "移入回收站", 'class="danger"')}`,
    );
    $('[data-action="confirm-delete"]').onclick = async () => {
      p.deletedAt = now();
      p.deleteFavorites = $<HTMLInputElement>("#delete-favorites").checked;
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      view = "home";
      render();
    };
    return;
  }
  if (action === "restore-project") {
    lib.projects.find((p: any) => p.id === id).deletedAt = null;
    await commit();
    render();
    return;
  }
  if (action === "purge-project") {
    dialog(
      "永久删除",
      `<p>永久删除项目正文与结果，无法从回收站恢复。已选择保留的全局词句快照仍保留；图片文件清理需后续独立处理。</p>${btn("confirm-purge", "永久删除", 'class="danger"')}`,
    );
    $('[data-action="confirm-purge"]').onclick = async () => {
      purgeProject(lib, id!);
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      render();
    };
    return;
  }
  if (action === "import") {
    pickFiles();
    return;
  }
  if (action === "camera") {
    const asset = await platform.capture();
    if (asset) {
      p.pages.push({
        id: uid(),
        name: "相机照片",
        original: asset,
        current: asset,
        transforms: [],
        ocr: null,
      });
      await commit();
      pagesDialog();
    }
    return;
  }
  if (action === "pages") {
    pagesDialog();
    return;
  }
  if (action === "page-up" || action === "page-down") {
    const i = p.pages.findIndex((x: any) => x.id === id);
    const next = i + (action === "page-up" ? -1 : 1);
    if (i >= 0 && next >= 0 && next < p.pages.length)
      [p.pages[next], p.pages[i]] = [p.pages[i], p.pages[next]];
    await commit();
    pagesDialog();
    return;
  }
  if (action === "rotate-page") {
    await transformPage(id!);
    return;
  }
  if (action === "reset-page") {
    const pg = p.pages.find((x: any) => x.id === id);
    pg.current = pg.original;
    await commit();
    pagesDialog();
    return;
  }
  if (action === "crop-page") {
    const pg = p.pages.find((x: any) => x.id === id),
      img = new Image();
    img.src = await platform.readImage(pg.current.id);
    await img.decode();
    dialog(
      "裁切与轻增强",
      `<p>当前 ${img.naturalWidth} × ${img.naturalHeight} 像素。输入裁切框后先预览。</p><form id="crop-form"><div class="grid-2">${[
        ["x", 0],
        ["y", 0],
        ["w", img.naturalWidth],
        ["h", img.naturalHeight],
      ]
        .map(
          ([k, v]) =>
            `<label>${k}<input id="crop-${k}" type="number" min="0" value="${v}" required></label>`,
        )
        .join(
          "",
        )}</div><label>对比度<select id="contrast"><option value="1">原始</option><option value="1.15">轻增强</option><option value="1.3">较强增强</option></select></label><label>倾斜校正（度）<input id="fine-rotation" type="number" min="-15" max="15" step="0.1" value="0"></label><button class="primary">预览</button></form>`,
    );
    $("#crop-form").onsubmit = (e) => {
      e.preventDefault();
      transformPage(id!, Number($<HTMLInputElement>("#fine-rotation").value), {
        x: Number($<HTMLInputElement>("#crop-x").value),
        y: Number($<HTMLInputElement>("#crop-y").value),
        w: Number($<HTMLInputElement>("#crop-w").value),
        h: Number($<HTMLInputElement>("#crop-h").value),
        contrast: Number($<HTMLSelectElement>("#contrast").value),
      }).catch(showError);
    };
    return;
  }
  if (action === "ocr-page") {
    await ocrPage(id!);
    return;
  }
  if (action === "ocr-raw") {
    showOcrReview(
      p.pages.find((x: any) => x.id === id),
      p,
    );
    return;
  }
  if (action === "ocr-all") {
    if (ocrQueueBusy || ocrBusy) return;
    ocrQueueBusy = true;
    try {
      const generation = requests.generation;
      for (const page of p.pages.filter((x: any) => !x.ocr?.parsed)) {
        if (requests.generation !== generation || projectId !== p.id) break;
        await ocrPage(page.id, false);
      }
      if (projectId === p.id) {
        pagesDialog();
        toast("队列已结束；已完成页保留，请逐页核对原稿后导入");
      }
    } finally {
      ocrQueueBusy = false;
    }
    return;
  }
  if (action === "source") {
    showSource = !showSource;
    showPanel = true;
    render();
    return;
  }
  if (action === "explain-panel" || action === "book-panel") {
    panel = action === "book-panel" ? "book" : "explain";
    showPanel = true;
    cardIds = [];
    cardIndex = 0;
    render();
    return;
  }
  if (action === "close-panel") {
    showPanel = false;
    render();
    return;
  }
  if (action === "cancel") {
    cancel();
    if (native) platform.speak("").catch(showError);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    return;
  }
  if (action === "select-help") {
    toast("点一个词，或拖选部分字母/短语；选区会补齐首尾单词。");
    return;
  }
  if (action === "sentence") {
    if (!selected) throw Error("先选择一个词");
    const hit = resolveAnchor(lib, selected);
    if (hit.status !== "valid") throw Error("来源待重新定位");
    const s = sentenceRange(
      currentText(hit.paragraph),
      selected.start,
      selected.end,
    );
    choose(anchorFor(hit.project, hit.article, hit.paragraph, s.start, s.end));
    return;
  }
  if (action === "explain") {
    await controller.confirm();
    return;
  }
  if (["refresh", "structure", "followup", "answer"].includes(action)) {
    if (!selected) throw Error("先选择词句");
    if (action === "answer" && !getArticle()?.questionsVerified)
      throw Error("先核对题型与归属");
    if (requestBusy || queryState === "正在查询词句…") {
      toast("正在查询，请稍候");
      return;
    }
    stopRequests();
    const a = structuredClone(selected),
      task: Task = action === "refresh" ? "explain" : (action as Task),
      extra =
        action === "followup"
          ? $<HTMLTextAreaElement>("#followup").value.trim()
          : "";
    if (action === "followup" && !extra) throw Error("请输入追问");
    if (requestBusy) throw Error("正在处理当前请求");
    requestBusy = true;
    queryState = "正在查询词句…";
    const token = ++queryToken;
    renderPanel();
    try {
      const result = await runModel(
        task,
        a,
        undefined,
        extra,
        action === "refresh",
      );
      if (
        selected?.versionId === a.versionId &&
        selected?.start === a.start &&
        selected?.end === a.end
      ) {
        activeResult = result;
        renderPanel();
      }
    } finally {
      if (queryToken === token) {
        requestBusy = false;
        queryState = "";
        renderPanel();
      }
    }
    return;
  }
  if (action === "favorite") {
    if (!selected) throw Error("先选择词句");
    if (!activeResult?.data) throw Error("请先获得有效解释再收藏");
    saveFavorite(
      lib,
      selected,
      activeResult.userMeaning ?? activeResult.data.meaning_zh,
      activeResult.data.lemma || selected.quote.toLowerCase(),
    );
    await commit();
    renderPanel();
    toast("已收藏 · 项目与全局共享同一条记录");
    return;
  }
  if (action === "edit-meaning") {
    if (!activeResult?.data) throw Error("先获得解释");
    dialog(
      "修改释义",
      `<form id="meaning-form"><textarea id="meaning">${escape(activeResult.userMeaning ?? activeResult.data.meaning_zh)}</textarea><p>AI原稿独立保留。</p><button class="primary">保存</button></form>`,
    );
    $("#meaning-form").onsubmit = async (e) => {
      e.preventDefault();
      activeResult.userMeaning = $<HTMLTextAreaElement>("#meaning").value;
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      renderPanel();
    };
    return;
  }
  if (action === "speak" || action === "speak-sentence") {
    await speak(action === "speak-sentence");
    return;
  }
  if (action === "cancel-summary") {
    summaryRequests.cancel();
    $<HTMLDialogElement>("#dialog").close();
    return;
  }
  if (action === "summary") {
    dialog(
      "选择总结范围",
      `<p>正文未变化时直接打开已保存结果。</p><div class="menu">${btn("article-summary", "当前文章总结")}${btn("project-summary", "项目全部总结")}${btn("project-summaries", "查看已保存总结", `data-id="${projectId}"`)}</div>`,
    );
    updateSummaryButtons();
    return;
  }
  if (action === "article-summary" || action === "project-summary") {
    await summary(action === "project-summary");
    return;
  }
  if (action === "edit-article") {
    articleOrganization();
    return;
  }
  if (action === "paragraph-up" || action === "paragraph-down") {
    const ps = getArticle().paragraphs,
      i = ps.findIndex((p: any) => p.id === id),
      j = i + (action === "paragraph-up" ? -1 : 1);
    if (j >= 0 && j < ps.length) {
      [ps[i], ps[j]] = [ps[j], ps[i]];
      await commit();
      articleOrganization();
    }
    return;
  }
  if (action === "split-paragraph") {
    const pg = getArticle().paragraphs.find((p: any) => p.id === id),
      input = $<HTMLTextAreaElement>("#paragraph-text"),
      offset = input.selectionStart;
    try {
      if (input.value !== currentText(pg))
        throw Error("请先保存编辑，再设置拆分点");
      const next = splitParagraph(pg, offset, pg.currentVersion),
        ps = getArticle().paragraphs;
      ps.splice(ps.indexOf(pg) + 1, 0, next);
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      render();
    } catch (e) {
      showError(e);
    }
    return;
  }
  if (action === "edit-paragraph") {
    if (b.dataset.article) articleId = b.dataset.article;
    stopRequests();
    const a = getArticle(),
      pg = a.paragraphs.find((x: any) => x.id === id),
      version = pg.currentVersion;
    dialog(
      "编辑段落",
      `<form id="paragraph-form"><textarea id="paragraph-text" class="large-text">${escape(currentText(pg))}</textarea><p>保存为新正文版本；旧收藏保留原句快照，来源将待重新定位。</p><label>分区<select id="paragraph-kind">${["body", "question", "table", "caption"].map((k) => `<option ${pg.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label><button class="primary">保存新版本</button>${btn("split-paragraph", "在光标处拆分", `data-id="${pg.id}"`)}</form>`,
    );
    $("#paragraph-form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        editParagraph(
          pg,
          $<HTMLTextAreaElement>("#paragraph-text").value,
          version,
        );
        pg.kind = $<HTMLSelectElement>("#paragraph-kind").value;
        await commit();
        $<HTMLDialogElement>("#dialog").close();
        render();
      } catch (e) {
        showError(e);
      }
    };
    return;
  }
  if (action === "book-view") {
    bookList = !bookList;
    refreshBook();
    return;
  }
  if (action === "flip") {
    flipped = !flipped;
    refreshBook();
    return;
  }
  if (action === "next-round") {
    cardIds = reviewBatch(favorites(view === "global"), batchSize);
    cardIndex = 0;
    flipped = false;
    refreshBook();
    return;
  }
  if (action === "rate") {
    const f = lib.favorites.find((f: any) => f.id === id);
    f.rating = b.dataset.rating;
    f.reviews.push({ at: now(), rating: f.rating });
    await commit();
    cardIndex++;
    flipped = false;
    refreshBook();
    return;
  }
  if (action === "locate") {
    locateAnchor(lib.favorites.find((f: any) => f.id === id).anchor);
    return;
  }
  if (action === "edit-lemma") {
    const f = lib.favorites.find((f: any) => f.id === id);
    await nameDialog("基础词形（原词形不变）", f.lemma, async (name) => {
      f.lemma = name;
      await commit();
    });
    return;
  }
  if (action === "unfavorite") {
    const f = lib.favorites.find((f: any) => f.id === id),
      index = lib.favorites.indexOf(f);
    lib.favorites.splice(index, 1);
    await commit();
    refreshBook();
    toast("已取消收藏");
    dialog(
      "已取消收藏",
      `<p>${escape(f.original)} 已从项目与全局视图移除。</p>${btn("undo-favorite", "撤销")}`,
    );
    $('[data-action="undo-favorite"]').onclick = async () => {
      lib.favorites.push(f);
      await commit();
      $<HTMLDialogElement>("#dialog").close();
      refreshBook();
    };
    return;
  }
  if (action === "backup") {
    backupDialog();
    return;
  }
  if (action.startsWith("backup-")) {
    await exportBackup(action.endsWith("full"), action.includes("project"));
    return;
  }
  if (action === "restore-backup") {
    await restoreBackup();
    return;
  }
  if (action === "export-draft") {
    await platform.exportText(JSON.stringify(lib, null, 2), "json");
    return;
  }
  if (action === "export-book") {
    dialog(
      "导出词句",
      `<p>选择项目或当前全局视图中的收藏。</p>${["md", "txt", "json"].map((ext) => btn("do-export-book", ext.toUpperCase(), `data-id="${ext}"`)).join("")}`,
    );
    return;
  }
  if (action === "do-export-book") {
    const fs = favorites(view === "global");
    const text =
      id === "json"
        ? JSON.stringify(fs, null, 2)
        : fs
            .map(
              (f: any) =>
                `${id === "md" ? "## " : ""}${f.original}\n${f.meaning}\n${f.anchor.sentence.quote}\n来源：${f.anchor.projectTitle}\n`,
            )
            .join("\n");
    await platform.exportText(text, id!);
    toast("词句已导出");
    return;
  }
  if (action === "export-article") {
    dialog(
      "导出当前文章",
      `${["md", "txt", "html"].map((ext) => btn("do-export-article", ext.toUpperCase(), `data-id="${ext}"`)).join("")}`,
    );
    return;
  }
  if (action === "do-export-article") {
    const a = getArticle();
    const text =
      id === "html"
        ? `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(a.title)}</title><h1>${escape(a.title)}</h1>${a.paragraphs.map((p: any) => `<p>${escape(currentText(p))}</p>`).join("")}</html>`
        : `${id === "md" ? "# " : ""}${a.title}\n\n${a.paragraphs.map(currentText).join("\n\n")}`;
    await platform.exportText(text, id!);
    toast("文章已导出");
    return;
  }
  if (action === "usage") {
    dialog(
      "本机用量记录",
      `<p>仅记录供应商返回的真实 usage。取消或失败缺 usage 时为未知，不计为0；不设金额门槛。</p><div class="usage">${
        lib.tasks
          .slice()
          .reverse()
          .map(
            (t: any) =>
              `<section><strong>${escape(t.type)} · ${escape(t.status)}</strong><small>${escape(t.created)}</small><pre>${escape(t.usage ? JSON.stringify(t.usage, null, 2) : "用量未知 / 尚未返回")}</pre></section>`,
          )
          .join("") || "尚无请求"
      }</div>`,
    );
    return;
  }
  if (action === "more") {
    dialog(
      "更多工具",
      `<div class="menu">${
        toolbarItems
          .filter(([action]) => hiddenTools.has(action))
          .map(([action, title]) => toolButton(action, title, true))
          .join("") || "全部工具已展示在底部"
      }</div>`,
    );
    updateSummaryButtons();
    return;
  }
  if (action === "multi-analysis") {
    multiAnalysis();
    return;
  }
  if (action === "saved-summaries") {
    savedSummaries(false);
    return;
  }
  if (action === "open-saved-summary") {
    const r = lib.results.find((r: any) => r.id === id);
    showSummary(r);
    return;
  }
}
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "card-mode") {
    cardMode = el.value;
    flipped = false;
    refreshBook();
  }
  if (el.id === "hide-sentence") {
    hideSentence = el.checked;
    refreshBook();
  }
  if (el.id === "batch-size") {
    batchSize = Number(el.value);
    cardIds = [];
    cardIndex = 0;
    refreshBook();
  }
  if (el.classList.contains("verified-questions")) {
    const a = el.dataset.article
      ? getProject().articles.find((a: any) => a.id === el.dataset.article)
      : getArticle();
    a.questionsVerified = el.checked;
    document
      .querySelectorAll<HTMLInputElement>(
        `.verified-questions[data-article="${a.id}"]`,
      )
      .forEach((x) => (x.checked = el.checked));
    renderPanel();
    commit().catch(showError);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    suppressSelection = true;
    stopRequests();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (saveError) {
    e.preventDefault();
  }
});
render();
if (native) platform.reopen().then(load).catch(showError).finally(maybeGuide);
