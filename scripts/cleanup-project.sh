#!/bin/bash
# 项目清理脚本
# 清理临时文档、归档旧报告、整理项目结构

set -e  # 遇到错误立即退出

echo "🧹 开始清理 NAC 项目..."
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 1. 创建归档目录
echo -e "${YELLOW}📁 创建归档目录...${NC}"
mkdir -p memory/test-results/archive
mkdir -p memory/sessions/archive
mkdir -p doc/archive

# 2. 归档旧的测试报告
echo -e "${YELLOW}📦 归档旧的测试报告...${NC}"
if [ -f "memory/test-results/API_Mismatch_Details.md" ]; then
    mv memory/test-results/API_Mismatch_Details.md memory/test-results/archive/
    echo -e "${GREEN}  ✓ API_Mismatch_Details.md 已归档${NC}"
fi

if [ -f "memory/test-results/Bug_Fix_Summary.md" ]; then
    mv memory/test-results/Bug_Fix_Summary.md memory/test-results/archive/
    echo -e "${GREEN}  ✓ Bug_Fix_Summary.md 已归档${NC}"
fi

if [ -f "memory/test-results/Failing_Test_Cases.md" ]; then
    mv memory/test-results/Failing_Test_Cases.md memory/test-results/archive/
    echo -e "${GREEN}  ✓ Failing_Test_Cases.md 已归档${NC}"
fi

if [ -f "memory/test-results/Fixes_Applied_Summary.md" ]; then
    mv memory/test-results/Fixes_Applied_Summary.md memory/test-results/archive/
    echo -e "${GREEN}  ✓ Fixes_Applied_Summary.md 已归档${NC}"
fi

if [ -f "memory/test-results/test-report.md" ]; then
    mv memory/test-results/test-report.md memory/test-results/archive/
    echo -e "${GREEN}  ✓ test-report.md 已归档${NC}"
fi

# 3. 归档 doc/ 目录中的临时文档
echo -e "${YELLOW}📦 归档 doc/ 中的临时文档...${NC}"

# 临时文档列表
TEMP_DOCS=(
    "TEST_CASES_ENRICHMENT_SUMMARY.md"
    "TEST_FIX_SUMMARY.md"
    "FIX_ENCODING.md"
)

for doc in "${TEMP_DOCS[@]}"; do
    if [ -f "doc/$doc" ]; then
        mv "doc/$doc" "doc/archive/"
        echo -e "${GREEN}  ✓ $doc 已归档${NC}"
    fi
done

# 4. 归档旧的会话文件（保留最近 50 个）
echo -e "${YELLOW}📦 归档旧的会话文件...${NC}"
cd memory/sessions
SESSION_COUNT=$(ls -1 *.md 2>/dev/null | wc -l)
if [ $SESSION_COUNT -gt 50 ]; then
    ls -t *.md | tail -n +51 | xargs -I {} mv {} archive/
    echo -e "${GREEN}  ✓ 已归档 $((SESSION_COUNT - 50)) 个旧会话文件${NC}"
else
    echo -e "${GREEN}  ✓ 会话文件数量 ($SESSION_COUNT) 未超过阈值，无需归档${NC}"
fi
cd ../..

# 5. 创建 .gitkeep 文件
echo -e "${YELLOW}📝 创建 .gitkeep 文件...${NC}"
touch memory/artifacts/.gitkeep
touch memory/test-results/archive/.gitkeep
touch memory/sessions/archive/.gitkeep
touch doc/archive/.gitkeep

# 6. 显示清理统计
echo ""
echo -e "${GREEN}✅ 清理完成！${NC}"
echo ""
echo "📊 清理统计："
echo "  - 归档测试报告: $(ls -1 memory/test-results/archive/*.md 2>/dev/null | wc -l) 个文件"
echo "  - 归档文档: $(ls -1 doc/archive/*.md 2>/dev/null | wc -l) 个文件"
echo "  - 归档会话: $(ls -1 memory/sessions/archive/*.md 2>/dev/null | wc -l) 个文件"
echo ""
echo -e "${YELLOW}⚠️  手动操作提醒：${NC}"
echo "  1. ✅ 已修复: tests/integration.test.ts 中的硬编码 API 密钥已删除"
echo "  2. ✅ 已修复: .gitignore 已更新"
echo "  3. ⚠️  需要手动: 轮换暴露的 DeepSeek API 密钥"
echo "  4. ⚠️  需要手动: 检查 git 历史中是否包含敏感信息"
echo "  5. ⚠️  建议创建: .env.example 文件作为环境变量模板"
echo ""
echo -e "${GREEN}🎉 项目清理完成！${NC}"
