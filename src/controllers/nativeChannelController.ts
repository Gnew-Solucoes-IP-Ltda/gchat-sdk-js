import type {
  AckType,
  BootstrapData,
  Conversation,
  GuestData,
  GuestSession,
  Message,
} from '../entities/nativeChannel';
import { NativeChannelError } from '../errors';
import type { NativeChannelProvider } from '../providers/nativeChannelProvider';
import { randomToken, randomUUID } from '../utils/random';

export type SleepFunction = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface NativeChannelControllerOptions {
  /** Channel handle, used by the public bootstrap (Node/backend). */
  handle?: string;
  /** Persist and reuse it so the server recognizes the same device across runs. */
  deviceId?: string;
  sleep?: SleepFunction;
}

export interface PollOptions {
  intervalMs?: number;
  /** Acknowledge incoming messages as delivered and read. Default: true. */
  ack?: boolean;
  /** Stops polling (also interrupts the wait between requests). */
  signal?: AbortSignal;
}

const ENDED_STATES = ['closed', 'expired'];
const SESSION_GONE_CODES = ['SESSION_INVALID', 'SESSION_REVOKED'];

export const defaultSleep: SleepFunction = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * Lifecycle of a guest visitor on the Gchat native channel:
 * bootstrap -> createGuestSession -> startConversation -> sendMessage/poll
 * -> finalizeConversation -> logout
 */
export class NativeChannelController {
  readonly deviceId: string;
  bootstrapData: BootstrapData | null = null;
  session: GuestSession | null = null;
  conversation: Conversation | null = null;
  cursor: string | null = null;

  private readonly handle: string | undefined;
  private readonly sleep: SleepFunction;
  private operation: { fingerprint: string; id: string } | null = null;

