// Browser example using the embed bootstrap (by embedKey).
// The page must be served from a domain registered in Gchat for this embedKey:
//   npm run build && npx serve .    → open /examples/browser/
import { NativeChannelController, NativeChannelProvider } from '../../dist/index.js';

const GCHAT_URL = 'https://access.gchat.app.br';
const EMBED_KEY = 'YOUR_EMBED_KEY';

const DEVICE_KEY = 'gchat_device_id';
const controller = new NativeChannelController(new NativeChannelProvider(GCHAT_URL), {
  deviceId: localStorage.getItem(DEVICE_KEY) ?? undefined,
});
localStorage.setItem(DEVICE_KEY, controller.deviceId);

const stop = new AbortController();
const guestForm = document.querySelector('#guest');
const composer = document.querySelector('#composer');
const log = document.querySelector('#log');

function append(direction, text) {
  const line = document.createElement('p');
  line.className = direction;
  line.textContent = text;
  log.append(line);
  log.scrollTop = log.scrollHeight;
}

guestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(guestForm));

  await controller.bootstrapEmbed(EMBED_KEY); // parentOrigin = window.location.origin
  await controller.createGuestSession({ name: data.name, email: data.email, phone: data.phone });
  await controller.startConversation();

  guestForm.hidden = true;
  document.querySelector('#chat').hidden = false;

  for await (const messages of controller.poll({ intervalMs: 5_000, signal: stop.signal })) {
    for (const message of messages) {
      append(message.direction, message.text ?? `[${message.type}]`);
    }
  }

  append('in', 'Conversa encerrada.');
});

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = composer.elements.namedItem('text');
  const text = input.value.trim();
  input.value = '';

  if (text) {
    await controller.sendMessage(text);
  }
});

document.querySelector('#finish').addEventListener('click', async () => {
  stop.abort();
  await controller.finalizeConversation();
  await controller.logout();
});
