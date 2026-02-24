"""
DAG (有向无环图) 测试
"""

import pytest
from nexus.orchestrator.models import DAG, Task, TaskType, TaskStatus


@pytest.mark.unit
class TestDAG:
    """DAG 测试"""

    def test_create_empty_dag(self):
        """测试创建空 DAG"""
        dag = DAG()
        assert len(dag.nodes) == 0
        assert len(dag.edges) == 0

    def test_add_single_task(self, sample_task):
        """测试添加单个任务"""
        dag = DAG()
        dag.add_task(sample_task)
        assert len(dag.nodes) == 1
        assert sample_task.task_id in dag.nodes

    def test_add_task_with_dependency(self):
        """测试添加有依赖关系的任务"""
        dag = DAG()

        task1 = Task(
            task_id="task-1",
            task_type=TaskType.CODE,
            description="First task",
            dependencies=[],
            agent_type="CodeAgent"
        )

        task2 = Task(
            task_id="task-2",
            task_type=TaskType.CODE,
            description="Second task",
            dependencies=["task-1"],
            agent_type="CodeAgent"
        )

        dag.add_task(task1)
        dag.add_task(task2)

        assert len(dag.nodes) == 2
        assert len(dag.edges) == 1
        assert ("task-1", "task-2") in dag.edges

    def test_get_ready_tasks(self):
        """测试获取可执行任务"""
        dag = DAG()

        task1 = Task(
            task_id="task-1",
            task_type=TaskType.CODE,
            description="No dependencies",
            dependencies=[],
            agent_type="CodeAgent"
        )

        task2 = Task(
            task_id="task-2",
            task_type=TaskType.CODE,
            description="Has dependency",
            dependencies=["task-1"],
            agent_type="CodeAgent"
        )

        dag.add_task(task1)
        dag.add_task(task2)

        ready_tasks = dag.get_ready_tasks()
        assert len(ready_tasks) == 1
        assert ready_tasks[0].task_id == "task-1"

    def test_mark_task_complete(self):
        """测试标记任务完成"""
        dag = DAG()

        task1 = Task(
            task_id="task-1",
            task_type=TaskType.CODE,
            description="Task 1",
            dependencies=[],
            agent_type="CodeAgent"
        )

        task2 = Task(
            task_id="task-2",
            task_type=TaskType.CODE,
            description="Task 2",
            dependencies=["task-1"],
            agent_type="CodeAgent"
        )

        dag.add_task(task1)
        dag.add_task(task2)

        # 初始只有 task-1 可执行
        assert len(dag.get_ready_tasks()) == 1

        # 标记 task-1 完成
        dag.mark_task_complete("task-1")

        # 现在 task-2 也可执行
        ready_tasks = dag.get_ready_tasks()
        assert len(ready_tasks) == 1
        assert ready_tasks[0].task_id == "task-2"

    def test_is_complete(self):
        """测试检查 DAG 是否完成"""
        dag = DAG()

        task = Task(
            task_id="task-1",
            task_type=TaskType.CODE,
            description="Task",
            dependencies=[],
            agent_type="CodeAgent"
        )

        dag.add_task(task)
        assert not dag.is_complete()

        dag.mark_task_complete("task-1")
        assert dag.is_complete()

    def test_circular_dependency_detection(self):
        """测试循环依赖检测"""
        dag = DAG()

        task1 = Task(
            task_id="task-1",
            task_type=TaskType.CODE,
            description="Task 1",
            dependencies=["task-2"],
            agent_type="CodeAgent"
        )

        task2 = Task(
            task_id="task-2",
            task_type=TaskType.CODE,
            description="Task 2",
            dependencies=["task-1"],
            agent_type="CodeAgent"
        )

        dag.add_task(task1)
        dag.add_task(task2)

        # 应该检测到循环依赖
        assert dag.has_cycle()

    def test_multiple_parallel_tasks(self):
        """测试多个并行任务"""
        dag = DAG()

        for i in range(5):
            task = Task(
                task_id=f"task-{i}",
                task_type=TaskType.CODE,
                description=f"Task {i}",
                dependencies=[],
                agent_type="CodeAgent"
            )
            dag.add_task(task)

        ready_tasks = dag.get_ready_tasks()
        assert len(ready_tasks) == 5

    def test_complex_dependency_graph(self):
        """测试复杂依赖图"""
        dag = DAG()

        # A -> B -> D
        #      -> C -> E
        tasks = {
            "A": Task(task_id="A", task_type=TaskType.CODE, description="A",
                     dependencies=[], agent_type="CodeAgent"),
            "B": Task(task_id="B", task_type=TaskType.CODE, description="B",
                     dependencies=["A"], agent_type="CodeAgent"),
            "C": Task(task_id="C", task_type=TaskType.CODE, description="C",
                     dependencies=["A"], agent_type="CodeAgent"),
            "D": Task(task_id="D", task_type=TaskType.CODE, description="D",
                     dependencies=["B"], agent_type="CodeAgent"),
            "E": Task(task_id="E", task_type=TaskType.CODE, description="E",
                     dependencies=["C"], agent_type="CodeAgent"),
        }

        for task in tasks.values():
            dag.add_task(task)

        # 初始只有 A 可执行
        ready = dag.get_ready_tasks()
        assert len(ready) == 1
        assert ready[0].task_id == "A"

        # 完成A后，B和C可执行
        dag.mark_task_complete("A")
        ready = dag.get_ready_tasks()
        assert set(t.task_id for t in ready) == {"B", "C"}

    def test_topological_sort(self):
        """测试拓扑排序"""
        dag = DAG()

        # C -> B -> A
        task_a = Task(task_id="A", task_type=TaskType.CODE, description="A",
                     dependencies=["B"], agent_type="CodeAgent")
        task_b = Task(task_id="B", task_type=TaskType.CODE, description="B",
                     dependencies=["C"], agent_type="CodeAgent")
        task_c = Task(task_id="C", task_type=TaskType.CODE, description="C",
                     dependencies=[], agent_type="CodeAgent")

        dag.add_task(task_a)
        dag.add_task(task_b)
        dag.add_task(task_c)

        sorted_tasks = dag.topological_sort()
        task_ids = [t.task_id for t in sorted_tasks]

        # C 应该在 B 之前，B 应该在 A 之前
        assert task_ids.index("C") < task_ids.index("B")
        assert task_ids.index("B") < task_ids.index("A")


