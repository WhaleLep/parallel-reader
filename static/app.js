const elements = {
  sourceSelect: document.getElementById("source-select"),
  translationSelect: document.getElementById("translation-select"),
  swapButton: document.getElementById("swap-button"),
  openButton: document.getElementById("open-button"),
  toolbar: document.getElementById("reader-toolbar"),
  syncMode: document.getElementById("sync-mode"),
  mappingButton: document.getElementById("mapping-button"),
  resetMappingButton: document.getElementById("reset-mapping-button"),
  vocabularyButton: document.getElementById("vocabulary-button"),
  vocabularyAddButton: document.getElementById("vocabulary-add-button"),
  vocabularyDialog: document.getElementById("vocabulary-dialog"),
  vocabularyDocumentTitle: document.getElementById("vocabulary-document-title"),
  vocabularyList: document.getElementById("vocabulary-list"),
  closeVocabularyButton: document.getElementById("close-vocabulary-button"),
  clearVocabularyButton: document.getElementById("clear-vocabulary-button"),
  copyVocabularyButton: document.getElementById("copy-vocabulary-button"),
  alignmentStatus: document.getElementById("alignment-status"),
  message: document.getElementById("message"),
  reader: document.getElementById("reader"),
  sourceContent: document.getElementById("source-content"),
  translationContent: document.getElementById("translation-content"),
  sourceName: document.getElementById("source-name"),
  translationName: document.getElementById("translation-name"),
  temporaryInput: document.getElementById("temporary-input"),
  temporaryButton: document.getElementById("temporary-button"),
  uploadInput: document.getElementById("upload-input"),
  uploadButton: document.getElementById("upload-button"),
  manageButton: document.getElementById("manage-button"),
  manageDialog: document.getElementById("manage-dialog"),
  closeManageButton: document.getElementById("close-manage-button"),
  localDocumentList: document.getElementById("local-document-list"),
  collapseTopButton: document.getElementById("collapse-top-button"),
  restoreTopButton: document.getElementById("restore-top-button"),
  splitter: document.getElementById("splitter"),
};

const state = {
  documents: [],
  temporaryDocuments: [],
  pair: null,
  sourceBlocks: [],
  translationBlocks: [],
  mapping: {},
  reverseMapping: {},
  activeSource: 0,
  activeTranslation: 0,
  mappingMode: false,
  pendingSource: null,
  ignoreScrollUntil: { source: 0, translation: 0 },
  scrollFrames: { source: null, translation: null },
  progressTimer: null,
  restoredLastPair: false,
  pendingVocabulary: null,
  selectionTimer: null,
  vocabulary: { documentId: "", documentTitle: "", entries: [] },
};

const VOCABULARY_STORAGE_KEY = "parallel-reader:vocabulary-batch";

function showMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
}

function loadVocabulary() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(VOCABULARY_STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.entries)) return;
    state.vocabulary = {
      documentId: typeof saved.documentId === "string" ? saved.documentId : "",
      documentTitle: typeof saved.documentTitle === "string" ? saved.documentTitle : "",
      entries: saved.entries
        .filter((entry) => entry && typeof entry.word === "string" && typeof entry.sentence === "string")
        .map((entry) => ({
          id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
          word: entry.word,
          sentence: entry.sentence,
        })),
    };
  } catch {
    sessionStorage.removeItem(VOCABULARY_STORAGE_KEY);
  }
}

function saveVocabulary() {
  sessionStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(state.vocabulary));
  updateVocabularyButton();
}

function updateVocabularyButton() {
  const count = state.vocabulary.entries.length;
  elements.vocabularyButton.textContent = `生词篮（${count}）`;
  elements.copyVocabularyButton.disabled = count === 0;
  elements.clearVocabularyButton.disabled = count === 0;
}

