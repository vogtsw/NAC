# 多阶段构建 - 开发阶段
FROM python:3.11-slim as base

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv
COPY pyproject.toml .
RUN pip install uv

# 创建虚拟环境并安装依赖
RUN uv venv
RUN uv pip install -e .

# 生产阶段
FROM python:3.11-slim as production

# 设置环境变量
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 创建非 root 用户
RUN useradd --create-home --shell /bin/bash nexus
WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制虚拟环境
COPY --from=base /app/.venv /app/.venv

# 复制应用代码
COPY --chown=nexus:nexus nexus/ ./nexus/
COPY --chown=nexus:nexus config.yaml .
COPY --chown=nexus:nexus pyproject.toml .

# 切换到非 root 用户
USER nexus

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["/app/.venv/bin/uvicorn", "nexus.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
