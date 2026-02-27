#!/usr/bin/env node
/**
 * 测试编码修复
 */

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename);

// 创建测试文件
const testTask = '生成一个用户登录 API';
const testFile = resolve(__dirname, 'test-input.txt');

// 使用 UTF-8 编码写入
writeFileSync(testFile, testTask, 'utf8');

console.log('✅ 测试文件已创建:', testFile);
console.log('✅ 文件内容:', testTask);
console.log('');

// 读取验证
const content = readFileSync(testFile, 'utf-8');
console.log('✅ 读取验证:', content);
console.log('');

console.log('现在运行测试命令:');
console.log('pnpm cli run --file test-input.txt');
