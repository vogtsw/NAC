class NACApp {
    constructor() {
        this.apiUrl = window.location.origin;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.wsUrl = `${wsProtocol}//${window.location.host}/ws`;

        this.ws = null;
        this.isConnected = false;

        this.taskCount = {
            running: 0,
            completed: 0,
            failed: 0,
        };

        this.pendingRuns = new Map();
        this.runningAgentCounts = new Map();
        this.runningSkillCounts = new Map();
        this.progressDedup = new Set();
        this.sessionFinalizeTimers = new Map();
        this.pingTimer = null;

        this.init();
    }

    async init() {
        this.bindHotkeys();
        this.renderActiveRuntime();
        this.log('info', 'Initializing NAC console');

        await this.connect();
        await this.loadSystemInfo();

        this.log('success', 'Console ready');
    }

    bindHotkeys() {
        const input = document.getElementById('userInput');
        input.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                this.submitTask();
            }
        });
    }

    async connect() {
        try {
            const response = await fetch(`${this.apiUrl}/health`);
            const health = await response.json();

            if (health.status !== 'ok') {
                throw new Error('Health check failed');
            }

            this.setConnectionStatus(true);
            this.log('success', 'Connected to API service');

            this.connectWebSocket();
        } catch (error) {
            this.setConnectionStatus(false);
            this.log('error', `Connection failed: ${error.message}`);
            this.showToast('Cannot connect to server. Start API first.', 'error');
        }
    }

    connectWebSocket() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => {
                this.setConnectionStatus(true);
                this.log('info', 'WebSocket connected');
                this.startHeartbeat();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    this.log('warn', `Invalid WS payload: ${event.data}`);
                }
            };

            this.ws.onerror = () => {
                this.log('error', 'WebSocket error');
            };

            this.ws.onclose = () => {
                this.setConnectionStatus(false);
                this.log('warn', 'WebSocket closed, retrying in 3s');
                this.stopHeartbeat();
                setTimeout(() => this.connectWebSocket(), 3000);
            };
        } catch (error) {
            this.setConnectionStatus(false);
            this.log('error', `WebSocket connection failed: ${error.message}`);
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'task.accepted':
                this.log('info', `Task accepted (${data.sessionId})`);
                break;

            case 'task.progress':
                this.handleTaskProgress(data);
                break;

            case 'result':
                this.handleTaskResult(data);
                break;

            case 'error':
                this.handleTaskError(data);
                break;

            case 'pong':
                break;

            default:
                this.log('info', `WS: ${JSON.stringify(data)}`);
        }
    }

    handleTaskProgress(progressEvent) {
        const { eventType, sessionId, payload = {} } = progressEvent;
        this.setLastRuntimeEvent(eventType, sessionId, payload);
        const dedupKey = [
            eventType,
            sessionId,
            payload.taskId || '',
            payload.status || '',
        ].join('|');

        if (this.progressDedup.has(dedupKey)) {
            return;
        }
        this.progressDedup.add(dedupKey);

        if (this.progressDedup.size > 2000) {
            this.progressDedup.clear();
        }

        if (eventType === 'task.updated' && payload.status === 'running') {
            this.markTaskRunning(sessionId, payload);
            this.log(
                'info',
                `Running: ${payload.taskName || payload.taskId} | ${payload.agentType || 'UnknownAgent'}`
            );
            return;
        }

        if (eventType === 'task.updated' && payload.status === 'failed') {
            this.markTaskFinished(sessionId, payload.taskId);
            this.log('error', `Failed: ${payload.taskName || payload.taskId} | ${payload.error || 'Unknown error'}`);
            return;
        }

        if (eventType === 'task.completed') {
            this.markTaskFinished(sessionId, payload.taskId);
            this.log(
                'success',
                `Completed: ${payload.taskName || payload.taskId} (${((payload.duration || 0) / 1000).toFixed(2)}s)`
            );
            return;
        }

        if (eventType === 'task.failed') {
            this.markTaskFinished(sessionId, payload.taskId);
            this.log('error', `Failed: ${payload.taskName || payload.taskId} | ${payload.error || 'Unknown error'}`);
            return;
        }

        if (eventType === 'session.completed') {
            this.log('success', `Session completed: ${sessionId}`);
            this.scheduleSessionCompletionGuard(sessionId);
            return;
        }

        if (eventType === 'session.failed') {
            this.handleSessionFailed(sessionId);
        }
    }

    markTaskRunning(sessionId, payload) {
        const run = this.ensureRun(sessionId);
        if (!payload.taskId) {
            return;
        }

        const skills = Array.isArray(payload.requiredSkills)
            ? [...new Set(payload.requiredSkills.filter(Boolean))]
            : [];

        if (run.taskMeta.has(payload.taskId)) {
            const current = run.taskMeta.get(payload.taskId);
            let changed = false;

            if (payload.agentType && payload.agentType !== current.agentType) {
                this.decrementCounter(this.runningAgentCounts, current.agentType);
                current.agentType = payload.agentType;
                this.incrementCounter(this.runningAgentCounts, current.agentType);
                changed = true;
            }

            for (const skill of skills) {
                if (!current.skills.includes(skill)) {
                    current.skills.push(skill);
                    this.incrementCounter(this.runningSkillCounts, skill);
                    changed = true;
                }
            }

            if (changed) {
                this.renderActiveRuntime();
            }
            return;
        }

        const agentType = payload.agentType || 'GenericAgent';
        run.taskMeta.set(payload.taskId, { agentType, skills });
        this.incrementCounter(this.runningAgentCounts, agentType);

        for (const skill of skills) {
            this.incrementCounter(this.runningSkillCounts, skill);
        }

        this.renderActiveRuntime();
    }

    markTaskFinished(sessionId, taskId) {
        const run = this.pendingRuns.get(sessionId);
        if (!run || !run.taskMeta.has(taskId)) {
            return;
        }

        const meta = run.taskMeta.get(taskId);
        run.taskMeta.delete(taskId);

        this.decrementCounter(this.runningAgentCounts, meta.agentType);
        for (const skill of meta.skills) {
            this.decrementCounter(this.runningSkillCounts, skill);
        }

        this.renderActiveRuntime();
    }

    ensureRun(sessionId) {
        if (!this.pendingRuns.has(sessionId)) {
            this.pendingRuns.set(sessionId, { taskMeta: new Map() });
        }

        return this.pendingRuns.get(sessionId);
    }

    cleanupRun(sessionId) {
        const run = this.pendingRuns.get(sessionId);
        if (!run) {
            return;
        }

        for (const meta of run.taskMeta.values()) {
            this.decrementCounter(this.runningAgentCounts, meta.agentType);
            for (const skill of meta.skills) {
                this.decrementCounter(this.runningSkillCounts, skill);
            }
        }

        this.pendingRuns.delete(sessionId);
        this.renderActiveRuntime();
    }

    handleTaskError(data) {
        const sessionId = data?.sessionId;
        const errorMessage = data?.error || 'Unknown websocket error';

        if (sessionId) {
            this.cleanupRun(sessionId);
            this.clearSessionFinalizeTimer(sessionId);
            if (this.taskCount.running > 0) {
                this.taskCount.running -= 1;
            }
            this.taskCount.failed += 1;
            this.updateTaskCount();
        }

        this.log('error', errorMessage);
        this.showToast(errorMessage, 'error');
    }

    incrementCounter(counterMap, key) {
        const current = counterMap.get(key) || 0;
        counterMap.set(key, current + 1);
    }

    decrementCounter(counterMap, key) {
        const current = counterMap.get(key) || 0;
        if (current <= 1) {
            counterMap.delete(key);
        } else {
            counterMap.set(key, current - 1);
        }
    }

    renderActiveRuntime() {
        const agentsEl = document.getElementById('activeAgents');
        const skillsEl = document.getElementById('activeSkills');

        agentsEl.innerHTML = this.renderChipGroup(this.runningAgentCounts, 'No active agents');
        skillsEl.innerHTML = this.renderChipGroup(this.runningSkillCounts, 'No active skills');

        const runState = document.getElementById('runStateText');
        if (this.taskCount.running > 0) {
            runState.className = 'run-pill running';
            runState.textContent = `${this.taskCount.running} Running`;
        } else {
            runState.className = 'run-pill idle';
            runState.textContent = 'Idle';
        }
    }

    renderChipGroup(counterMap, emptyText) {
        if (counterMap.size === 0) {
            return `<span class="chip chip-idle">${emptyText}</span>`;
        }

        const chips = [];
        for (const [name, count] of counterMap.entries()) {
            chips.push(`<span class="chip">${this.escapeHtml(name)} x${count}</span>`);
        }
        return chips.join('');
    }

    async submitTask() {
        const inputEl = document.getElementById('userInput');
        const userInput = inputEl.value.trim();

        if (!userInput) {
            this.showToast('Please enter a task description first.', 'error');
            return;
        }

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.showToast('WebSocket is disconnected. Reconnecting...', 'error');
            this.connectWebSocket();
            return;
        }

        const sessionId = `web-${Date.now()}`;
        this.ensureRun(sessionId);
        this.clearSessionFinalizeTimer(sessionId);

        this.taskCount.running += 1;
        this.updateTaskCount();

        this.log('info', `Submitting task (${sessionId}): ${userInput.slice(0, 80)}`);

        this.ws.send(JSON.stringify({
            type: 'task',
            sessionId,
            userInput,
            context: {
                source: 'web-console',
            },
        }));

        inputEl.focus();
    }

    handleTaskResult(message) {
        const sessionId = message.sessionId;
        const result = message.data;

        this.cleanupRun(sessionId);
        this.clearSessionFinalizeTimer(sessionId);

        if (this.taskCount.running > 0) {
            this.taskCount.running -= 1;
        }

        if (result && result.success) {
            this.taskCount.completed += 1;
            this.updateTaskCount();
            this.displayResult(result.data || result, sessionId);
            this.log('success', `Task finished: ${sessionId}`);
        } else {
            this.taskCount.failed += 1;
            this.updateTaskCount();
            const errorMessage = result?.error || 'Unknown execution error';
            this.log('error', `Task failed: ${errorMessage}`);
            this.showToast(errorMessage, 'error');
        }
    }

    quickTask(type) {
        const templates = {
            github: 'Summarize top 10 trending AI projects on GitHub with short highlights.',
            code: 'Review this repository architecture and list top code quality improvements.',
            api: 'Generate a RESTful user auth API design with login/register/permission checks.',
            test: 'Generate core unit tests for user module using Vitest.',
        };

        document.getElementById('userInput').value = templates[type] || '';
        this.showToast('Template inserted.', 'success');
    }

    async loadSystemInfo() {
        try {
            const [agentsRes, skillsRes] = await Promise.all([
                fetch(`${this.apiUrl}/api/v1/agents`),
                fetch(`${this.apiUrl}/api/v1/skills`),
            ]);

            const agentsData = await agentsRes.json();
            const skillsData = await skillsRes.json();

            if (agentsData.success) {
                document.getElementById('agentCount').textContent = agentsData.data.total;
            }

            if (skillsData.success) {
                document.getElementById('skillCount').textContent = skillsData.data.total;
            }
        } catch (error) {
            this.log('warn', `Failed to load system info: ${error.message}`);
        }
    }

    displayResult(result, sessionId) {
        const output = document.getElementById('output');

        const empty = output.querySelector('.empty-state');
        if (empty) {
            empty.remove();
        }

        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';

        const summary = result.summary || result.data?.summary || {};
        const responseText =
            result.response ||
            result.data?.response ||
            this.formatTasksOutput(result.tasks || result.data?.tasks) ||
            JSON.stringify(result, null, 2);

        const metricTags = [];
        if (summary.totalTasks !== undefined) {
            metricTags.push(`Tasks: ${summary.totalTasks}`);
        }
        if (summary.totalDuration !== undefined) {
            metricTags.push(`Duration: ${(summary.totalDuration / 1000).toFixed(2)}s`);
        }

        resultItem.innerHTML = `
            <div class="result-meta">
                <span>${this.escapeHtml(sessionId)}</span>
                <span>${new Date().toLocaleTimeString()}</span>
            </div>
            <div class="result-content">${this.formatOutput(responseText)}</div>
            ${metricTags.length > 0 ? `<div class="result-metrics">${metricTags.map((tag) => `<span class="metric-tag">${this.escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        `;

        output.insertBefore(resultItem, output.firstChild);
    }

    formatTasksOutput(tasks) {
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return '';
        }

        return tasks
            .map((task) => {
                const title = task.name || task.taskId || task.id || 'Task';
                const body = task.result ? JSON.stringify(task.result, null, 2) : 'No detail';
                return `## ${title}\n${body}`;
            })
            .join('\n\n');
    }

    formatOutput(text) {
        if (typeof text !== 'string') {
            text = JSON.stringify(text, null, 2);
        }

        const escaped = this.escapeHtml(text);
            
        return escaped
            .replace(/```[\w-]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    log(level, message) {
        const logs = document.getElementById('logs');
        const row = document.createElement('div');
        row.className = 'log-entry';

        const timeNode = document.createElement('span');
        timeNode.className = 'log-time';
        timeNode.textContent = `[${new Date().toLocaleTimeString()}]`;

        const levelNode = document.createElement('span');
        levelNode.className = `log-level ${level}`;
        levelNode.textContent = level.toUpperCase();

        const msgNode = document.createElement('span');
        msgNode.className = 'log-message';
        msgNode.textContent = message;

        row.appendChild(timeNode);
        row.appendChild(levelNode);
        row.appendChild(msgNode);

        logs.appendChild(row);

        if (document.getElementById('autoScroll').checked) {
            logs.scrollTop = logs.scrollHeight;
        }
    }

    updateTaskCount() {
        document.getElementById('runningTasks').textContent = this.taskCount.running;
        document.getElementById('completedTasks').textContent = this.taskCount.completed;
        document.getElementById('failedTasks').textContent = this.taskCount.failed;
        this.renderActiveRuntime();
    }

    setConnectionStatus(connected) {
        this.isConnected = connected;

        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        if (connected) {
            dot.className = 'status-dot connected';
            text.textContent = 'Connected';
        } else {
            dot.className = 'status-dot error';
            text.textContent = 'Disconnected';
        }
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;

        setTimeout(() => {
            toast.classList.add('hidden');
        }, 2800);
    }

    setLastRuntimeEvent(eventType, sessionId, payload = {}) {
        const node = document.getElementById('lastRuntimeEvent');
        if (!node) return;

        const task = payload.taskName || payload.taskId || '-';
        node.textContent = `[${new Date().toLocaleTimeString()}] ${eventType} | ${sessionId} | ${task}`;
    }

    scheduleSessionCompletionGuard(sessionId) {
        this.clearSessionFinalizeTimer(sessionId);
        const timer = setTimeout(() => {
            if (!this.pendingRuns.has(sessionId)) {
                return;
            }
            this.cleanupRun(sessionId);
            if (this.taskCount.running > 0) {
                this.taskCount.running -= 1;
            }
            this.taskCount.completed += 1;
            this.updateTaskCount();
            this.log('warn', `Session ${sessionId} completed without result payload. Marked as completed.`);
        }, 2500);
        this.sessionFinalizeTimers.set(sessionId, timer);
    }

    clearSessionFinalizeTimer(sessionId) {
        const timer = this.sessionFinalizeTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.sessionFinalizeTimers.delete(sessionId);
        }
    }

    handleSessionFailed(sessionId) {
        if (sessionId) {
            this.cleanupRun(sessionId);
            this.clearSessionFinalizeTimer(sessionId);
            if (this.taskCount.running > 0) {
                this.taskCount.running -= 1;
            }
            this.taskCount.failed += 1;
            this.updateTaskCount();
        }
        this.log('error', `Session failed: ${sessionId}`);
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 20000);
    }

    stopHeartbeat() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    clearInput() {
        document.getElementById('userInput').value = '';
    }

    clearOutput() {
        document.getElementById('output').innerHTML = `
            <div class="empty-state">
                <div class="empty-title">No result yet</div>
                <div class="empty-text">Submit a task to see execution output.</div>
            </div>
        `;
    }

    clearLogs() {
        document.getElementById('logs').innerHTML = '';
    }

    exportOutput() {
        const text = document.getElementById('output').innerText;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `nac-output-${Date.now()}.txt`;
        anchor.click();

        URL.revokeObjectURL(url);
        this.showToast('Output exported.', 'success');
    }
}

const app = new NACApp();
