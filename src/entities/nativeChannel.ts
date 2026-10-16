export type ConversationState = 'new' | 'active' | 'expired' | 'closed';

export interface Conversation {
  conversationId?: string | null;
  state: ConversationState;
  expiresAt?: string | null;
  closedAt?: string | null;
  closedBy?: 'visitor' | 'agent' | 'system' | null;
  closedSource?: string | null;
}

export interface WidgetConfig {
  position?: string;
  primaryColor?: string;
  welcomeMessage?: string;
  launcherText?: string;
  logoUrl?: string | null;
  [key: string]: unknown;
}

/** Response of the public bootstrap (by handle) and of the embed exchange. */
export interface BootstrapData {
  config: WidgetConfig;
  contextToken: string;
  channelKey: string;
  termsVersion?: string | null;
  canonicalHandle?: string;
  webPushPublicKey?: string;
}

/** Response of the embed bootstrap (by embedKey). */
export interface EmbedBootstrapData {
  launcher: WidgetConfig;
  iframeUrl: string;
  grant: string;
  channelKey: string;
}

export interface Handle {
  handle: string;
  name: string;
  certified: boolean;
  isGuest?: boolean;
  hasAvatar?: boolean;
  avatarVersion?: string;
}

export interface GuestData {
  name: string;
  email: string;
  /** E.164 format, e.g. +5511999999999 */
  phone: string;
  remember?: boolean;
}

export interface GuestSessionResponse {
  token: string;
  expiresAt: string;
  handle: Handle;
  remember: boolean;
  conversation?: Conversation;
  realtimeContextToken?: string;
  realtimeContextExpiresAt?: string;
  phoneRequired?: boolean;
  phoneCanDefer?: boolean;
  webPushPublicKey?: string;
}

export interface GuestSession {
  token: string;
  expiresAt: string;
  handle: string;
  name: string;
  remember: boolean;
  visitProof: string;
  realtimeContextToken: string | null;
  raw: GuestSessionResponse;
}

export interface MessageMedia {
  fileName: string | null;
  mimeType: string | null;
}

export interface Message {
  id: string;
  direction: 'in' | 'out';
  type: string;
  text?: string | null;
  media?: MessageMedia | null;
  timestamp: number;
  status?: string;
  [key: string]: unknown;
}

export interface MessagesPage {
  messages: Message[];
  cursor?: string | null;
  conversation?: Conversation;
  registration?: { isGuest: boolean; [key: string]: unknown };
}

export type AckType = 'delivered' | 'read';
