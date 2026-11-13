import type { BookingProposal, GenerationRequest } from '../../shared/api';

interface TextContext {
  role: string;
  proposal?: BookingProposal | null;
  origin: string;
}

function bookingUrl(value: string, origin: string): URL | null {
  try {
    const url = new URL(value, origin);
    return ['http:', 'https:'].includes(url.protocol) &&
      url.pathname === '/booking' &&
      !url.username &&
      !url.password &&
      value.includes('?')
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Presentation only: the stored message and the proposal are never changed. */
export function assistantDisplayText(
  content: string,
  { role, proposal, origin }: TextContext,
): string {
  if (role !== 'assistant' || !proposal) return content;
  const canonical = proposal.url ? bookingUrl(proposal.url, origin) : null;
  const isOurs = (value: string) => {
    const url = bookingUrl(value, origin);
    if (!url) return false;
    if (value.startsWith('/booking?')) return true;
    return url.origin === origin || (!!canonical && url.href === canonical.href);
  };
  let removed = false;
  let text = content.replace(
    /!?\[([^\]\r\n]*)\]\(\s*(<?(?:https?:\/\/|\/booking\?)(?:[^\s()<>]|\([^()\r\n]*\))*?>?)(?:\s+["'][^"'\r\n]*["'])?\s*\)/gi,
    (whole, _label: string, destination: string) => {
      if (!isOurs(destination.replace(/^<|>$/g, ''))) return whole;
      removed = true;
      return '';
    },
  );
  text = text.replace(
    /https?:\/\/[^\s<>"'`]+|(?<![\w./:=?&%+\-])\/booking\?[^\s<>"'`]+/gi,
    (whole) => {
      const suffix = /[.,;:!?…\)\]\}]+$/.exec(whole)?.[0] || '';
      const destination = suffix ? whole.slice(0, -suffix.length) : whole;
      if (!isOurs(destination)) return whole;
      removed = true;
      return suffix;
    },
  );
  if (!removed) return content;
  return text
    .replace(/\(\s*\)|\[\s*\]|<\s*>|\*\*\s*\*\*/g, '')
    .replace(/^[ \t]*[.,;:!?…()[\]<>]+[ \t]*$/gm, '')
    .replace(
      /^[ \t]*(?:\*\*)?Подготовлена форма подтверждения[ \t]*[:.!—-]*[ \t]*(?:\*\*)?[ \t]*$/gim,
      'Форма готова.',
    )
    .replace(/^[ \t]*(?:Ссылка(?: на форму)?|Открыть форму(?: бронирования)?)[ \t]*:[ \t]*$/gim, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/:[ \t]*([.!?])/g, '$1')
    .replace(/[ \t]+\n|\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type ProposalRequest = Pick<GenerationRequest, 'id' | 'session_id' | 'status' | 'result'>;

/** Only a completion that this mounted panel actually awaited can open a form. */
export class ProposalAutoOpenGuard {
  private readonly awaited = new Map<string, string>();
  private readonly opened = new Set<string>();

  sent(request: ProposalRequest): void {
    if (!this.opened.has(request.id)) this.awaited.set(request.id, request.session_id);
  }

  pending(
    request: ProposalRequest | null,
    sessionId: string | null | undefined,
    current: boolean,
  ): void {
    if (
      current &&
      request &&
      request.session_id === sessionId &&
      ['pending', 'running'].includes(request.status)
    )
      this.sent(request);
  }

  completed(
    request: ProposalRequest | null,
    sessionId: string | null | undefined,
    current: boolean,
  ): BookingProposal | null {
    if (
      !current ||
      !request ||
      request.session_id !== sessionId ||
      request.status !== 'completed' ||
      !request.result?.proposal ||
      this.awaited.get(request.id) !== sessionId ||
      this.opened.has(request.id)
    )
      return null;
    this.awaited.delete(request.id);
    this.opened.add(request.id);
    return request.result.proposal;
  }
}
