"""FastAPI 后端：代理 DeepSeek API，避免把密钥暴露到前端。

启动：
    # 1) 安装依赖
    pip install fastapi uvicorn requests python-dotenv

    # 2) 配置密钥（复制 .env.example 为 .env 并填入真实 Key）
    copy .env.example .env

    # 3) 启动（--reload 便于开发）
    uvicorn server:app --reload --port 8000
"""
import os

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# 本地开发时从 .env 读取；部署到 Render 时用平台的环境变量
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = FastAPI(title="食品营养分析工具 API")

# 允许的前端来源。本地开发用 localhost；部署后把正式域名加进环境变量 ALLOW_ORIGINS
# 用逗号分隔，例如 ALLOW_ORIGINS=https://yourname.github.io
_origins = os.getenv(
    "ALLOW_ORIGINS",
    "http://localhost:8788,http://127.0.0.1:8788,http://localhost:5500,http://127.0.0.1:5500",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
# 官方现用模型名是 deepseek-flash；旧名 deepseek-chat 仍是遗留别名，实测由同一模型服务
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")

# System Prompt 固定不变，可命中 DeepSeek 的上下文缓存（便宜且更快）。
# 变化的内容一律放进 user message。
SYSTEM_PROMPT = (
    "你是一位专业的注册营养师，擅长把营养学数据转述成普通人能执行的饮食建议。\n"
    "要求：\n"
    "1. 只依据用户提供的数据作答，不要编造任何食物营养成分数值。\n"
    "2. 用简洁的中文，3-4 句话，不要分点罗列，不要用 Markdown 标题。\n"
    "3. 必须包含一条针对该用户情况的具体、可执行的建议。\n"
    "4. 不诊断疾病、不推荐保健品、不承诺疗效；如涉及疾病请提示遵医嘱。"
)


@app.get("/api/health")
def health():
    """给部署平台用的健康检查，同时便于确认密钥是否已配置。"""
    return {"status": "ok", "key_configured": bool(os.getenv("DEEPSEEK_API_KEY"))}


@app.post("/api/analyze")
def analyze(payload: dict):
    key = os.getenv("DEEPSEEK_API_KEY")
    if not key:
        raise HTTPException(
            status_code=500,
            detail="未配置 DEEPSEEK_API_KEY。请在 .env 或环境变量中设置后重启服务。",
        )

    prompt = (payload or {}).get("prompt")
    if not prompt or not str(prompt).strip():
        raise HTTPException(status_code=400, detail="缺少 prompt 字段")

    try:
        r = requests.post(
            DEEPSEEK_URL,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": str(prompt)},
                ],
                "stream": False,
                "temperature": 0.7,
            },
            timeout=60,
        )
    except requests.Timeout:
        raise HTTPException(status_code=504, detail="调用 DeepSeek 超时，请重试")
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"无法连接 DeepSeek：{e}")

    if r.status_code != 200:
        # 把上游错误原样传回，方便前端展示与排查（不泄露密钥）
        raise HTTPException(
            status_code=r.status_code,
            detail=f"DeepSeek 返回错误：{r.text[:300]}",
        )

    return r.json()
