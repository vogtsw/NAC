# HelloWorld Skill

> **创建时间**: 2026-03-11T14:40:25.273Z
> **技能名称**: hello-world
> **类别**: automation

## 描述

向世界打招呼的简单技能

## 参数

### 必需参数
- `name`

### 可选参数
- `greeting`

## 使用示例

```typescript
// 通过SkillManager使用
const skillManager = getSkillManager();
const skill = skillManager.getSkill('hello-world');

const result = await skill.execute(
  { logger: console },
  {
    name: value
  }
);
```

## 文件位置

`D:\test\agent\jiqun\skills\custom\hello-world.ts`

## 下一步

1. 检查生成的代码是否正确
2. 实现具体的业务逻辑
3. 添加单元测试
4. 更新文档
5. 注册到SkillManager

## 自动生成

本技能由 SkillCreator 自动生成 🤖
