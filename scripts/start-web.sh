#!/bin/bash

# NAC Web控制台启动脚本

echo "=================================="
echo "  NAC Web Console Launcher"
echo "=================================="
echo ""

# 检查Node.js版本
NODE_VERSION=$(node -v)
echo "Node.js版本: $NODE_VERSION"

# 检查环境变量文件
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  警告: .env文件不存在"
    echo "请先复制.env.example并配置API密钥:"
    echo "  cp .env.example .env"
    echo ""
    exit 1
fi

# 检查API密钥
if ! grep -q "ZHIPU_API_KEY=" .env || grep -q "ZHIPU_API_KEY=your_" .env; then
    echo ""
    echo "⚠️  警告: API密钥未配置"
    echo "请在.env文件中配置ZHIPU_API_KEY"
    echo ""
    exit 1
fi

echo ""
echo "🚀 正在启动NAC Web服务..."
echo ""
echo "访问地址: http://localhost:3000"
echo "按 Ctrl+C 停止服务"
echo ""
echo "=================================="
echo ""

# 启动服务
pnpm web
