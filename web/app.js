/**
 * NAC Web Application
 * 前端交互界面
 */

class NACApp {
    constructor() {
        this.apiUrl = 'http://localhost:3000';
        this.wsUrl = 'ws://localhost:3000/ws';
        this.ws = null;
        this.isConnected = false;
        this.sessionId = null;
        this.taskCount = {
            running: 0,
            completed: 0
        };

        this.init();
    }

    /**
     * 初始化应用
     */
    async init() {
        this.log('info', '正在初始化NAC控制台...');

        // 连接到服务器
        await this.connect();

        // 加载系统信息
        await this.loadSystemInfo();

        this.log('success', 'NAC控制台初始化完成');
    }

    /**
     * 连接到服务器
     */
    async connect() {
        try {
            // 先检查HTTP连接
            const response = await fetch(`${this.apiUrl}/health`);
            const data = await response.json();

            if (data.status === 'ok') {
                this.setConnectionStatus(true);
                this.log('success', '已连接到NAC服务器');

                // 连接WebSocket
                this.connectWebSocket();
            }
        } catch (error) {
            this.setConnectionStatus(false);
            this.log('error', `连接失败: ${error.message}`);
            this.showToast('无法连接到服务器，请确保API服务已启动', 'error');
        }
    }

    /**
     * 连接WebSocket
     */
    connectWebSocket() {
        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => {
                this.log('info', 'WebSocket连接已建立');
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };

            this.ws.onerror = (error) => {
                this.log('error', 'WebSocket错误');
            };

            this.ws.onclose = () => {
                this.log('warn', 'WebSocket连接已关闭');
                this.setConnectionStatus(false);
            };
        } catch (error) {
            this.log('error', `WebSocket连接失败: ${error.message}`);
        }
    }

    /**
     * 处理WebSocket消息
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'result':
                this.handleTaskResult(data);
                break;
            case 'error':
                this.log('error', data.error);
                break;
            case 'pong':
                // 心跳响应
                break;
            default:
                this.log('info', `收到消息: ${JSON.stringify(data)}`);
        }
    }

    /**
     * 处理任务结果
     */
    handleTaskResult(data) {
        this.hideLoading();
        this.taskCount.running--;
        this.taskCount.completed++;
        this.updateTaskCount();

        if (data.data && data.data.success) {
            const result = data.data.data;
            this.displayResult(result);
            this.log('success', `任务完成 - SessionID: ${data.sessionId}`);
        } else {
            this.log('error', '任务执行失败');
            this.showToast('任务执行失败', 'error');
        }
    }

    /**
     * 提交任务
     */
    async submitTask() {
        const input = document.getElementById('userInput').value.trim();

        if (!input) {
            this.showToast('请输入任务描述', 'error');
            return;
        }

        this.showLoading();
        this.log('info', `提交任务: ${input.substring(0, 50)}...`);

        this.taskCount.running++;
        this.updateTaskCount();

        try {
            const response = await fetch(`${this.apiUrl}/api/v1/tasks/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_input: input,
                    session_id: this.sessionId || `web-${Date.now()}`
                })
            });

            const data = await response.json();

            if (data.success) {
                this.sessionId = data.data.session_id;
                this.log('info', `任务已提交 - SessionID: ${this.sessionId}`);

                // 如果是同步响应，直接显示结果
                if (data.data.result) {
                    this.handleTaskResult({
                        sessionId: this.sessionId,
                        data: data.data.result
                    });
                }
            } else {
                this.hideLoading();
                this.taskCount.running--;
                this.updateTaskCount();
                this.log('error', data.error);
                this.showToast(data.error, 'error');
            }
        } catch (error) {
            this.hideLoading();
            this.taskCount.running--;
            this.updateTaskCount();
            this.log('error', `提交失败: ${error.message}`);
            this.showToast('提交任务失败', 'error');
        }
    }

    /**
     * 快捷任务
     */
    quickTask(type) {
        const tasks = {
            github: '总结最新的github前10热搜的ai项目，给出简短摘要',
            code: '分析当前项目的代码质量，给出改进建议',
            api: '生成一个用户认证RESTful API，包含登录、注册、权限验证',
            test: '为用户模块生成单元测试，使用vitest框架'
        };

        const input = document.getElementById('userInput');
        input.value = tasks[type] || '';
        this.showToast('任务已填充，请点击执行', 'info');
    }

    /**
     * 加载系统信息
     */
    async loadSystemInfo() {
        try {
            // 加载Agents
            const agentsRes = await fetch(`${this.apiUrl}/api/v1/agents`);
            const agentsData = await agentsRes.json();
            if (agentsData.success) {
                document.getElementById('agentCount').textContent = agentsData.data.total;
            }

            // 加载Skills
            const skillsRes = await fetch(`${this.apiUrl}/api/v1/skills`);
            const skillsData = await skillsRes.json();
            if (skillsData.success) {
                document.getElementById('skillCount').textContent = skillsData.data.total;
            }
        } catch (error) {
            this.log('warn', `加载系统信息失败: ${error.message}`);
        }
    }

    /**
     * 显示结果
     */
    displayResult(result) {
        const output = document.getElementById('output');

        // 移除占位符
        const placeholder = output.querySelector('.output-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // 创建结果项
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';

        const time = new Date().toLocaleTimeString();

        let content = '';
        let metrics = '';

        // 处理不同类型的结果
        if (result.response) {
            content = this.formatOutput(result.response);
        } else if (result.data) {
            if (result.data.response) {
                content = this.formatOutput(result.data.response);
            } else if (result.data.tasks) {
                content = this.formatTasksOutput(result.data.tasks);
            }

            // 添加指标
            if (result.data.summary) {
                metrics = this.formatMetrics(result.data.summary);
            }
        } else {
            content = this.formatOutput(JSON.stringify(result, null, 2));
        }

        resultItem.innerHTML = `
            <div class="result-header">
                <div class="result-title">执行结果</div>
                <div class="result-time">${time}</div>
            </div>
            <div class="result-content">${content}</div>
            ${metrics}
        `;

        // 插入到最前面
        output.insertBefore(resultItem, output.firstChild);
    }

    /**
     * 格式化输出
     */
    formatOutput(text) {
        if (typeof text !== 'string') {
            text = JSON.stringify(text, null, 2);
        }

        // 转义HTML
        text = text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;');

        // 格式化代码块
        text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 格式化标题
        text = text.replace(/^### (.*$)/gm, '<h4>$1</h4>');
        text = text.replace(/^## (.*$)/gm, '<h3>$1</h3>');

        // 格式化列表
        text = text.replace(/^- (.*$)/gm, '<li>$1</li>');
        text = text.replace(/^(\d+)\. (.*$)/gm, '<li>$2</li>');

        return text;
    }

    /**
     * 格式化任务输出
     */
    formatTasksOutput(tasks) {
        if (!Array.isArray(tasks)) {
            return this.formatOutput(JSON.stringify(tasks, null, 2));
        }

        let html = '<div style="display: grid; gap: 12px;">';

        tasks.forEach(task => {
            html += `
                <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">
                        ${task.name || task.id}
                    </div>
                    ${task.result ? `
                        <div style="font-size: 13px; color: #64748b;">
                            ${this.formatOutput(typeof task.result === 'string'
                                ? task.result
                                : JSON.stringify(task.result, null, 2)
                            ).substring(0, 200)}...
                        </div>
                    ` : ''}
                    ${task.duration ? `
                        <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">
                            耗时: ${(task.duration / 1000).toFixed(2)}s
                        </div>
                    ` : ''}
                </div>
            `;
        });

        html += '</div>';
        return html;
    }

    /**
     * 格式化指标
     */
    formatMetrics(summary) {
        const metrics = [];

        if (summary.totalTasks !== undefined) {
            metrics.push({ label: '总任务数', value: summary.totalTasks });
        }
        if (summary.totalDuration !== undefined) {
            metrics.push({
                label: '总耗时',
                value: `${(summary.totalDuration / 1000).toFixed(2)}s`
            });
        }
        if (summary.successRate !== undefined) {
            metrics.push({
                label: '成功率',
                value: `${(summary.successRate * 100).toFixed(1)}%`
            });
        }

        if (metrics.length === 0) return '';

        return `
            <div class="result-metrics">
                ${metrics.map(m => `
                    <div class="metric-item">
                        <span class="metric-label">${m.label}</span>
                        <span class="metric-value">${m.value}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * 添加日志
     */
    log(level, message) {
        const logs = document.getElementById('logs');
        const time = new Date().toLocaleTimeString();

        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-level ${level}">${level.toUpperCase()}</span>
            <span class="log-message">${message}</span>
        `;

        logs.appendChild(entry);

        // 自动滚动
        if (document.getElementById('autoScroll').checked) {
            logs.scrollTop = logs.scrollHeight;
        }
    }

    /**
     * 更新任务计数
     */
    updateTaskCount() {
        document.getElementById('runningTasks').textContent = this.taskCount.running;
        document.getElementById('completedTasks').textContent = this.taskCount.completed;
    }

    /**
     * 设置连接状态
     */
    setConnectionStatus(connected) {
        this.isConnected = connected;

        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        if (connected) {
            dot.className = 'status-dot connected';
            text.textContent = '已连接';
        } else {
            dot.className = 'status-dot error';
            text.textContent = '未连接';
        }
    }

    /**
     * 显示加载中
     */
    showLoading() {
        document.getElementById('loadingOverlay').classList.remove('hidden');
    }

    /**
     * 隐藏加载中
     */
    hideLoading() {
        document.getElementById('loadingOverlay').classList.add('hidden');
    }

    /**
     * 显示Toast通知
     */
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;

        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }

    /**
     * 清空输入
     */
    clearInput() {
        document.getElementById('userInput').value = '';
    }

    /**
     * 清空输出
     */
    clearOutput() {
        const output = document.getElementById('output');
        output.innerHTML = `
            <div class="output-placeholder">
                <div class="placeholder-icon">⚡</div>
                <div class="placeholder-text">任务执行结果将显示在这里</div>
            </div>
        `;
    }

    /**
     * 导出输出
     */
    exportOutput() {
        const output = document.getElementById('output');
        const text = output.innerText;

        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nac-output-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('输出已导出', 'success');
    }
}

// 初始化应用
const app = new NACApp();
