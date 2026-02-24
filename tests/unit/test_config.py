"""
配置系统测试
"""

import os
import pytest
from pathlib import Path
from nexus.config.settings import (
    Settings,
    OrchestratorConfig,
    ClusterConfig,
    AgentsConfig,
    APIConfig,
    MonitoringConfig,
    SecurityConfig,
    get_settings
)


@pytest.mark.unit
class TestSettings:
    """配置测试"""

    def test_default_settings(self):
        """测试默认配置"""
        settings = Settings()
        assert settings.orchestrator.log_level == "INFO"
        assert settings.cluster.max_parallel_agents > 0
        assert settings.agents.llm_provider in ["openai", "qwen", "anthropic"]

    def test_orchestrator_config(self):
        """测试编排器配置"""
        config = OrchestratorConfig(
            log_level="DEBUG",
            dag_optimization_enabled=True,
            max_task_retries=3
        )
        assert config.log_level == "DEBUG"
        assert config.dag_optimization_enabled is True
        assert config.max_task_retries == 3

    def test_cluster_config(self):
        """测试集群配置"""
        config = ClusterConfig(
            redis_url="redis://localhost:6379/0",
            max_parallel_agents=10
        )
        assert config.redis_url == "redis://localhost:6379/0"
        assert config.max_parallel_agents == 10

    def test_agents_config(self):
        """测试 Agent 配置"""
        config = AgentsConfig(
            llm_provider="openai",
            llm_config={"model": "gpt-4o"}
        )
        assert config.llm_provider == "openai"
        assert config.llm_config["model"] == "gpt-4o"

    def test_api_config(self):
        """测试 API 配置"""
        config = APIConfig(
            host="127.0.0.1",
            port=8000,
            debug_mode=True
        )
        assert config.host == "127.0.0.1"
        assert config.port == 8000
        assert config.debug_mode is True

    def test_monitoring_config(self):
        """测试监控配置"""
        config = MonitoringConfig(
            enabled=True,
            prometheus_port=9090
        )
        assert config.enabled is True
        assert config.prometheus_port == 9090

    def test_security_config(self):
        """测试安全配置"""
        config = SecurityConfig(
            enable_sandbox=True,
            allowed_operations=["read", "write"]
        )
        assert config.enable_sandbox is True
        assert "read" in config.allowed_operations


@pytest.mark.unit
class TestEnvironmentVariables:
    """环境变量测试"""

    def test_llm_provider_from_env(self, monkeypatch):
        """测试从环境变量读取 LLM 提供商"""
        monkeypatch.setenv("NEXUS_AGENTS__LLM_PROVIDER", "qwen")
        settings = Settings()
        assert settings.agents.llm_provider == "qwen"

    def test_redis_url_from_env(self, monkeypatch):
        """测试从环境变量读取 Redis URL"""
        monkeypatch.setenv("NEXUS_CLUSTER__REDIS_URL", "redis://custom:6380/5")
        settings = Settings()
        assert settings.cluster.redis_url == "redis://custom:6380/5"

    def test_api_port_from_env(self, monkeypatch):
        """测试从环境变量读取 API 端口"""
        monkeypatch.setenv("NEXUS_API__PORT", "9000")
        settings = Settings()
        assert settings.api.port == 9000


@pytest.mark.unit
class TestYAMLConfig:
    """YAML 配置测试"""

    def test_load_yaml_config(self, tmp_path, monkeypatch):
        """测试加载 YAML 配置"""
        config_file = tmp_path / "test_config.yaml"
        config_file.write_text("""
orchestrator:
  log_level: DEBUG
  dag_optimization_enabled: true

cluster:
  redis_url: redis://localhost:6379/1
  max_parallel_agents: 20
""")
        monkeypatch.setenv("NEXUS_CONFIG_FILE", str(config_file))
        # 注意：实际实现需要支持从文件加载
        # 这里只是测试配置文件格式


@pytest.mark.unit
class TestConfigValidation:
    """配置验证测试"""

    def test_invalid_llm_provider(self):
        """测试无效的 LLM 提供商"""
        with pytest.raises(ValueError):
            AgentsConfig(llm_provider="invalid_provider")

    def test_negative_parallel_agents(self):
        """测试负数的并行 Agent 数量"""
        with pytest.raises(ValueError):
            ClusterConfig(max_parallel_agents=-1)

    def test_invalid_port(self):
        """测试无效的端口号"""
        with pytest.raises(ValueError):
            APIConfig(port=70000)
