D:\test\agent\jiqun\test.md是这个工程总任务要求，如果在用户命令中有新增加功能，先在task.md里面增加相关功能后再在工程里面进行修改；
2.每次任务执行都按照下面流程进行
3.1.每次任务开始前先与task.md里面对齐是否严格按照这个md进行的工程开发；
4.2.每次开发前都基于任务先构建测试用例执行测试，并把测试记录在D:\test\agent\jiqun\test.md，把测试代码放在D:\test\agent\jiqun\tests文件夹里面 ；在对工程进行测试时候，只使用 pnpm cli chat这种真实的用户交互的聊天模式来测试，尽可能使用比较复杂的任务要求 涉及到多agent场景和skill调用 ，不要简单输入你好这种提示词进行测试
5.3.完成每次开发后把工程提交到github上：https://github.com/vogtsw/NAC.git，注意不提交task.md 和test.md的等md不在task.md架构里面内容；并且禁止提交api key到github
6.4.每次修改了某个功能后都把对应功能都加到task.md里面，并整理task.md的整体框架


⚠️ 重要提示：API密钥应从环境变量或.env文件读取，不要硬编码在任何文件中！
