import WebSocket from 'ws';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

type ProgressEvent = {
  type: string;
  eventType?: string;
  sessionId?: string;
  payload?: Record<string, any>;
  timestamp?: string;
  data?: any;
  error?: string;
};

function now() {
  return new Date().toISOString();
}

async function run() {
  const wsUrl = process.env.NAC_WS_URL || 'ws://localhost:3000/ws';
  const timeoutMs = parseInt(process.env.NAC_LONG_TIMEOUT || '180000', 10);
  const sessionId = `web-long-${Date.now()}`;
  const userInput =
    process.argv.slice(2).join(' ').trim() ||
    '请分多个步骤分析当前仓库的架构改进点，给出具体可落地的优化建议，并说明优先级与风险。';

  const events: ProgressEvent[] = [];
  const startedAt = Date.now();

  const stats = {
    taskUpdated: 0,
    taskCompleted: 0,
    taskFailed: 0,
    sessionCompleted: 0,
    sessionFailed: 0,
  };

  const ws = new WebSocket(wsUrl);

  const finish = async (status: 'success' | 'error' | 'timeout', reason?: string) => {
    const durationMs = Date.now() - startedAt;
    const report = {
      status,
      reason: reason || '',
      wsUrl,
      sessionId,
      userInput,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs,
      stats,
      eventCount: events.length,
      events,
    };

    const reportDir = join(process.cwd(), 'memory', 'test-results');
    await mkdir(reportDir, { recursive: true });
    const reportPath = join(reportDir, `web-long-debug-${Date.now()}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`[${now()}] status=${status} durationMs=${durationMs} report=${reportPath}`);
    process.exit(status === 'success' ? 0 : 1);
  };

  const timeout = setTimeout(() => {
    void finish('timeout', `No terminal result within ${timeoutMs}ms`);
  }, timeoutMs);

  ws.on('open', () => {
    console.log(`[${now()}] ws connected, session=${sessionId}`);
    ws.send(
      JSON.stringify({
        type: 'task',
        sessionId,
        userInput,
        context: { source: 'web-long-debug-script' },
      })
    );
  });

  ws.on('message', (raw) => {
    const text = raw.toString();
    let data: ProgressEvent;

    try {
      data = JSON.parse(text);
    } catch {
      console.log(`[${now()}] non-json message: ${text}`);
      return;
    }

    events.push(data);

    if (data.type === 'task.progress') {
      switch (data.eventType) {
        case 'task.updated':
          stats.taskUpdated += 1;
          break;
        case 'task.completed':
          stats.taskCompleted += 1;
          break;
        case 'task.failed':
          stats.taskFailed += 1;
          break;
        case 'session.completed':
          stats.sessionCompleted += 1;
          break;
        case 'session.failed':
          stats.sessionFailed += 1;
          break;
      }
      const taskName = data.payload?.taskName || data.payload?.taskId || '-';
      const taskId = data.payload?.taskId || '-';
      const agentType = data.payload?.agentType || '-';
      const skills = Array.isArray(data.payload?.requiredSkills) ? data.payload.requiredSkills.join(',') : '-';
      console.log(
        `[${now()}] progress ${data.eventType} task=${taskName} id=${taskId} agent=${agentType} skills=${skills}`
      );
      return;
    }

    if (data.type === 'task.accepted') {
      console.log(`[${now()}] accepted session=${data.sessionId}`);
      return;
    }

    if (data.type === 'result') {
      clearTimeout(timeout);
      const success = !!data.data?.success;
      console.log(`[${now()}] result success=${success}`);
      const reason = success ? undefined : data.data?.error || 'Task result indicates failure';
      void finish(success ? 'success' : 'error', reason);
      return;
    }

    if (data.type === 'error') {
      clearTimeout(timeout);
      console.log(`[${now()}] ws error payload: ${data.error || 'unknown'}`);
      void finish('error', data.error || 'Unknown websocket error');
    }
  });

  ws.on('error', (error) => {
    clearTimeout(timeout);
    void finish('error', error.message);
  });

  ws.on('close', (code) => {
    if (code === 1000) return;
    clearTimeout(timeout);
    void finish('error', `WebSocket closed unexpectedly: code=${code}`);
  });
}

void run();
