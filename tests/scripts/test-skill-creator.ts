import { getSkillManager } from '../../src/skills/SkillManager.js';

async function testSkillCreator() {
  console.log('🧪 测试 SkillCreatorSkill...\n');
  
  const skillManager = getSkillManager();
  await skillManager.initialize();
  
  const creatorSkill = skillManager.getSkill('skill-creator');
  
  if (!creatorSkill) {
    console.error('❌ SkillCreatorSkill 未找到！');
    return;
  }
  
  console.log('✅ SkillCreatorSkill 已加载');
  console.log('   版本:', creatorSkill.version);
  console.log('   描述:', creatorSkill.description);
  console.log('');
  
  // 测试: 创建一个简单的skill
  console.log('📝 测试: 创建 hello-world skill');
  
  const result = await creatorSkill.execute(
    { logger: console },
    {
      skillName: 'hello-world',
      description: '向世界打招呼的简单技能',
      category: 'automation',
      parameters: {
        required: ['name'],
        optional: ['greeting']
      }
    }
  );
  
  if (result.success) {
    console.log('✅ 成功！');
    console.log('   文件:', result.result.skill.filePath);
  } else {
    console.log('❌ 失败:', result.error);
  }
}

testSkillCreator();
