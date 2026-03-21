/**
 * API Server 启动入口
 * 运行此文件启动NAC Web服务
 */

import { getAPIServer } from './server.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('APIServer-Start');

async function main() {
  const apiServer = getAPIServer({
    port: parseInt(process.env.API_PORT || '3000'),
    host: process.env.API_HOST || '0.0.0.0',
  });

  try {
    logger.info('正在初始化API服务器...');
    await apiServer.initialize();

    logger.info('正在启动API服务器...');
    await apiServer.start();

    logger.info('');
    logger.info('==========================================');
    logger.info('  NAC API服务已启动');
    logger.info('==========================================');
    logger.info('');
    logger.info('  访问地址: http://localhost:3000');
    logger.info('  健康检查: http://localhost:3000/health');
    logger.info('  API文档:  http://localhost:3000/api/v1');
    logger.info('');
    logger.info('  按 Ctrl+C 停止服务');
    logger.info('==========================================');
    logger.info('');

    // 处理优雅关闭
    process.on('SIGINT', async () => {
      logger.info('收到停止信号，正在关闭服务器...');
      await apiServer.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('收到终止信号，正在关闭服务器...');
      await apiServer.stop();
      process.exit(0);
    });

  } catch (error: any) {
    logger.error({ error }, '启动API服务器失败');
    logger.error('');
    logger.error('可能的原因：');
    logger.error('  1. 端口3000已被占用');
    logger.error('  2. .env文件未配置或配置错误');
    logger.error('  3. 依赖未安装（运行 pnpm install）');
    logger.error('');
    process.exit(1);
  }
}

main();