function normalizeVisibleText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSelectedTerm(text) {
  return normalizeVisibleText(text).replace(
    /^[\s"'“”‘’()[\]{}<>.,;:!?…，。；：！？]+|[\s"'“”‘’()[\]{}<>.,;:!?…，。；：！？]+$/gu,
    "",
  );
}

function selectionElement(node) {
  return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

function sentenceContaining(text, selectionStart, selectionEnd) {
  if (!text) return "";
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en-US", { granularity: "sentence" });
    for (const part of segmenter.segment(text)) {
      const partEnd = part.index + part.segment.length;
      if (selectionStart < partEnd && selectionEnd > part.index) return normalizeVisibleText(part.segment);
    }
  }
  const matches = text.matchAll(/[^.!?]+(?:[.!?]+["')\]]*)?|[^.!?]+$/g);
  for (const match of matches) {
    const start = match.index || 0;
    const end = start + match[0].length;
    if (selectionStart < end && selectionEnd > start) return normalizeVisibleText(match[0]);
  }
  return normalizeVisibleText(text);
}

function vocabularyFromSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || state.mappingMode) return null;
  const range = selection.getRangeAt(0);
  const startElement = selectionElement(range.startContainer);
  const endElement = selectionElement(range.endContainer);
  if (!startElement || !endElement || !elements.sourceContent.contains(startElement) || !elements.sourceContent.contains(endElement)) {
    return null;
  }
  const startBlock = startElement.closest(".doc-block");
  const endBlock = endElement.closest(".doc-block");
  if (!startBlock || startBlock !== endBlock) return null;

  const word = normalizeSelectedTerm(selection.toString());
  if (!word || word.length > 160) return null;

  const contextSelector = "p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre";
  let context = startElement.closest(contextSelector);
  if (!context || !context.contains(endElement)) context = startBlock;
  const contextText = context.textContent || "";
  const before = range.cloneRange();
  before.selectNodeContents(context);
  before.setEnd(range.startContainer, range.startOffset);
  const selectionStart = before.toString().length;
  const selectionEnd = selectionStart + range.toString().length;
  const sourceItem = findDocument(state.pair?.source || elements.sourceSelect.value);

  return {
    word,
    sentence: sentenceContaining(contextText, selectionStart, selectionEnd),
    documentId: sourceItem?.path || state.pair?.source || elements.sourceSelect.value,
    documentTitle: sourceItem?.name || elements.sourceName.textContent || "未命名文档",
    rect: range.getBoundingClientRect(),
  };
}

function hideVocabularyAddButton(clearPending = true) {
  elements.vocabularyAddButton.classList.add("hidden");
  if (clearPending) state.pendingVocabulary = null;
}

function showVocabularyAddButton(candidate) {
  state.pendingVocabulary = candidate;
  const left = Math.max(74, Math.min(window.innerWidth - 74, candidate.rect.left + candidate.rect.width / 2));
  const top = Math.max(8, candidate.rect.top - 46);
  elements.vocabularyAddButton.style.left = `${left}px`;
  elements.vocabularyAddButton.style.top = `${top}px`;
  elements.vocabularyAddButton.classList.remove("hidden");
}

function refreshVocabularySelection() {
  const candidate = vocabularyFromSelection();
  if (candidate) showVocabularyAddButton(candidate);
  else hideVocabularyAddButton();
}

function scheduleVocabularySelection() {
  clearTimeout(state.selectionTimer);
  state.selectionTimer = setTimeout(refreshVocabularySelection, 80);
}

function addPendingVocabulary() {
  const candidate = state.pendingVocabulary;
  if (!candidate) return;
  if (state.vocabulary.documentId && state.vocabulary.documentId !== candidate.documentId) {
    state.vocabulary = { documentId: candidate.documentId, documentTitle: candidate.documentTitle, entries: [] };
  }
  if (!state.vocabulary.documentId) {
    state.vocabulary.documentId = candidate.documentId;
    state.vocabulary.documentTitle = candidate.documentTitle;
  }
  const duplicate = state.vocabulary.entries.some(
    (entry) => entry.word.toLocaleLowerCase() === candidate.word.toLocaleLowerCase() && entry.sentence === candidate.sentence,
  );
  if (duplicate) {
    showMessage(`“${candidate.word}”已经在本次生词篮中。`, false);
  } else {
    state.vocabulary.entries.push({ id: crypto.randomUUID(), word: candidate.word, sentence: candidate.sentence });
    saveVocabulary();
    showMessage(`已将“${candidate.word}”加入生词篮。`, false);
  }
  window.getSelection()?.removeAllRanges();
  hideVocabularyAddButton();
}

function renderVocabulary() {
  const entries = state.vocabulary.entries;
  elements.vocabularyDocumentTitle.textContent = entries.length
    ? state.vocabulary.documentTitle
    : "尚未采集生词";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-vocabulary";
    empty.textContent = "在英文原文中选中单词或短语，即可加入本次生词篮。";
    elements.vocabularyList.replaceChildren(empty);
    updateVocabularyButton();
    return;
  }

  const fragment = document.createDocumentFragment();
  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "vocabulary-row";
    const number = document.createElement("span");
    number.className = "vocabulary-number";
    number.textContent = String(index + 1);
    const fields = document.createElement("div");
    fields.className = "vocabulary-fields";
    const word = document.createElement("input");
    word.type = "text";
    word.value = entry.word;
    word.setAttribute("aria-label", `第 ${index + 1} 条生词`);
    word.addEventListener("input", () => {
      entry.word = word.value;
      saveVocabulary();
    });
    const sentence = document.createElement("textarea");
    sentence.rows = 2;
    sentence.value = entry.sentence;
    sentence.setAttribute("aria-label", `第 ${index + 1} 条原句`);
    sentence.addEventListener("input", () => {
      entry.sentence = sentence.value;
      saveVocabulary();
    });
    fields.append(word, sentence);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary vocabulary-remove";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      state.vocabulary.entries = state.vocabulary.entries.filter((item) => item.id !== entry.id);
      if (!state.vocabulary.entries.length) state.vocabulary = { documentId: "", documentTitle: "", entries: [] };
      saveVocabulary();
      renderVocabulary();
    });
    row.append(number, fields, remove);
    fragment.appendChild(row);
  });
  elements.vocabularyList.replaceChildren(fragment);
  updateVocabularyButton();
}

