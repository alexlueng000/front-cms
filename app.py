# main.py
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from datetime import datetime
import json, os, shutil, secrets
from pathlib import Path

# ================= 基本配置（可用环境变量覆盖） =================
SITE_ROOT   = Path(os.getenv("SITE_ROOT", "/var/www/your-site")).resolve()
CONTENT_DIR = (SITE_ROOT / "content").resolve()
UPLOAD_DIR  = (SITE_ROOT / "assets" / "uploads").resolve()
HISTORY_DIR = (CONTENT_DIR / ".history").resolve()

BASE_DIR   = Path(__file__).resolve().parent          # main.py 所在目录
CMS_DIR    = (BASE_DIR / "cms_admin").resolve()       # …/cms_admin
print("CMS_DIR: ", CMS_DIR)
CMS_INDEX  = (CMS_DIR / "index.html").resolve()       # …/cms_admin/index.html
print("CMS_INDEX: ", CMS_INDEX)
ADMIN_USER  = os.getenv("CMS_USER", "editor")
ADMIN_PASS  = os.getenv("CMS_PASS", "123456")

# ================= 应用 & 安全 =================
app = FastAPI(title="Mini CMS", version="1.0.0")
security = HTTPBasic()

def auth(creds: HTTPBasicCredentials = Depends(security)) -> bool:
    ok_user = secrets.compare_digest(creds.username, ADMIN_USER)
    ok_pass = secrets.compare_digest(creds.password, ADMIN_PASS)
    if not (ok_user and ok_pass):
        # 注意返回 401 且带 WWW-Authenticate 头，浏览器会弹出认证框
        raise HTTPException(status_code=401, detail="Unauthorized",
                            headers={"WWW-Authenticate": "Basic"})
    return True

def ensure_dirs() -> None:
    # 确保必要目录存在
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    CMS_DIR.mkdir(parents=True, exist_ok=True)

ensure_dirs()

# 挂静态目录，提供 /cms_admin/app.js、/cms_admin/styles.css 等静态资源
app.mount("/cms_admin", StaticFiles(directory=CMS_DIR), name="cms_admin")

# ================= 工具函数 =================
def safe_content_path(name: str) -> Path:
    """
    仅允许访问 /content 下 .json 文件，防止路径穿越
    """
    p = (CONTENT_DIR / name).resolve()
    if p.suffix != ".json":
        raise HTTPException(400, "Only .json allowed")
    if not str(p).startswith(str(CONTENT_DIR)):
        raise HTTPException(400, "Invalid path")
    return p

# ================= 页面入口 =================

@app.get("/cms")
def cms_page(_: bool = Depends(auth)):
    return FileResponse(str(CMS_INDEX), media_type="text/html")

# ================= 后端 API =================
@app.get("/cms/list")
def list_files(_: bool = Depends(auth)) -> JSONResponse:
    files = sorted([p.name for p in CONTENT_DIR.glob("*.json")])
    return JSONResponse({"files": files})

@app.get("/cms/get", response_class=PlainTextResponse)
def get_file(name: str, _: bool = Depends(auth)) -> str:
    p = safe_content_path(name)
    if not p.exists():
        raise HTTPException(404, "Not found")
    return p.read_text(encoding="utf-8")

@app.post("/cms/save")
def save_file(payload: dict, _: bool = Depends(auth)) -> JSONResponse:
    name = payload.get("name")
    content = payload.get("content", "")
    if not name:
        raise HTTPException(400, "Missing file name")

    p = safe_content_path(name)
    try:
        data = json.loads(content)  # 校验 JSON
    except Exception as e:
        raise HTTPException(400, f"JSON invalid: {e}")

    # 备份历史
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    if p.exists():
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, HISTORY_DIR / f"{p.name}.{ts}.bak.json")

    # 保存（格式化 & 中文不转义）
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return JSONResponse({"ok": True, "msg": "保存成功，已自动备份到 .history/"})

@app.post("/cms/create")
def create_file(payload: dict, _: bool = Depends(auth)) -> JSONResponse:
    name = payload.get("name")
    if not name:
        raise HTTPException(400, "Missing file name")
    p = safe_content_path(name)
    if p.exists():
        raise HTTPException(400, "文件已存在")
    p.write_text("{}\n", encoding="utf-8")
    return JSONResponse({"ok": True, "msg": "已创建空文件"})

@app.post("/cms/upload")
def upload(file: UploadFile = File(...), _: bool = Depends(auth)) -> JSONResponse:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename).suffix.lower()
    if suffix not in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]:
        raise HTTPException(400, "只允许图片")
    # 安全文件名：时间戳前缀 + 过滤
    safe_tail = "".join(c for c in Path(file.filename).name if c.isalnum() or c in "._-")
    safe_name = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + safe_tail
    dest = UPLOAD_DIR / safe_name
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    url = f"/assets/uploads/{dest.name}"  # 可直接在站点里引用
    return JSONResponse({"ok": True, "url": url})

# ================= 可选：开发期根路由提示 =================
@app.get("/")
def root():
    return {"ok": True, "msg": "Mini CMS is running. Open /cms"}

# ================= 本地调试启动 =================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "9009")),
        reload=bool(os.getenv("RELOAD", "1") == "1"),
    )
