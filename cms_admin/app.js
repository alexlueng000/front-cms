// ===== Utilities =====
const $ = (id) => document.getElementById(id);
const toast = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("show"), 1800);
};

const state = {
  current: null,
  dirty: false,
  allFiles: [],
};

function setSavedState(kind) {
  const el = $("saveState");
  const dot = $("statusDot");
  if (kind === "ok") {
    el.textContent = "已保存";
    el.style.color = "#16a34a";
    dot.className = "status-dot status-ok";
  } else if (kind === "dirty") {
    el.textContent = "未保存";
    el.style.color = "#d97706";
    dot.className = "status-dot status-dirty";
  } else if (kind === "busy") {
    el.textContent = "保存中…";
    el.style.color = "#2563eb";
    dot.className = "status-dot status-busy";
  }
}

function setEditorBytes() {
  const len = new Blob([$("editor").value || ""]).size;
  $("byteInfo").textContent = `${len} 字节`;
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `${r.status} ${r.statusText}`);
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}

// ===== Files list =====
function renderFiles(filterText = "") {
  const box = $("files");
  box.innerHTML = "";
  const ft = filterText.trim().toLowerCase();
  const files = state.allFiles.filter(
    (n) => !ft || n.toLowerCase().includes(ft)
  );
  files.forEach((n) => {
    const div = document.createElement("div");
    div.className = "file-item" + (n === state.current ? " active" : "");
    div.textContent = n;
    div.tabIndex = 0;
    div.role = "option";
    div.onclick = () => chooseFile(n);
    div.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") chooseFile(n);
    };
    box.appendChild(div);
  });
}

async function listFiles() {
  const data = await fetchJSON("/cms/list");
  state.allFiles = data.files || [];
  renderFiles($("filter").value);
}

async function chooseFile(name) {
  if (state.dirty) {
    const ok = confirm("当前内容未保存，确定要切换吗？");
    if (!ok) return;
  }
  const txt = await fetchJSON("/cms/get?name=" + encodeURIComponent(name));
  $("editor").value = txt;
  state.current = name;
  $("curName").textContent = name || "（未选择文件）";
  state.dirty = false;
  setSavedState("ok");
  setEditorBytes();
  renderFiles($("filter").value);
}

async function saveFile() {
  if (!state.current) {
    alert("请先选择文件");
    return;
  }
  setSavedState("busy");
  const content = $("editor").value;
  const res = await fetchJSON("/cms/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: state.current, content }),
  });
  state.dirty = false;
  setSavedState("ok");
  toast(res.msg || "已保存");
}

async function createFile() {
  const name = $("newName").value.trim();
  if (!/^[a-zA-Z0-9_.-]+\.json$/.test(name)) {
    alert("请输入合法的 .json 文件名");
    return;
  }
  await fetchJSON("/cms/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  $("newName").value = "";
  await listFiles();
  await chooseFile(name);
}

// ===== Upload =====
async function uploadImg() {
  const f = $("uploader").files[0];
  if (!f) {
    alert("请选择图片");
    return;
  }
  const fd = new FormData();
  fd.append("file", f);
  const d = await fetchJSON("/cms/upload", { method: "POST", body: fd });
  $("uploadResult").innerHTML =
    '<small>URL: <code>' + d.url + "</code> （已复制）</small>";
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(d.url);
      toast("图片 URL 已复制");
    } catch {
      /* ignore */
    }
  } else {
    toast("上传成功");
  }
}

// ===== Editor =====
function formatJson() {
  try {
    const v = JSON.parse($("editor").value);
    $("editor").value = JSON.stringify(v, null, 2);
    setEditorBytes();
    toast("已格式化");
  } catch (e) {
    alert("JSON 解析失败：" + e.message);
  }
}

// ===== Drag sidebar =====
function initDragbar() {
  const drag = $("dragbar");
  const sidebar = document.querySelector("aside");
  let dragging = false;

  const onDown = (e) => {
    dragging = true;
    document.body.style.userSelect = "none";
  };
  const onMove = (e) => {
    if (!dragging) return;
    const x = e.clientX;
    const min = 220;
    const max = 520;
    const width = Math.max(min, Math.min(max, x));
    sidebar.style.width = width + "px";
  };
  const onUp = () => {
    dragging = false;
    document.body.style.userSelect = "";
  };

  drag.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// ===== Shortcuts & guards =====
function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      saveFile();
    }
    if (mod && key === "b") {
      e.preventDefault();
      formatJson();
    }
    if (mod && key === "r") {
      e.preventDefault();
      state.current && chooseFile(state.current);
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

// ===== Bindings =====
function bindUI() {
  $("btnRefresh").onclick = listFiles;
  $("btnCreate").onclick = createFile;
  $("btnUpload").onclick = uploadImg;
  $("btnSave").onclick = saveFile;
  $("btnReload").onclick = () => state.current && chooseFile(state.current);
  $("btnFormat").onclick = formatJson;
  $("filter").oninput = () => renderFiles($("filter").value);

  $("editor").addEventListener("input", () => {
    state.dirty = true;
    setSavedState("dirty");
    setEditorBytes();
  });
}

// ===== Init =====
(function init() {
  bindUI();
  initDragbar();
  initShortcuts();
  listFiles().catch((e) => console.error(e));
})();
