"""
Skills 系统测试
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from nexus.skills.base import Skill, SkillCategory, SkillStatus
from nexus.skills.manager import SkillManager
from nexus.skills.registry import SkillRegistry


@pytest.mark.unit
class TestSkill:
    """Skill 基类测试"""

    def test_create_skill(self):
        """测试创建技能"""
        skill = Skill(
            skill_id="test-skill",
            name="Test Skill",
            description="A test skill",
            category=SkillCategory.CODE,
            version="1.0.0",
            enabled=True
        )

        assert skill.skill_id == "test-skill"
        assert skill.name == "Test Skill"
        assert skill.category == SkillCategory.CODE
        assert skill.enabled is True

    def test_skill_execution_not_implemented(self):
        """测试技能执行（未实现）"""
        skill = Skill(
            skill_id="test-skill",
            name="Test",
            description="Test",
            category=SkillCategory.CODE
        )

        with pytest.raises(NotImplementedError):
            # 需要异步运行
            import asyncio
            asyncio.run(skill.execute({}))

    def test_skill_validation(self):
        """测试技能参数验证"""
        skill = Skill(
            skill_id="test-skill",
            name="Test",
            description="Test",
            category=SkillCategory.CODE,
            parameters={
                "required": ["param1"],
                "optional": ["param2"]
            }
        )

        assert "param1" in skill.parameters.get("required", [])


@pytest.mark.unit
class TestSkillRegistry:
    """技能注册表测试"""

    def test_register_skill(self):
        """测试注册技能"""
        registry = SkillRegistry()

        skill = Skill(
            skill_id="test-skill",
            name="Test",
            description="Test",
            category=SkillCategory.CODE
        )

        registry.register(skill)
        assert "test-skill" in registry._skills
        assert registry.get("test-skill") is skill

    def test_unregister_skill(self):
        """测试注销技能"""
        registry = SkillRegistry()

        skill = Skill(
            skill_id="test-skill",
            name="Test",
            description="Test",
            category=SkillCategory.CODE
        )

        registry.register(skill)
        registry.unregister("test-skill")

        assert registry.get("test-skill") is None

    def test_list_skills(self):
        """测试列出技能"""
        registry = SkillRegistry()

        for i in range(3):
            skill = Skill(
                skill_id=f"skill-{i}",
                name=f"Skill {i}",
                description="Test",
                category=SkillCategory.CODE
            )
            registry.register(skill)

        skills = registry.list()
        assert len(skills) == 3

    def test_list_by_category(self):
        """测试按类别列出技能"""
        registry = SkillRegistry()

        code_skill = Skill(
            skill_id="code-skill",
            name="Code",
            description="Code skill",
            category=SkillCategory.CODE
        )

        data_skill = Skill(
            skill_id="data-skill",
            name="Data",
            description="Data skill",
            category=SkillCategory.DATA
        )

        registry.register(code_skill)
        registry.register(data_skill)

        code_skills = registry.list_by_category(SkillCategory.CODE)
        data_skills = registry.list_by_category(SkillCategory.DATA)

        assert len(code_skills) == 1
        assert len(data_skills) == 1
        assert code_skills[0].skill_id == "code-skill"
        assert data_skills[0].skill_id == "data-skill"

    def test_get_enabled_skills(self):
        """测试获取启用的技能"""
        registry = SkillRegistry()

        enabled_skill = Skill(
            skill_id="enabled",
            name="Enabled",
            description="Enabled skill",
            category=SkillCategory.CODE,
            enabled=True
        )

        disabled_skill = Skill(
            skill_id="disabled",
            name="Disabled",
            description="Disabled skill",
            category=SkillCategory.CODE,
            enabled=False
        )

        registry.register(enabled_skill)
        registry.register(disabled_skill)

        enabled = registry.list_enabled()
        assert len(enabled) == 1
        assert enabled[0].skill_id == "enabled"


@pytest.mark.unit
class TestSkillManager:
    """技能管理器测试"""

    @pytest.fixture
    def skill_manager(self):
        """创建技能管理器"""
        manager = SkillManager()
        return manager

    def test_create_manager(self, skill_manager):
        """测试创建管理器"""
        assert skill_manager is not None
        assert skill_manager.registry is not None

    def test_get_skills_for_task(self, skill_manager):
        """测试获取任务相关技能"""
        code_skills = skill_manager.get_skills_for_task("code")
        assert isinstance(code_skills, list)

        data_skills = skill_manager.get_skills_for_task("data")
        assert isinstance(data_skills, list)

    def test_execute_skill_not_found(self, skill_manager):
        """测试执行不存在的技能"""
        import asyncio

        async def test():
            result = await skill_manager.execute_skill(
                skill_id="non-existent",
                parameters={},
                context={}
            )
            assert result["success"] is False
            assert "not found" in result["error"].lower()

        asyncio.run(test())

    def test_load_builtin_skills(self, skill_manager):
        """测试加载内置技能"""
        import asyncio

        async def test():
            # 模拟加载内置技能
            skill_manager.skill_definitions["builtin"] = {
                "skills": [
                    {
                        "id": "test-builtin",
                        "name": "Test Builtin",
                        "description": "A test builtin skill",
                        "category": "code",
                        "enabled": True
                    }
                ]
            }

            await skill_manager.load_builtin_skills()

            # 验证技能已加载
            skill = skill_manager.get_skill("test-builtin")
            assert skill is not None

        asyncio.run(test())


@pytest.mark.unit
class TestBuiltinSkills:
    """内置技能测试"""

    def test_file_ops_skill(self):
        """测试文件操作技能"""
        from nexus.skills.builtin.file_ops import FileOpsSkill

        skill = FileOpsSkill()
        assert skill.skill_id == "file-ops"
        assert skill.category == SkillCategory.FILE

    def test_terminal_skill(self):
        """测试终端技能"""
        from nexus.skills.builtin.terminal import TerminalSkill

        skill = TerminalSkill()
        assert skill.skill_id == "terminal-exec"
        assert skill.category == SkillCategory.TERMINAL

    def test_skill_metadata(self):
        """测试技能元数据"""
        from nexus.skills.builtin.file_ops import FileOpsSkill

        skill = FileOpsSkill()
        metadata = skill.get_metadata()

        assert "skill_id" in metadata
        assert "name" in metadata
        assert "parameters" in metadata