function buildVocabularyPrompt() {
  const items = state.vocabulary.entries.map((entry, index) => (
    `${index + 1}. word: ${entry.word.trim()}\n   sentence: ${entry.sentence.trim()}`
  )).join("\n\n");
  return `我正在通过英文技术文档学习英语。下面是我本次阅读遇到的生词。\n\n文档：${state.vocabulary.documentTitle}\n\n${items}\n\n请按照下面规则带我学习：\n\n1. 按列表顺序处理，一次只学习一个词，不要一次讲解所有单词。\n2. 根据当前句子，用简单中文解释这个词在这里的准确含义和语气。\n3. 告诉我为什么作者用这个词，以及删掉它后意思有什么变化。\n4. 给我 3 个最常见的搭配或句型。\n5. 给我 5 个程序员或技术文档场景中的例句。\n6. 告诉我 2～3 个容易混淆的近义词，并解释区别。\n7. 然后停止讲解，开始测试我：一次给我一道题，让我主动使用这个词；根据我的答案纠正，再出下一题。不要提前展示答案。\n8. 当前单词完成后，询问我是否开始下一个词。\n\n目标不是让我记住中文翻译，而是让我以后读到它能直接理解，并且能够自己使用。\n\n现在从第一个词开始。`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器不允许访问剪贴板");
}

async function copyVocabularyPrompt() {
  if (!state.vocabulary.entries.length) return;
  try {
    await copyText(buildVocabularyPrompt());
    showMessage(`已复制 ${state.vocabulary.entries.length} 条生词的完整学习提示词。`, false);
  } catch (error) {
    showMessage(`复制失败：${error.message}`, true);
  }
}

function setTopCollapsed(collapsed) {
  document.body.classList.toggle("top-collapsed", collapsed);
  elements.restoreTopButton.classList.toggle("hidden", !collapsed);
}

function applySplitRatio(ratio, persist = true) {
  const bounded = Math.max(0.25, Math.min(0.75, Number(ratio) || 0.5));
  elements.reader.style.setProperty("--source-width", `${bounded * 100}%`);
  elements.splitter.setAttribute("aria-valuenow", String(Math.round(bounded * 100)));
  if (persist) localStorage.setItem("parallel-reader:split-ratio", String(bounded));
}

function handleSplitterPointerDown(event) {
  if (matchMedia("(max-width: 760px)").matches) return;
  elements.splitter.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing");
}

function handleSplitterPointerMove(event) {
  if (!elements.splitter.hasPointerCapture(event.pointerId)) return;
  const rect = elements.reader.getBoundingClientRect();
  applySplitRatio((event.clientX - rect.left) / rect.width, false);
}

function finishSplitterResize(event) {
  if (elements.splitter.hasPointerCapture(event.pointerId)) {
    elements.splitter.releasePointerCapture(event.pointerId);
  }
  document.body.classList.remove("resizing");
  applySplitRatio(parseFloat(elements.splitter.getAttribute("aria-valuenow")) / 100, true);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function documentLabel(item) {
  if (!item) return "未知文档";
  const origin = item.origin === "temporary" ? "临时" : item.origin === "local" ? "书库" : "只读";
  return `${origin} · ${item.display_path.replace(/\.md$/i, "")}`;
}

function availableDocuments() {
  return [...state.temporaryDocuments, ...state.documents];
}

function findDocument(identifier) {
  return availableDocuments().find((item) => item.path === identifier);
}

function normalizeSavedIdentifier(identifier) {
  if (!identifier || identifier.startsWith("readonly:") || identifier.startsWith("local:")) return identifier;
  if (identifier.startsWith("wiki:")) return `readonly:${identifier.slice(5)}`;
  return `readonly:${identifier}`;
}

function populateDocuments() {
  const documents = availableDocuments();
  for (const select of [elements.sourceSelect, elements.translationSelect]) {
    const current = select.value;
    select.replaceChildren(new Option("选择 Markdown 文档", ""));
    for (const item of documents) {
      select.add(new Option(documentLabel(item), item.path));
    }
    if (documents.some((item) => item.path === current)) select.value = current;
  }
  if (!state.restoredLastPair) {
    const saved = JSON.parse(localStorage.getItem("parallel-reader:last-pair") || "null");
    const savedSource = normalizeSavedIdentifier(saved?.source);
    const savedTranslation = normalizeSavedIdentifier(saved?.translation);
    if (savedSource && state.documents.some((item) => item.path === savedSource)) {
      elements.sourceSelect.value = savedSource;
    }
    if (savedTranslation && state.documents.some((item) => item.path === savedTranslation)) {
      elements.translationSelect.value = savedTranslation;
    }
    state.restoredLastPair = true;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function renderLocalDocuments() {
  const localDocuments = state.documents.filter((item) => item.origin === "local");
  if (!localDocuments.length) {
    elements.localDocumentList.innerHTML = '<div class="empty-local">还没有导入本地 Markdown</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of localDocuments) {
    const row = document.createElement("div");
    row.className = "local-document-row";
    const info = document.createElement("div");
    info.className = "document-info";
    const name = document.createElement("strong");
    name.textContent = item.display_path;
    const details = document.createElement("small");
    details.textContent = `${formatSize(item.size)} · ${new Date(item.modified_at * 1000).toLocaleString()}`;
    info.append(name, details);
    const renameButton = document.createElement("button");
    renameButton.className = "secondary";
    renameButton.type = "button";
    renameButton.textContent = "改名";
    renameButton.addEventListener("click", () => renameLocalDocument(item));
    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteLocalDocument(item));
    row.append(info, renameButton, deleteButton);
    fragment.appendChild(row);
  }
  elements.localDocumentList.replaceChildren(fragment);
}

async function refreshDocuments() {
  const source = elements.sourceSelect.value;
  const translation = elements.translationSelect.value;
  const payload = await requestJson("api/documents");
  state.documents = payload.documents || [];
  populateDocuments();
  if (findDocument(source)) elements.sourceSelect.value = source;
  if (findDocument(translation)) elements.translationSelect.value = translation;
  renderLocalDocuments();
}

async function readTemporaryFile(file) {
  if (!file.name.toLowerCase().endsWith(".md")) throw new Error(`${file.name} 不是 Markdown 文件`);
  if (!file.size) throw new Error(`${file.name} 是空文件`);
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} 超过 10 MiB`);
  const bytes = await file.arrayBuffer();
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${file.name} 必须使用 UTF-8 编码`);
  }
  return {
    path: `temporary:${crypto.randomUUID()}`,
    name: file.name.replace(/\.md$/i, ""),
    origin: "temporary",
    display_path: file.name,
    modified_at: Math.floor(file.lastModified / 1000),
    size: file.size,
    content,
  };
}

