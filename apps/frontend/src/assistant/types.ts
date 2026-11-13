import type { OfficeConfig } from '../office';
import type { BookingProposal } from '../shared/api';
export interface AssistantConversationState {
  hasConversation: boolean;
  hasDraft: boolean;
  processing: boolean;
}

export interface AssistantPanelProps {
  office: OfficeConfig;
  floorId: string;
  date: string;
  onClose: () => void;
  onBookingsChanged: () => Promise<void>;
  onProposal: (proposal: BookingProposal) => void;
  onConversationState?: (state: AssistantConversationState) => void;
}
