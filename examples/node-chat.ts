/**
 * Terminal chat as a guest using the public bootstrap (by handle).
 *
 *   GCHAT_HANDLE=your_handle GUEST_NAME="Your Name" GUEST_EMAIL=you@example.com \
 *   GUEST_PHONE=+5511999999999 npm run example:node
 *
 * Type a message and press Enter to send it. Type /exit to finish the conversation.
 */
import { createInterface } from 'node:readline';
import { NativeChannelController, NativeChannelProvider } from '../src';

const GCHAT_URL = process.env.GCHAT_URL ?? 'https://access.gchat.app.br';
const { GCHAT_HANDLE, GUEST_NAME, GUEST_EMAIL, GUEST_PHONE } = process.env;

if (!GCHAT_HANDLE || !GUEST_NAME || !GUEST_EMAIL || !GUEST_PHONE) {
  console.error('Set GCHAT_HANDLE, GUEST_NAME, GUEST_EMAIL and GUEST_PHONE.');
  process.exit(1);
}

const controller = new NativeChannelController(new NativeChannelProvider(GCHAT_URL), { handle: GCHAT_HANDLE });
const stop = new AbortController();

await controller.bootstrap();
await controller.createGuestSession({ name: GUEST_NAME, email: GUEST_EMAIL, phone: GUEST_PHONE });
await controller.startConversation();
console.log(`Connected as @${controller.session?.handle}. Type /exit to finish.`);

const input = createInterface({ input: process.stdin });

input.on('line', async (line) => {
  const text = line.trim();

  if (text === '/exit') {
    stop.abort();
    return;
  }

  if (text) {
    await controller.sendMessage(text);
  }
});

try {
  for await (const messages of controller.poll({ intervalMs: 5_000, signal: stop.signal })) {
    for (const message of messages) {
      if (message.direction === 'in') {
        console.log(`< ${message.text ?? `[${message.type}]`}`);
      }
    }
  }
} finally {
  input.close();

  if (!controller.isConversationEnded()) {
    await controller.finalizeConversation();
  }

  await controller.logout();
  console.log('Conversation finished.');
}
