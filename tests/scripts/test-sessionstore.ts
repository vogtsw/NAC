/**
 * Test SessionStore functionality
 */

import { createSessionStore } from './dist/state/SessionStore.js';

async function testSessionStore() {
  const sessionStore = createSessionStore();

  console.log('1. Ensuring directories...');
  await sessionStore.ensureDirectories();
  console.log('✓ Directories ensured');

  const testSessionId = `test-${Date.now()}`;

  console.log('\n2. Creating session...');
  await sessionStore.createSession(testSessionId, { userId: 'test-user' });
  console.log('✓ Session created');

  console.log('\n3. Adding user message...');
  await sessionStore.addMessage(testSessionId, 'user', 'Hello, this is a test message with some code:\n```typescript\nconst x = 42;\n```');
  console.log('✓ User message added');

  console.log('\n4. Adding assistant response...');
  await sessionStore.addMessage(testSessionId, 'assistant', 'This is a test response. Here is the result:\n\n{"success": true, "data": "test data"}');
  console.log('✓ Assistant response added');

  console.log('\n5. Updating status to completed...');
  await sessionStore.updateStatus(testSessionId, 'completed');
  console.log('✓ Status updated');

  console.log('\n6. Checking if file exists...');
  const path = `memory/sessions/${testSessionId}.md`;
  const fs = await import('fs');
  if (fs.existsSync(path)) {
    console.log(`✓ File exists: ${path}`);
    const content = await fs.readFile(path, 'utf-8');
    console.log('\n--- File Content ---');
    console.log(content);
    console.log('--- End of Content ---');
  } else {
    console.log(`✗ File NOT found: ${path}`);
  }

  console.log('\n7. Getting session content...');
  const sessionContent = await sessionStore.getSessionContent(testSessionId);
  console.log(`✓ Session content length: ${sessionContent?.length || 0} characters`);

  console.log('\n✅ All tests completed!');
}

testSessionStore().catch(console.error);