async function openTemporaryDocuments(files) {
  const selected = [...files];
  if (!selected.length) return;
  if (selected.length > 2) return showMessage("临时阅读一次最多选择两个 Markdown 文件。", true);
  elements.temporaryButton.disabled = true;
  try {
    showMessage("正在本地读取临时 Markdown……");
    const temporaryDocuments = await Promise.all(selected.map(readTemporaryFile));
    state.temporaryDocuments = temporaryDocuments;
    populateDocuments();
    if (temporaryDocuments[0]) elements.sourceSelect.value = temporaryDocuments[0].path;
    if (temporaryDocuments[1]) elements.translationSelect.value = temporaryDocuments[1].path;
    if (temporaryDocuments.length === 2) {
      await openPair();
    } else {
      showMessage("临时文件已载入当前页面。请选择另一篇文档后开始对照。", false);
    }
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.temporaryButton.disabled = false;
    elements.temporaryInput.value = "";
  }
}

async function uploadDocuments(files) {
  const markdownFiles = [...files].filter((file) => file.name.toLowerCase().endsWith(".md"));
  if (!markdownFiles.length) return showMessage("请选择 .md 文件。", true);
  const uploaded = [];
  elements.uploadButton.disabled = true;
  try {
    for (const file of markdownFiles) {
      if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} 超过 10 MiB`);
      const identifier = `local:${file.name}`;
      const exists = state.documents.some((item) => item.path === identifier);
      if (exists && !confirm(`本地文档“${file.name}”已存在，是否覆盖？`)) continue;
      showMessage(`正在导入 ${file.name}……`);
      const result = await requestJson(
        `api/local-document?name=${encodeURIComponent(file.name)}&overwrite=${exists ? "1" : "0"}`,
        { method: "PUT", headers: { "Content-Type": "text/markdown; charset=utf-8" }, body: file },
      );
      uploaded.push(result.path);
    }
    await refreshDocuments();
    if (uploaded[0]) elements.sourceSelect.value = uploaded[0];
    if (uploaded[1]) elements.translationSelect.value = uploaded[1];
    showMessage(uploaded.length ? `已导入 ${uploaded.length} 个本地 Markdown。` : "没有覆盖现有文档。", false);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.uploadButton.disabled = false;
    elements.uploadInput.value = "";
  }
}

async function renameLocalDocument(item) {
  let newName = prompt("请输入新的 Markdown 文件名", item.display_path);
  if (newName === null) return;
  newName = newName.trim();
  if (newName && !newName.toLowerCase().endsWith(".md")) newName += ".md";
  try {
    await requestJson("api/local-document", {
      method: "PATCH",
      body: JSON.stringify({ path: item.path, name: newName }),
    });
    await refreshDocuments();
    showMessage(`已改名为 ${newName}。`, false);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function deleteLocalDocument(item) {
  if (!confirm(`确定永久删除本地文档“${item.display_path}”吗？相关的阅读进度和段落对应也会删除。`)) return;
  try {
    await requestJson(`api/local-document?path=${encodeURIComponent(item.path)}`, { method: "DELETE" });
    if (state.pair && (state.pair.source === item.path || state.pair.translation === item.path)) {
      state.pair = null;
      setTopCollapsed(false);
      elements.reader.classList.add("hidden");
      elements.toolbar.classList.add("hidden");
    }
    await refreshDocuments();
    showMessage(`已删除 ${item.display_path}。`, false);
  } catch (error) {
    showMessage(error.message, true);
  }
}

function isFence(line) {
  return line.match(/^\s*(`{3,}|~{3,})(.*)$/);
}

function isHeading(line) {
  return line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
}

