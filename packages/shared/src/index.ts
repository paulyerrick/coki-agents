// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  fullName?: string;
  churchName?: string;
  /** Free-text job title, e.g. "Executive Pastor" or "CEO". */
  jobTitle?: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

// ─── AI Provider ─────────────────────────────────────────────────────────────

export type AIProvider = 'claude' | 'openai' | 'gemini' | 'ollama';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey?: string;
  /** Ollama only */
  endpoint?: string;
  /** Ollama only */
  model?: string;
}

// ─── Integration ─────────────────────────────────────────────────────────────

export type IntegrationType =
  | 'nylas_email'
  | 'nylas_calendar'
  | 'monday'
  | 'asana'
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'twilio';

export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

export interface Integration {
  id: string;
  userId: string;
  type: IntegrationType;
  status: IntegrationStatus;
  /** Encrypted credentials and config stored per-integration */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent Message ───────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
}

export interface AgentMessage {
  id: string;
  userId: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  createdAt: string;
}

// ─── Tool ────────────────────────────────────────────────────────────────────

export interface ToolInputProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolInputProperty;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolInputProperty>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

// ─── Calendar Event ──────────────────────────────────────────────────────────

export type AttendeeStatus = 'accepted' | 'declined' | 'tentative' | 'noreply';

export interface Attendee {
  name?: string;
  email: string;
  status?: AttendeeStatus;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  attendees?: Attendee[];
  conferenceUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Email ───────────────────────────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface Email {
  id: string;
  threadId: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  snippet: string;
  body?: string;
  date: string;
  unread: boolean;
  starred?: boolean;
  labels?: string[];
}

export interface EmailThread {
  id: string;
  subject: string;
  participants: EmailAddress[];
  messages: Email[];
  unread: boolean;
  updatedAt: string;
}

// ─── API Response shapes ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  error?: never;
}

export interface ApiError {
  data?: never;
  error: {
    message: string;
    code?: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
