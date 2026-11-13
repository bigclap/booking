export { ApiError, GatewayClient, createGatewayClient } from './client';
export type {
  BookingPolicy,
  BootstrapSnapshot,
  OfficeCreateInput,
  OfficeSettingsInput,
  BookingInput,
  AssistantCapabilities,
  ChatSession,
  ChatMessage,
  Dialogue,
  BookingProposal,
  GenerationRequest,
  GenerationSnapshot,
  ChatContext,
  AccessOperation,
  ApiFieldError,
  GatewayClientOptions,
} from './client';
export { gateway, SESSION_INVALIDATED_EVENT, ACCESS_OPERATION_EVENT } from './gateway';