  constructor(
    private readonly provider: NativeChannelProvider,
    options: NativeChannelControllerOptions = {},
  ) {
    this.handle = options.handle;
    this.deviceId = options.deviceId ?? randomUUID();
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Public bootstrap by handle. Meant for Node/backend: browsers on other domains are blocked by CORS. */
  async bootstrap(handle: string | undefined = this.handle): Promise<BootstrapData> {
    if (!handle) {
      throw new Error('handle is required for the public bootstrap.');
    }

    this.bootstrapData = await this.provider.publicBootstrap(handle);
    return this.bootstrapData;
  }

  /**
   * Embed bootstrap by embedKey. Meant for browsers on a domain registered in Gchat.
   * parentOrigin defaults to window.location.origin.
   */
  async bootstrapEmbed(embedKey: string, parentOrigin: string | undefined = currentOrigin()): Promise<BootstrapData> {
    if (!parentOrigin) {
      throw new Error('parentOrigin is required outside the browser.');
    }

    const embed = await this.provider.embedBootstrap(embedKey);
    const data = await this.provider.exchange(embed.grant, parentOrigin);

    if (data.channelKey !== embed.channelKey) {
      throw new NativeChannelError(401, 'INVALID_WIDGET_CONTEXT');
    }

    this.bootstrapData = data;
    return this.bootstrapData;
  }

  /** Creates the guest and keeps its Bearer token. Call bootstrap() or bootstrapEmbed() before. */
  async createGuestSession({ name, email, phone, remember = false }: GuestData): Promise<GuestSession> {
    if (!this.bootstrapData) {
      if (!this.handle) {
        throw new Error('Call bootstrap() or bootstrapEmbed() before createGuestSession().');
      }

      await this.bootstrap();
    }

    const bootstrapData = this.bootstrapData as BootstrapData;
    const payload = {
      name,
      email,
      phone,
      remember,
      acceptedTermsVersion: bootstrapData.termsVersion ?? '',
    };

    // operationId is an idempotency key: reuse it when retrying the same payload
    const fingerprint = JSON.stringify(payload);

    if (!this.operation || this.operation.fingerprint !== fingerprint) {
      this.operation = { fingerprint, id: randomToken() };
    }

    const visitProof = this.session?.visitProof ?? randomToken();
    const data = await this.provider.createGuestSession(bootstrapData.contextToken, {
      ...payload,
      deviceId: this.deviceId,
      operationId: this.operation.id,
      visitProof,
    });

    this.operation = null;
    this.session = {
      token: data.token,
      expiresAt: data.expiresAt ?? '',
      handle: data.handle?.handle ?? '',
      name: data.handle?.name ?? name,
      remember: data.remember ?? remember,
      visitProof,
      realtimeContextToken: data.realtimeContextToken ?? null,
      raw: data,
    };
    this.updateConversation(data.conversation);
    this.cursor = null;
    return this.session;
  }

  /** Opens the conversation, or reopens a closed/expired one. */
  async startConversation(): Promise<Conversation> {
    const expectedClosedId = this.isConversationEnded() ? this.conversation?.conversationId : null;

    try {
      this.updateConversation(await this.provider.startConversation(this.token(), expectedClosedId));
    } catch (error) {
      // 409: the conversation changed on the server; the body may carry the current state
      const conversation = error instanceof NativeChannelError ? error.body.conversation : undefined;

      if (error instanceof NativeChannelError && error.status === 409 && isObject(conversation)) {
        this.updateConversation(conversation as unknown as Conversation);
      } else {
        throw error;
      }
    }

    return this.conversation as Conversation;
  }

  /** Sends a text message and returns its messageId. */
  async sendMessage(text: string, clientKey: string = randomUUID()): Promise<string> {
    const data = await this.provider.sendMessage(this.token(), text, clientKey);
    return data.messageId;
  }

  /** Fetches one page of messages from the cursor and advances it. */
  async getMessages(options: { after?: string | null; limit?: number } = {}): Promise<Message[]> {
    const after = options.after !== undefined ? options.after : this.cursor;
    const page = await this.provider.getMessages(this.token(), after, options.limit);

    if (page.cursor) {
      this.cursor = page.cursor;
    }

    this.updateConversation(page.conversation);
    return page.messages ?? [];
  }

  /** Pages until there are no more new messages. */
  async fetchNewMessages(): Promise<Message[]> {
    const messages: Message[] = [];

    while (true) {
      const previous = this.cursor;
      const page = await this.getMessages();
      messages.push(...page);

      if (page.length === 0 || this.cursor === previous) {
        return messages;
      }
    }
  }

  async ack(messageIds: string[], type: AckType = 'read'): Promise<void> {
    if (messageIds.length > 0) {
      await this.provider.ackMessages(this.token(), type, messageIds);
    }
  }

  /** Yields batches of new messages until the conversation is closed/expired or the signal aborts. */
  async *poll({ intervalMs = 10_000, ack = true, signal }: PollOptions = {}): AsyncGenerator<Message[]> {
    while (!signal?.aborted) {
      const messages = await this.fetchNewMessages();

      if (messages.length > 0) {
        const incoming = messages.filter((message) => message.direction === 'in').map((message) => message.id);

        if (ack && incoming.length > 0) {
          await this.ack(incoming, 'delivered');
          await this.ack(incoming, 'read');
        }

        yield messages;
      }

      if (this.isConversationEnded()) {
        return;
      }

      await this.sleep(intervalMs, signal);
    }
  }

  isConversationEnded(): boolean {
    return !!this.conversation && ENDED_STATES.includes(this.conversation.state);
  }

  async finalizeConversation(): Promise<Conversation> {
    const conversationId = this.conversation?.conversationId;

    if (!conversationId) {
      throw new Error('No conversation to finalize.');
    }

    this.updateConversation(await this.provider.finalizeConversation(this.token(), conversationId));
    return this.conversation as Conversation;
  }

  /** Revokes the guest token. */
  async logout(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      await this.provider.deleteSession(this.session.token);
    } catch (error) {
      if (!(error instanceof NativeChannelError && SESSION_GONE_CODES.includes(error.code))) {
        throw error;
      }
    }

    this.session = null;
    this.conversation = null;
    this.cursor = null;
  }

  private token(): string {
    if (!this.session) {
      throw new Error('Session not started: call createGuestSession() first.');
    }

    return this.session.token;
  }

  private updateConversation(conversation: Conversation | undefined | null): void {
    if (conversation) {
      this.conversation = conversation;
    }
  }
}

function currentOrigin(): string | undefined {
  const location = (globalThis as { location?: { origin?: string } }).location;
  return location?.origin && location.origin !== 'null' ? location.origin : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