function isList(line) {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

function isQuote(line) {
  return /^\s*>/.test(line);
}

function isRule(line) {
  return /^\s{0,3}(?:([-*_])\s*){3,}$/.test(line);
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function startsBlock(lines, index) {
  const line = lines[index] || "";
  return Boolean(
    isFence(line) || isHeading(line) || isList(line) || isQuote(line) || isRule(line) ||
    (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1]))
  );
}

function parseMarkdownBlocks(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  if (lines[0]?.trim() === "---") {
    let end = 1;
    while (end < lines.length && lines[end].trim() !== "---") end += 1;
    if (end < lines.length) {
      blocks.push({ type: "metadata", raw: lines.slice(0, end + 1).join("\n") });
      index = end + 1;
    }
  }

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const fence = isFence(lines[index]);
    if (fence) {
      const marker = fence[1][0];
      const size = fence[1].length;
      let end = index + 1;
      const closing = new RegExp(`^\\s*${marker}{${size},}\\s*$`);
      while (end < lines.length && !closing.test(lines[end])) end += 1;
      if (end < lines.length) end += 1;
      blocks.push({ type: "code", raw: lines.slice(index, end).join("\n") });
      index = end;
      continue;
    }

    const heading = isHeading(lines[index]);
    if (heading) {
      blocks.push({ type: `heading-${heading[1].length}`, raw: lines[index] });
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && lines[index].includes("|") && isTableSeparator(lines[index + 1])) {
      let end = index + 2;
      while (end < lines.length && lines[end].trim() && lines[end].includes("|")) end += 1;
      blocks.push({ type: "table", raw: lines.slice(index, end).join("\n") });
      index = end;
      continue;
    }

    if (isQuote(lines[index])) {
      let end = index + 1;
      while (end < lines.length && (isQuote(lines[end]) || (lines[end].trim() && /^\s{2,}/.test(lines[end])))) end += 1;
      blocks.push({ type: "quote", raw: lines.slice(index, end).join("\n") });
      index = end;
      continue;
    }

    if (isList(lines[index])) {
      let end = index + 1;
      while (end < lines.length && lines[end].trim() && (isList(lines[end]) || /^\s{2,}/.test(lines[end]))) end += 1;
      blocks.push({ type: "list", raw: lines.slice(index, end).join("\n") });
      index = end;
      continue;
    }

    if (isRule(lines[index])) {
      blocks.push({ type: "rule", raw: lines[index] });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < lines.length && lines[end].trim() && !startsBlock(lines, end)) end += 1;
    blocks.push({ type: "paragraph", raw: lines.slice(index, end).join("\n") });
    index = end;
  }

  return blocks;
}

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,iframe,object,embed,style,link,meta,base").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
        node.removeAttribute(attribute.name);
      }
    }
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return template.innerHTML;
}

function renderBlock(block) {
  if (block.type === "metadata") {
    const escaped = block.raw.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
    return `<details><summary>文档信息</summary><pre><code>${escaped}</code></pre></details>`;
  }
  return sanitizeHtml(marked.parse(block.raw, { gfm: true, breaks: false }));
}

function renderDocument(container, blocks, side) {
  const fragment = document.createDocumentFragment();
  blocks.forEach((block, index) => {
    const section = document.createElement("section");
    section.className = `doc-block block-${block.type}`;
    section.dataset.index = String(index);
    section.dataset.side = side;
    section.innerHTML = renderBlock(block);
    fragment.appendChild(section);
  });
  container.replaceChildren(fragment);
}

function typeGroup(type) {
  if (type.startsWith("heading-")) return "heading";
  if (["paragraph", "quote", "list"].includes(type)) return "text";
  return type;
}

function matchCost(source, target) {
  const sourceGroup = typeGroup(source.type);
  const targetGroup = typeGroup(target.type);
  let cost;
  if (source.type === target.type) cost = 0;
  else if (sourceGroup === targetGroup) cost = sourceGroup === "heading" ? 0.35 : 0.45;
  else cost = 1.7;
  const sourceLength = Math.max(1, source.raw.length);
  const targetLength = Math.max(1, target.raw.length);
  cost += Math.min(1.2, Math.abs(Math.log(sourceLength / targetLength))) * 0.12;
  return cost;
}

function completeMapping(mapping, sourceCount, targetCount) {
  if (!sourceCount || !targetCount) return {};
  const anchors = Object.entries(mapping)
    .map(([source, target]) => [Number(source), Number(target)])
    .filter(([source, target]) => source >= 0 && source < sourceCount && target >= 0 && target < targetCount)
    .sort((a, b) => a[0] - b[0]);
  const completed = Object.fromEntries(anchors);

  for (let source = 0; source < sourceCount; source += 1) {
    if (completed[source] !== undefined) continue;
    let previous = null;
    let next = null;
    for (const anchor of anchors) {
      if (anchor[0] < source) previous = anchor;
      if (anchor[0] > source) {
        next = anchor;
        break;
      }
    }
    let target;
    if (previous && next) {
      const progress = (source - previous[0]) / (next[0] - previous[0]);
      target = Math.round(previous[1] + progress * (next[1] - previous[1]));
    } else if (previous) {
      target = previous[1] + source - previous[0];
    } else if (next) {
      target = next[1] - (next[0] - source);
    } else {
      target = Math.round(source * Math.max(0, targetCount - 1) / Math.max(1, sourceCount - 1));
    }
    completed[source] = Math.max(0, Math.min(targetCount - 1, target));
  }
  return completed;
}

