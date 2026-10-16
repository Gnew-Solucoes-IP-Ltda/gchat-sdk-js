# gchat-sdk (JavaScript / TypeScript)

SDK for the [Gchat](https://gchat.app.br) native web chat channel. It lets an app chat with a Gchat channel as a **guest visitor**: bootstrap, guest session, conversation start, sending messages, polling and finishing.

- Written in TypeScript, published as ESM + CommonJS with type definitions.
- No runtime dependencies: uses the native `fetch` (Node 22+, browsers, React Native).
- Python version: [gchat-sdk](https://github.com/Gnew-Solucoes-IP-Ltda/gchat-sdk).

## Installation

```sh
npm install gchat-sdk
```

## Usage

### Node / backend (public bootstrap by handle)

```ts
import { NativeChannelController, NativeChannelProvider } from 'gchat-sdk';

const provider = new NativeChannelProvider('https://access.gchat.app.br');
const chat = new NativeChannelController(provider, { handle: 'your_channel_handle' });

await chat.bootstrap();
await chat.createGuestSession({ name: 'Name', email: 'name@example.com', phone: '+5511999999999' });
await chat.startConversation();
await chat.sendMessage('Hello');

for await (const messages of chat.poll({ intervalMs: 10_000 })) {
  // stops when the conversation is closed or expired
  for (const message of messages) {
    console.log(message.direction, message.text);
  }
}

await chat.logout();
```

### Browser (embed bootstrap by embedKey)

Browsers on other domains are blocked by CORS on the public bootstrap. Use the channel `embedKey`; the page must be served from a **domain registered in Gchat** for that key:

```ts
const chat = new NativeChannelController(new NativeChannelProvider('https://access.gchat.app.br'));

await chat.bootstrapEmbed('YOUR_EMBED_KEY'); // parentOrigin defaults to window.location.origin
await chat.createGuestSession({ name, email, phone });
await chat.startConversation();
```

The rest of the lifecycle is the same.

## API

### `NativeChannelController`

| Method | Description |
|---|---|
| `bootstrap(handle?)` | Public bootstrap by handle (Node/backend). |
| `bootstrapEmbed(embedKey, parentOrigin?)` | Embed bootstrap by embedKey (browser, registered domain). |
| `createGuestSession({ name, email, phone, remember? })` | Creates the guest and keeps the session token. Phone in E.164. Retries with the same data reuse the same `operationId` (idempotent). |
| `startConversation()` | Opens the conversation, or reopens a closed/expired one. |
| `sendMessage(text, clientKey?)` | Sends a text message and returns its `messageId`. |
| `getMessages({ after?, limit? })` | Fetches one page from the cursor and advances `cursor`. |
| `fetchNewMessages()` | Pages until there are no more new messages. |
| `poll({ intervalMs?, ack?, signal? })` | Async generator of new message batches. Stops when the conversation ends or `signal` aborts. Acknowledges incoming messages as `delivered` and `read` unless `ack: false`. |
| `ack(messageIds, type?)` | Acknowledges messages as `delivered` or `read`. |
| `finalizeConversation()` | Finishes the current conversation. |
| `logout()` | Revokes the guest token. |

State is available in `chat.session`, `chat.conversation`, `chat.cursor` and `chat.deviceId`. Persist `deviceId` (e.g. in `localStorage`) and pass it back in the options to reuse the same device:

```ts
new NativeChannelController(provider, { deviceId: localStorage.getItem('gchat_device_id') ?? undefined });
```

### Errors

Non-2xx responses throw `NativeChannelError` with `status`, `code` and `body`:

```ts
import { NativeChannelError } from 'gchat-sdk';

try {
  await chat.sendMessage('Hello');
} catch (error) {
  if (error instanceof NativeChannelError && error.code === 'CONVERSATION_START_REQUIRED') {
    await chat.startConversation();
  }
}
```

Common codes: `RATE_LIMIT_EXCEEDED`, `CONVERSATION_START_REQUIRED`, `CONVERSATION_CLOSED`, `SESSION_INVALID`, `SESSION_REVOKED`, `CHANNEL_DISABLED`, `GUEST_OPERATION_CONFLICT`.

### Custom fetch and timeout

```ts
new NativeChannelProvider({ baseUrl: 'https://access.gchat.app.br', timeoutMs: 30_000, fetch: myFetch });
```

## Examples

- [`examples/node-chat.ts`](examples/node-chat.ts): terminal chat (`npm run example:node`).
- [`examples/browser/`](examples/browser/): web page using the embed bootstrap.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

## Publishing

Publishing to npm runs from GitHub Actions when a `v*` tag is pushed (requires the `NPM_TOKEN` repository secret):

```sh
npm version patch   # or minor / major
git push --follow-tags
```

Or manually: `npm publish` (runs typecheck, tests and build first).

## License

MIT. See [LICENSE](LICENSE).
