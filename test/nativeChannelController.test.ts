import { describe, expect, it, vi } from 'vitest';
import { NativeChannelController, NativeChannelError, NativeChannelProvider, type SleepFunction } from '../src';
import { type MockReply, mockFetch } from './helpers/mockFetch';

const BASE_URL = 'https://chat.example.com';

const BOOTSTRAP = {
  config: { position: 'bottom_right', primaryColor: '#000000' },
  contextToken: 'context-token',
  channelKey: 'channel-key',
  termsVersion: '2026-07-01',
};

const EMBED_BOOTSTRAP = {
  launcher: { position: 'bottom_right' },
  iframeUrl: `${BASE_URL}/widget`,
  grant: 'grant-token',
  channelKey: 'channel-key',
};

const GUEST_SESSION = {
  token: 'session-token',
  expiresAt: '2026-10-17T13:52:56.194Z',
  handle: { handle: 'fulano_abc123', name: 'Fulano de Tal', certified: false, isGuest: true },
  remember: false,
  realtimeContextToken: 'realtime-token',
};

const ACTIVE = { conversationId: 'conversation-1', state: 'active', expiresAt: '2026-10-17T13:52:58.712Z' };
const CLOSED = {
  conversationId: 'conversation-1',
  state: 'closed',
  closedAt: '2026-10-16T17:02:15Z',
  closedBy: 'visitor',
  closedSource: 'widget',
};

const GUEST = { name: 'Fulano de Tal', email: 'fulano@example.com', phone: '+5511999990000' };

function setup(routes: Record<string, MockReply | MockReply[]> = {}) {
  const mock = mockFetch({
    'POST /v1/widget/public/bootstrap': { body: BOOTSTRAP },
    'POST /v1/widget/bootstrap': { body: EMBED_BOOTSTRAP },
    'POST /v1/widget/bootstrap/exchange': { body: BOOTSTRAP },
    'POST /v1/widget/session/guest': { body: GUEST_SESSION },
    'POST /v1/widget/conversation/start': { body: ACTIVE },
    'POST /v1/widget/messages': { body: { messageId: 'message-1' } },
    'POST /v1/widget/messages/ack': { status: 204 },
    'POST /v1/widget/conversation/finalize': { body: CLOSED },
    'DELETE /v1/widget/session': { status: 204 },
    ...routes,
  });
  const sleep = vi.fn<SleepFunction>(async () => {});
  const provider = new NativeChannelProvider({ baseUrl: BASE_URL, fetch: mock.fetch });
  const controller = new NativeChannelController(provider, { handle: 'channel', deviceId: 'device-1', sleep });
  return { ...mock, controller, sleep };
}

async function setupLogged(routes: Record<string, MockReply | MockReply[]> = {}) {
  const context = setup(routes);
  await context.controller.createGuestSession(GUEST);
  return context;
}

describe('bootstrap', () => {
  it('uses the public bootstrap by handle', async () => {
    const { controller, callsTo } = setup();
    const data = await controller.bootstrap();
    expect(callsTo('POST', '/v1/widget/public/bootstrap')[0]?.body).toEqual({ handle: 'channel' });
    expect(data.contextToken).toBe('context-token');
  });

  it('exchanges the embed grant with the parent origin', async () => {
    const { controller, callsTo } = setup();
    await controller.bootstrapEmbed('embed-key', 'https://site.example.com');
    expect(callsTo('POST', '/v1/widget/bootstrap')[0]?.body).toEqual({ embedKey: 'embed-key' });
    expect(callsTo('POST', '/v1/widget/bootstrap/exchange')[0]?.body).toEqual({
      grant: 'grant-token',
      parentOrigin: 'https://site.example.com',
    });
    expect(controller.bootstrapData?.contextToken).toBe('context-token');
  });

  it('rejects an exchange for another channel', async () => {
    const { controller } = setup({
      'POST /v1/widget/bootstrap/exchange': { body: { ...BOOTSTRAP, channelKey: 'other' } },
    });
    await expect(controller.bootstrapEmbed('embed-key', 'https://site.example.com')).rejects.toMatchObject({
      code: 'INVALID_WIDGET_CONTEXT',
    });
  });

  it('requires parentOrigin outside the browser', async () => {
    const { controller } = setup();
    await expect(controller.bootstrapEmbed('embed-key')).rejects.toThrow('parentOrigin');
  });
});