function alignBlocks(sourceBlocks, targetBlocks) {
  const sourceCount = sourceBlocks.length;
  const targetCount = targetBlocks.length;
  if (!sourceCount || !targetCount) return {};
  if (sourceCount === targetCount) return Object.fromEntries(sourceBlocks.map((_, index) => [index, index]));
  if (sourceCount * targetCount > 2_000_000) return completeMapping({}, sourceCount, targetCount);

  const columns = targetCount + 1;
  const operations = new Uint8Array((sourceCount + 1) * columns);
  let previous = new Float64Array(columns);
  for (let target = 1; target <= targetCount; target += 1) previous[target] = target * 0.9;

  for (let source = 1; source <= sourceCount; source += 1) {
    const current = new Float64Array(columns);
    current[0] = source * 0.9;
    operations[source * columns] = 2;
    for (let target = 1; target <= targetCount; target += 1) {
      const matched = previous[target - 1] + matchCost(sourceBlocks[source - 1], targetBlocks[target - 1]);
      const skippedSource = previous[target] + 0.9;
      const skippedTarget = current[target - 1] + 0.9;
      if (matched <= skippedSource && matched <= skippedTarget) {
        current[target] = matched;
        operations[source * columns + target] = 1;
      } else if (skippedSource <= skippedTarget) {
        current[target] = skippedSource;
        operations[source * columns + target] = 2;
      } else {
        current[target] = skippedTarget;
        operations[source * columns + target] = 3;
      }
    }
    previous = current;
  }

  const mapping = {};
  let source = sourceCount;
  let target = targetCount;
  while (source > 0 || target > 0) {
    const operation = operations[source * columns + target];
    if (operation === 1) {
      mapping[source - 1] = target - 1;
      source -= 1;
      target -= 1;
    } else if (operation === 2 || target === 0) {
      source -= 1;
    } else {
      target -= 1;
    }
  }
  return completeMapping(mapping, sourceCount, targetCount);
}

function buildReverseMapping() {
  const reverse = {};
  for (const [source, target] of Object.entries(state.mapping)) {
    if (reverse[target] === undefined) reverse[target] = Number(source);
  }
  state.reverseMapping = completeMapping(reverse, state.translationBlocks.length, state.sourceBlocks.length);
}

function clearHighlights() {
  document.querySelectorAll(".doc-block.active,.doc-block.mapping-source").forEach((node) => {
    node.classList.remove("active", "mapping-source");
  });
}

function blockElement(side, index) {
  const container = side === "source" ? elements.sourceContent : elements.translationContent;
  return container.querySelector(`.doc-block[data-index="${index}"]`);
}

function scrollToBlock(side, index, behavior = "smooth") {
  const container = side === "source" ? elements.sourceContent : elements.translationContent;
  const target = blockElement(side, index);
  if (!target) return;
  state.ignoreScrollUntil[side] = Date.now() + (behavior === "smooth" ? 700 : 100);
  container.scrollTo({ top: Math.max(0, target.offsetTop - container.clientHeight * 0.27), behavior });
}

function activateFrom(side, index, shouldScroll = true) {
  const numericIndex = Number(index);
  let sourceIndex;
  let translationIndex;
  if (side === "source") {
    sourceIndex = numericIndex;
    translationIndex = Number(state.mapping[sourceIndex] ?? 0);
  } else {
    translationIndex = numericIndex;
    sourceIndex = Number(state.reverseMapping[translationIndex] ?? 0);
  }
  state.activeSource = sourceIndex;
  state.activeTranslation = translationIndex;
  document.querySelectorAll(".doc-block.active").forEach((node) => node.classList.remove("active"));
  blockElement("source", sourceIndex)?.classList.add("active");
  blockElement("translation", translationIndex)?.classList.add("active");
  if (shouldScroll && elements.syncMode.value === "jump") {
    scrollToBlock(side === "source" ? "translation" : "source", side === "source" ? translationIndex : sourceIndex);
  }
  scheduleProgressSave();
}

function findReadingBlock(container) {
  const blocks = [...container.querySelectorAll(".doc-block")];
  if (!blocks.length) return 0;
  const readingLine = container.getBoundingClientRect().top + container.clientHeight * 0.28;
  let selected = blocks[0];
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.top <= readingLine) selected = block;
    if (rect.bottom >= readingLine) {
      selected = block;
      break;
    }
  }
  return Number(selected.dataset.index);
}

function handleScroll(side) {
  if (state.scrollFrames[side]) cancelAnimationFrame(state.scrollFrames[side]);
  state.scrollFrames[side] = requestAnimationFrame(() => {
    state.scrollFrames[side] = null;
    if (Date.now() < state.ignoreScrollUntil[side]) return;
    const container = side === "source" ? elements.sourceContent : elements.translationContent;
    const index = findReadingBlock(container);
    const current = side === "source" ? state.activeSource : state.activeTranslation;
    if (index !== current) activateFrom(side, index, elements.syncMode.value === "jump");
  });
}

