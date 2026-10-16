import type {
  AckType,
  BootstrapData,
  Conversation,
  EmbedBootstrapData,
  GuestSessionResponse,
  MessagesPage,
} from '../entities/nativeChannel';
import { HttpClient, type HttpClientOptions } from './httpClient';

export interface CreateGuestSessionBody {
  name: string;
  email: string;
  phone: string;
  remember: boolean;
  acceptedTermsVersion: string;
  deviceId: string;
  operationId: string;
  visitProof: string;
}

/**
 * HTTP client of the Gchat native channel. One method per endpoint;
 * state and lifecycle live in NativeChannelController.
 */
export class NativeChannelProvider {
  readonly http: HttpClient;

  constructor(options: string | HttpClientOptions) {
    this.http = new HttpClient(typeof options === 'string' ? { baseUrl: options } : options);
  }

  publicBootstrap(handle: string): Promise<BootstrapData> {
    return this.http.request({ method: 'POST', path: '/v1/widget/public/bootstrap', body: { handle } });
  }

  embedBootstrap(embedKey: string): Promise<EmbedBootstrapData> {
    return this.http.request({ method: 'POST', path: '/v1/widget/bootstrap', body: { embedKey } });
  }

  exchange(grant: string, parentOrigin: string): Promise<BootstrapData> {
    return this.http.request({
      method: 'POST',
      path: '/v1/widget/bootstrap/exchange',
      body: { grant, parentOrigin },
    });
  }

  createGuestSession(contextToken: string, body: CreateGuestSessionBody): Promise<GuestSessionResponse> {
    return this.http.request({
      method: 'POST',
      path: '/v1/widget/session/guest',
      body,
      headers: { 'X-Widget-Context': contextToken },
    });
  }

  startConversation(token: string, expectedClosedConversationId?: string | null): Promise<Conversation> {
    return this.http.request({
      method: 'POST',
      path: '/v1/widget/conversation/start',
      body: expectedClosedConversationId ? { expectedClosedConversationId } : {},
      token,
    });
  }

  sendMessage(token: string, text: string, clientKey: string): Promise<{ messageId: string }> {
    return this.http.request({
      method: 'POST',
      path: '/v1/widget/messages',
      body: { text, clientKey },
      token,
    });
  }

  getMessages(token: string, after?: string | null, limit = 100): Promise<MessagesPage> {
    return this.http.request({
      path: '/v1/widget/messages',
      query: { limit: String(limit), after: after ?? undefined },
      token,
    });
  }

  async ackMessages(token: string, type: AckType, messageIds: string[]): Promise<void> {
    await this.http.request({
      method: 'POST',
      path: '/v1/widget/messages/ack',
      body: { type, messageIds },
      token,
    });
  }

  finalizeConversation(token: string, conversationId: string): Promise<Conversation> {
    return this.http.request({
      method: 'POST',
      path: '/v1/widget/conversation/finalize',
      body: { expectedConversationId: conversationId },
      token,
    });
  }

  async deleteSession(token: string): Promise<void> {
    await this.http.request({ method: 'DELETE', path: '/v1/widget/session', token });
  }
}