@pytest.mark.unit
class TestTask:
    """任务测试"""

    def test_task_creation(self):
        """测试任务创建"""
        task = Task(
            task_id="test-task",
            task_type=TaskType.CODE,
            description="Test task",
            dependencies=[],
            required_skills=["python", "fastapi"],
            agent_type="CodeAgent"
        )

        assert task.task_id == "test-task"
        assert task.task_type == TaskType.CODE
        assert task.status == TaskStatus.PENDING
        assert "python" in task.required_skills

    def test_task_status_transitions(self):
        """测试任务状态转换"""
        task = Task(
            task_id="test-task",
            task_type=TaskType.CODE,
            description="Test",
            dependencies=[],
            agent_type="CodeAgent"
        )

        # PENDING -> RUNNING
        task.status = TaskStatus.RUNNING
        assert task.status == TaskStatus.RUNNING

        # RUNNING -> COMPLETED
        task.status = TaskStatus.COMPLETED
        assert task.status == TaskStatus.COMPLETED

    def test_task_with_result(self):
        """测试带结果的任务"""
        task = Task(
            task_id="test-task",
            task_type=TaskType.CODE,
            description="Test",
            dependencies=[],
            agent_type="CodeAgent"
        )

        task.result = {"output": "success", "files_created": 3}
        task.status = TaskStatus.COMPLETED

        assert task.result["output"] == "success"
        assert task.status == TaskStatus.COMPLETED

    def test_task_with_error(self):
        """测试带错误的任务"""
        task = Task(
            task_id="test-task",
            task_type=TaskType.CODE,
            description="Test",
            dependencies=[],
            agent_type="CodeAgent"
        )

        task.error_message = "API key not found"
        task.status = TaskStatus.FAILED

        assert task.error_message == "API key not found"
        assert task.status == TaskStatus.FAILED