async function saveMapping() {
  if (!state.pair || state.pair.temporary) return;
  await requestJson(`api/pairs/${state.pair.id}/mapping`, {
    method: "PUT",
    body: JSON.stringify({ mapping: state.mapping }),
  });
}

function scheduleProgressSave() {
  clearTimeout(state.progressTimer);
  state.progressTimer = setTimeout(async () => {
    if (!state.pair || state.pair.temporary) return;
    try {
      await requestJson(`api/pairs/${state.pair.id}/progress`, {
        method: "PUT",
        body: JSON.stringify({
          source_block: state.activeSource,
          translation_block: state.activeTranslation,
        }),
      });
    } catch {}
  }, 700);
}

function updateAlignmentStatus() {
  const sourceCount = state.sourceBlocks.length;
  const targetCount = state.translationBlocks.length;
  const difference = Math.abs(sourceCount - targetCount);
  elements.alignmentStatus.textContent = difference
    ? `原文 ${sourceCount} 块 · 译文 ${targetCount} 块 · 建议检查对应`
    : `已自动对应 ${sourceCount} 个内容块`;
}

function setMappingMode(enabled) {
  state.mappingMode = enabled;
  state.pendingSource = null;
  elements.reader.classList.toggle("mapping-mode", enabled);
  elements.mappingButton.textContent = enabled ? "完成调整" : "调整对应";
  document.querySelectorAll(".doc-block.mapping-source").forEach((node) => node.classList.remove("mapping-source"));
  showMessage(enabled ? "调整模式：先点击左侧原文段落，再点击右侧对应译文。" : "段落对应已保存。点击任一段落可联动高亮。", false);
}

