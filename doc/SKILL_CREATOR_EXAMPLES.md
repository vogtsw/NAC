# skill-creator 使用示例

## 示例1: 创建邮件发送Skill

```bash
pnpm cli chat

You> 创建一个新skill：
- skill名称: email-sender
- 描述: 使用SMTP协议发送邮件
- 类别: automation
- 必需参数: to, subject, body
- 可选参数: cc, bcc, attachments
```

## 示例2: 编程方式

```typescript
import { getSkillManager } from './dist/skills/SkillManager.js';

const skillManager = await getSkillManager();
const creatorSkill = skillManager.getSkill('skill-creator');

const result = await creatorSkill.execute(
  { logger: console },
  {
    skillName: 'csv-analyzer',
    description: '分析CSV文件并生成统计报告',
    category: 'data',
    parameters: {
      required: ['filePath'],
      optional: ['columns', 'groupBy']
    }
  }
);
```
