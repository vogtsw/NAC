"""
Pytest 配置文件

提供测试 fixtures 和配置
"""

import asyncio
import os
import sys
from pathlib import Path
from typing import AsyncIterator, Iterator
from unittest.mock import AsyncMock, MagicMock

import pytest
import redis.asyncio as aioredis
from httpx import AsyncClient, ASGITransport

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


@pytest.fixture(scope="session")
def event_loop():
    """创建事件循环"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def redis_client() -> AsyncIterator[aioredis.Redis]:
    """创建 Redis 客户端"""
    redis_url = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")

    client = await aioredis.from_url(redis_url, decode_responses=True)

    # 测试前清空数据库
    await client.flushdb()

    yield client

    # 测试后清理
    await client.flushdb()
    await client.close()


@pytest.fixture
async def mock_redis():
    """Mock Redis 客户端"""
    mock = AsyncMock()
    mock.get = AsyncMock(return_value=None)
    mock.set = AsyncMock()
    mock.delete = AsyncMock()
    mock.keys = AsyncMock(return_value=[])
    mock.exists = AsyncMock(return_value=False)
    mock.flushdb = AsyncMock()
    mock.ping = AsyncMock(return_value=True)
    return mock


@pytest.fixture
def mock_llm_client():
    """Mock LLM 客户端"""
    mock = AsyncMock()
    mock.complete = AsyncMock(return_value="Mock LLM response")
    mock.complete_with_tools = AsyncMock(return_value="Mock response")
    mock.stream_complete = AsyncMock(return_value=iter(["Mock", " stream"]))
    mock.close = AsyncMock()
    return mock


@pytest.fixture
def mock_settings():
    """Mock 配置"""
    from nexus.config.settings import (
        Settings, OrchestratorConfig, ClusterConfig,
        AgentsConfig, APIConfig, MonitoringConfig, SecurityConfig
    )

    return Settings(
        orchestrator=OrchestratorConfig(
            log_level="DEBUG",
            dag_optimization_enabled=True,
            max_task_retries=3,
            task_timeout=300
        ),
        cluster=ClusterConfig(
            redis_url="redis://localhost:6379/15",
            max_parallel_agents=5,
            agent_idle_timeout=300,
            heartbeat_interval=30
        ),
        agents=AgentsConfig(
            llm_provider="openai",
            llm_config={"model": "gpt-4o"},
            default_agent_type="GenericAgent",
            max_context_length=8000,
            temperature=0.7
        ),
        api=APIConfig(
            host="127.0.0.1",
            port=8000,
            debug_mode=True,
            enable_docs=True,
            cors_origins=["*"]
        ),
        monitoring=MonitoringConfig(
            enabled=True,
            prometheus_port=9090,
            log_level="INFO",
            json_logs=False
        ),
        security=SecurityConfig(
            enable_sandbox=False,
            allowed_operations=["*"],
            max_execution_time=300
        )
    )


@pytest.fixture
async def app_client(mock_settings):
    """创建 FastAPI 测试客户端"""
    from nexus.api.main import app
    from nexus.config.settings import get_settings

    # 使用 mock settings
    import nexus.config.settings
    nexus.config.settings._settings = mock_settings

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as client:
        yield client


@pytest.fixture
async def blackboard_state():
    """创建测试用的 BlackboardState"""
    from nexus.state.models import BlackboardState, SessionStatus

    state = BlackboardState(
        session_id="test-session-1",
        status=SessionStatus.RUNNING
    )
    return state


@pytest.fixture
def sample_task():
    """创建测试任务"""
    from nexus.orchestrator.models import Task, TaskType, TaskStatus

    task = Task(
        task_id="task-1",
        task_type=TaskType.CODE,
        description="Test task",
        dependencies=[],
        required_skills=["test_skill"],
        agent_type="TestAgent"
    )
    return task


@pytest.fixture
def sample_dag(sample_task):
    """创建测试 DAG"""
    from nexus.orchestrator.models import DAG

    dag = DAG()
    dag.add_task(sample_task)
    return dag


@pytest.fixture
async def mock_orchestrator(mock_llm_client, mock_redis):
    """创建 Mock Orchestrator"""
    from nexus.orchestrator.orchestrator import Orchestrator
    from nexus.state.blackboard import Blackboard

    # 创建 mock blackboard
    blackboard = Blackboard.__new__(Blackboard)
    blackboard.redis = mock_redis
    blackboard.publisher = mock_redis
    blackboard._get_client = AsyncMock(return_value=mock_redis)

    # 创建 orchestrator
    orchestrator = Orchestrator.__new__(Orchestrator)
    orchestrator.llm_client = mock_llm_client
    orchestrator.blackboard = blackboard
    orchestrator.agent_factory = AsyncMock()
    orchestrator.skill_manager = MagicMock()
    orchestrator.intent_parser = AsyncMock()
    orchestrator.dag_builder = MagicMock()
    orchestrator.scheduler = AsyncMock()
    orchestrator.monitor = MagicMock()
    orchestrator._initialized = True

    return orchestrator


# 测试数据 fixtures
@pytest.fixture
def sample_intent():
    """示例用户意图"""
    return {
        "user_input": "创建一个 Flask REST API",
        "context": {}
    }


@pytest.fixture
def sample_execution_plan():
    """示例执行计划"""
    return {
        "steps": [
            {
                "id": "step_1",
                "name": "设计 API 结构",
                "agent_type": "CodeAgent",
                "dependencies": [],
                "estimated_duration": 120
            },
            {
                "id": "step_2",
                "name": "实现端点",
                "agent_type": "CodeAgent",
                "dependencies": ["step_1"],
                "estimated_duration": 300
            }
        ],
        "critical_path": ["step_1", "step_2"],
        "total_estimated_duration": 420
    }


# 异步测试辅助工具
class AsyncTestRunner:
    """异步测试运行器"""

    @staticmethod
    async def run_with_timeout(coro, timeout=5.0):
        """带超时的运行协程"""
        return await asyncio.wait_for(coro, timeout=timeout)


@pytest.fixture
def async_runner():
    """异步测试运行器 fixture"""
    return AsyncTestRunner()


# 跳过集成测试的标记
def pytest_configure(config):
    """Pytest 配置"""
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests (deselect with '-m \"not integration\"')"
    )
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "unit: marks tests as unit tests"
    )


# 在测试前检查 Redis 是否可用
def pytest_collection_modifyitems(config, items):
    """修改测试收集"""
    redis_available = True

    try:
        import redis
        r = redis.Redis(host="localhost", port=6379, db=15, socket_connect_timeout=1)
        r.ping()
        r.close()
    except Exception:
        redis_available = False

    if not redis_available:
        skip_redis = pytest.mark.skip(reason="Redis not available")
        for item in items:
            if "redis" in item.fixturenames or "blackboard" in item.fixturenames:
                item.add_marker(skip_redis)