async function handleBlockClick(event) {
  const block = event.target.closest(".doc-block");
  if (!block || !state.pair) return;
  if (!state.mappingMode && window.getSelection()?.toString().trim()) return;
  const side = block.dataset.side;
  const index = Number(block.dataset.index);
  if (!state.mappingMode) {
    activateFrom(side, index, true);
    return;
  }
  if (side === "source") {
    state.pendingSource = index;
    document.querySelectorAll(".doc-block.mapping-source").forEach((node) => node.classList.remove("mapping-source"));
    block.classList.add("mapping-source");
    showMessage(`已选择原文第 ${index + 1} 块，请点击右侧对应译文。`);
    return;
  }
  if (state.pendingSource === null) {
    showMessage("请先点击左侧需要调整的原文段落。", true);
    return;
  }
  state.mapping[state.pendingSource] = index;
  buildReverseMapping();
  activateFrom("source", state.pendingSource, false);
  const sourceNumber = state.pendingSource + 1;
  state.pendingSource = null;
  document.querySelectorAll(".doc-block.mapping-source").forEach((node) => node.classList.remove("mapping-source"));
  try {
    await saveMapping();
    showMessage(`原文第 ${sourceNumber} 块已对应到译文第 ${index + 1} 块。可以继续调整。`);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function openPair() {
  const source = elements.sourceSelect.value;
  const translation = elements.translationSelect.value;
  if (!source || !translation) return showMessage("请先选择英文原文和中文译文。", true);
  if (source === translation) return showMessage("请选择两个不同的 Markdown 文档。", true);
  elements.openButton.disabled = true;
  hideVocabularyAddButton();
  showMessage("正在读取并对齐文档……");
  try {
    const sourceItem = findDocument(source);
    const translationItem = findDocument(translation);
    const isTemporary = sourceItem?.origin === "temporary" || translationItem?.origin === "temporary";
    const readDocument = (item) => item.origin === "temporary"
      ? Promise.resolve({ path: item.path, content: item.content })
      : requestJson(`api/document?path=${encodeURIComponent(item.path)}`);
    const openPersistentPair = () => requestJson("api/pairs/open", {
      method: "POST",
      body: JSON.stringify({ source, translation }),
    });
    const [sourceDocument, translationDocument, pair] = await Promise.all([
      readDocument(sourceItem),
      readDocument(translationItem),
      isTemporary
        ? Promise.resolve({ temporary: true, source, translation, mapping: {}, progress: {} })
        : openPersistentPair(),
    ]);
    state.pair = pair;
    state.sourceBlocks = parseMarkdownBlocks(sourceDocument.content);
    state.translationBlocks = parseMarkdownBlocks(translationDocument.content);
    const savedMapping = pair.mapping && Object.keys(pair.mapping).length ? pair.mapping : null;
    state.mapping = savedMapping || alignBlocks(state.sourceBlocks, state.translationBlocks);
    state.mapping = completeMapping(state.mapping, state.sourceBlocks.length, state.translationBlocks.length);
    buildReverseMapping();
    renderDocument(elements.sourceContent, state.sourceBlocks, "source");
    renderDocument(elements.translationContent, state.translationBlocks, "translation");
    elements.sourceName.textContent = documentLabel(sourceItem);
    elements.translationName.textContent = documentLabel(translationItem);
    elements.reader.classList.remove("hidden");
    elements.toolbar.classList.remove("hidden");
    updateAlignmentStatus();
    if (!savedMapping) await saveMapping();
    const sourceProgress = Math.min(Number(pair.progress?.source_block || 0), Math.max(0, state.sourceBlocks.length - 1));
    const translationProgress = Math.min(Number(pair.progress?.translation_block || 0), Math.max(0, state.translationBlocks.length - 1));
    state.activeSource = sourceProgress;
    state.activeTranslation = translationProgress;
    requestAnimationFrame(() => {
      scrollToBlock("source", sourceProgress, "auto");
      scrollToBlock("translation", translationProgress, "auto");
      activateFrom("source", sourceProgress, false);
    });
    if (!isTemporary) localStorage.setItem("parallel-reader:last-pair", JSON.stringify({ source, translation }));
    showMessage(
      isTemporary
        ? "临时阅读：文件、进度和段落对应只存在于当前页面，关闭或刷新后消失。"
        : "点击或选中任一段落可联动高亮；滚动时按段落跳转同步。",
      false,
    );
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.openButton.disabled = false;
  }
}

async function initialize() {
  if (!window.marked) return showMessage("Markdown 渲染组件加载失败。", true);
  try {
    await refreshDocuments();
    showMessage(state.documents.length ? `找到 ${state.documents.length} 个 Markdown 文档，请选择原文和译文。` : "还没有可读的 Markdown 文档。", false);
  } catch (error) {
    showMessage(error.message, true);
  }
}

elements.openButton.addEventListener("click", openPair);
elements.collapseTopButton.addEventListener("click", () => setTopCollapsed(true));
elements.restoreTopButton.addEventListener("click", () => setTopCollapsed(false));
elements.splitter.addEventListener("pointerdown", handleSplitterPointerDown);
elements.splitter.addEventListener("pointermove", handleSplitterPointerMove);
elements.splitter.addEventListener("pointerup", finishSplitterResize);
elements.splitter.addEventListener("pointercancel", finishSplitterResize);
elements.splitter.addEventListener("dblclick", () => applySplitRatio(0.5));
elements.splitter.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const current = parseFloat(elements.splitter.getAttribute("aria-valuenow")) / 100;
  applySplitRatio(current + (event.key === "ArrowLeft" ? -0.02 : 0.02));
});
elements.temporaryButton.addEventListener("click", () => elements.temporaryInput.click());
elements.temporaryInput.addEventListener("change", () => openTemporaryDocuments(elements.temporaryInput.files));
elements.uploadButton.addEventListener("click", () => elements.uploadInput.click());
elements.uploadInput.addEventListener("change", () => uploadDocuments(elements.uploadInput.files));
elements.manageButton.addEventListener("click", () => {
  renderLocalDocuments();
  elements.manageDialog.showModal();
});
elements.closeManageButton.addEventListener("click", () => elements.manageDialog.close());
elements.swapButton.addEventListener("click", () => {
  const source = elements.sourceSelect.value;
  elements.sourceSelect.value = elements.translationSelect.value;
  elements.translationSelect.value = source;
});
elements.mappingButton.addEventListener("click", () => setMappingMode(!state.mappingMode));
elements.vocabularyButton.addEventListener("click", () => {
  renderVocabulary();
  elements.vocabularyDialog.showModal();
});
elements.closeVocabularyButton.addEventListener("click", () => elements.vocabularyDialog.close());
elements.copyVocabularyButton.addEventListener("click", copyVocabularyPrompt);
elements.clearVocabularyButton.addEventListener("click", () => {
  if (!state.vocabulary.entries.length || !confirm("确定清空本次生词篮吗？")) return;
  state.vocabulary = { documentId: "", documentTitle: "", entries: [] };
  saveVocabulary();
  renderVocabulary();
  showMessage("已清空本次生词篮。", false);
});
elements.vocabularyAddButton.addEventListener("pointerdown", (event) => event.preventDefault());
elements.vocabularyAddButton.addEventListener("click", addPendingVocabulary);
elements.resetMappingButton.addEventListener("click", async () => {
  if (!state.pair || !confirm("重新自动对应会覆盖手动调整，确定继续吗？")) return;
  state.mapping = alignBlocks(state.sourceBlocks, state.translationBlocks);
  buildReverseMapping();
  try {
    await saveMapping();
    setMappingMode(false);
    activateFrom("source", state.activeSource, false);
    showMessage("已经根据当前文档结构重新自动对应。", false);
  } catch (error) {
    showMessage(error.message, true);
  }
});
elements.sourceContent.addEventListener("click", handleBlockClick);
elements.translationContent.addEventListener("click", handleBlockClick);
elements.sourceContent.addEventListener("scroll", () => handleScroll("source"), { passive: true });
elements.translationContent.addEventListener("scroll", () => handleScroll("translation"), { passive: true });
document.addEventListener("selectionchange", scheduleVocabularySelection);
window.addEventListener("resize", () => hideVocabularyAddButton());

loadVocabulary();
updateVocabularyButton();
applySplitRatio(parseFloat(localStorage.getItem("parallel-reader:split-ratio")) || 0.5, false);
initialize();
