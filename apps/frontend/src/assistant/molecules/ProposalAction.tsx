import { ArrowRight } from 'lucide-react';
import type { BookingProposal } from '../../shared/api';
import { Button } from '../../shared/atoms';
export function ProposalAction({
  proposal,
  onProposal,
}: {
  proposal: BookingProposal;
  onProposal: (proposal: BookingProposal) => void;
}) {
  return (
    <Button className="bk-chat-proposal" onClick={() => onProposal(proposal)}>
      Открыть форму бронирования
      <ArrowRight size={14} />
    </Button>
  );
}