describe('createGuestSession', () => {
  it('sends device, operation and visit proof with the widget context', async () => {
    const { controller, callsTo } = await setupLogged();
    const call = callsTo('POST', '/v1/widget/session/guest')[0];
    expect(call?.headers['X-Widget-Context']).toBe('context-token');
    expect(call?.body).toMatchObject({ ...GUEST, remember: false, acceptedTermsVersion: '2026-07-01', deviceId: 'device-1' });
    expect(call?.body?.operationId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(call?.body?.visitProof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(controller.session).toMatchObject({ token: 'session-token', handle: 'fulano_abc123' });
    expect(controller.session?.visitProof).toBe(call?.body?.visitProof);
  });

  it('reuses the operationId when retrying the same payload', async () => {
    const { controller, callsTo } = setup({
      'POST /v1/widget/session/guest': [{ status: 500, body: { code: 'INTERNAL' } }, { body: GUEST_SESSION }],
    });
    await expect(controller.createGuestSession(GUEST)).rejects.toBeInstanceOf(NativeChannelError);
    await controller.createGuestSession(GUEST);
    const [first, second] = callsTo('POST', '/v1/widget/session/guest');
    expect(first?.body?.operationId).toBe(second?.body?.operationId);
  });

  it('creates a new operationId when the payload changes', async () => {
    const { controller, callsTo } = setup({
      'POST /v1/widget/session/guest': [{ status: 500, body: { code: 'INTERNAL' } }, { body: GUEST_SESSION }],
    });
    await expect(controller.createGuestSession(GUEST)).rejects.toBeInstanceOf(NativeChannelError);
    await controller.createGuestSession({ ...GUEST, name: 'Fulano' });
    const [first, second] = callsTo('POST', '/v1/widget/session/guest');
    expect(first?.body?.operationId).not.toBe(second?.body?.operationId);
  });

  it('requires a session before chatting', async () => {
    const { controller } = setup();
    await expect(controller.sendMessage('oi')).rejects.toThrow('Session not started');
  });
});

describe('conversation', () => {
  it('starts a conversation with the bearer token', async () => {
    const { controller, callsTo } = await setupLogged();
    const conversation = await controller.startConversation();
    const call = callsTo('POST', '/v1/widget/conversation/start')[0];
    expect(call?.headers.Authorization).toBe('Bearer session-token');
    expect(call?.body).toEqual({});
    expect(conversation.state).toBe('active');
  });

  it('reopens after a closed conversation', async () => {
    const { controller, callsTo } = await setupLogged();
    controller.conversation = CLOSED as never;
    await controller.startConversation();
    expect(callsTo('POST', '/v1/widget/conversation/start')[0]?.body).toEqual({
      expectedClosedConversationId: 'conversation-1',
    });
  });

  it('adopts the server state on 409', async () => {
    const { controller } = await setupLogged({
      'POST /v1/widget/conversation/start': { status: 409, body: { code: 'CONVERSATION_CHANGED', conversation: ACTIVE } },
    });
    expect(await controller.startConversation()).toEqual(ACTIVE);
  });

  it('finalizes the current conversation', async () => {
    const { controller, callsTo } = await setupLogged();
    await controller.startConversation();
    const conversation = await controller.finalizeConversation();
    expect(callsTo('POST', '/v1/widget/conversation/finalize')[0]?.body).toEqual({
      expectedConversationId: 'conversation-1',
    });
    expect(conversation.state).toBe('closed');
    expect(controller.isConversationEnded()).toBe(true);
  });
});

describe('messages', () => {
  it('sends a text message', async () => {
    const { controller, callsTo } = await setupLogged();
    const messageId = await controller.sendMessage('oi', 'client-1');
    expect(callsTo('POST', '/v1/widget/messages')[0]?.body).toEqual({ text: 'oi', clientKey: 'client-1' });
    expect(messageId).toBe('message-1');
  });

  it('advances the cursor', async () => {
    const { controller, callsTo } = await setupLogged({
      'GET /v1/widget/messages': [
        { body: { messages: [{ id: 'm1', direction: 'out', type: 'chat', text: 'oi', timestamp: 1 }], cursor: 'c1', conversation: ACTIVE } },
        { body: { messages: [], cursor: 'c1', conversation: ACTIVE } },
      ],
    });
    expect(await controller.getMessages()).toHaveLength(1);
    expect(controller.cursor).toBe('c1');
    await controller.getMessages();
    const [first, second] = callsTo('GET', '/v1/widget/messages');
    expect(first?.query).toEqual({ limit: '100' });
    expect(second?.query).toEqual({ limit: '100', after: 'c1' });
  });

  it('polls, acknowledges incoming messages and stops when closed', async () => {
    const { controller, callsTo, sleep } = await setupLogged({
      'GET /v1/widget/messages': [
        {
          body: {
            messages: [
              { id: 'm1', direction: 'out', type: 'chat', text: 'oi', timestamp: 1 },
              { id: 'm2', direction: 'in', type: 'chat', text: 'Olá', timestamp: 2 },
            ],
            cursor: 'c2',
            conversation: ACTIVE,
          },
        },
        { body: { messages: [], cursor: 'c2', conversation: ACTIVE } },
        { body: { messages: [], cursor: 'c2', conversation: CLOSED } },
      ],
    });
    const batches = [];

    for await (const batch of controller.poll({ intervalMs: 5_000 })) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(callsTo('POST', '/v1/widget/messages/ack').map((call) => call.body)).toEqual([
      { type: 'delivered', messageIds: ['m2'] },
      { type: 'read', messageIds: ['m2'] },
    ]);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep.mock.calls[0]?.[0]).toBe(5_000);
  });

  it('stops polling when the signal aborts', async () => {
    const { controller, callsTo } = await setupLogged({
      'GET /v1/widget/messages': { body: { messages: [], conversation: ACTIVE } },
    });
    const abort = new AbortController();
    abort.abort();

    for await (const batch of controller.poll({ signal: abort.signal })) {
      expect(batch).toBeUndefined();
    }

    expect(callsTo('GET', '/v1/widget/messages')).toHaveLength(0);
  });
});

describe('errors and logout', () => {
  it('parses the error code from the body', async () => {
    const { controller } = await setupLogged({
      'POST /v1/widget/messages': { status: 409, body: { title: 'CONVERSATION_START_REQUIRED' } },
    });
    await expect(controller.sendMessage('oi')).rejects.toMatchObject({
      status: 409,
      code: 'CONVERSATION_START_REQUIRED',
    });
  });

  it('falls back to HTTP_<status> without a JSON body', async () => {
    const { controller } = await setupLogged({ 'POST /v1/widget/messages': { status: 502 } });
    await expect(controller.sendMessage('oi')).rejects.toMatchObject({ status: 502, code: 'HTTP_502' });
  });

  it('logs out ignoring an already invalid session', async () => {
    const { controller } = await setupLogged({
      'DELETE /v1/widget/session': { status: 401, body: { code: 'SESSION_INVALID' } },
    });
    await controller.logout();
    expect(controller.session).toBeNull();
  });
});
