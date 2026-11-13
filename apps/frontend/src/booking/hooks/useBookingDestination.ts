import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/hooks';
import type { AppUser } from '../../auth/types';
import { useOffices } from '../../office/hooks';
import type { OfficeConfig } from '../../office';
import type { BookingProposal } from '../../shared/api';
import {
  parseBookingLink,
  proposalToBookingPrefill,
  validateBookingLink,
} from '../lib/bookingLink';
import type { BookingPrefill } from '../lib/bookingLink';

interface LinkResolution {
  prefill: BookingPrefill | null;
  error: string;
}
export interface BookingDestinationState {
  user: AppUser | null;
  office: OfficeConfig | null;
  linkError: string;
  handedOff: boolean;
  accepted: BookingPrefill | undefined;
  openProposal: (proposal: BookingProposal) => void;
}

/** Validate access before mounting a booking workspace and hand a proposal off only once. */
export function useBookingDestination(): BookingDestinationState {
  const { user } = useAuth();
  const catalog = useOffices();
  const [link] = useState<LinkResolution>(() => {
    try {
      return { prefill: parseBookingLink(window.location.search), error: '' };
    } catch (cause) {
      return {
        prefill: null,
        error: cause instanceof Error ? cause.message : 'Не удалось прочитать ссылку на форму.',
      };
    }
  });
  const [handedOff, setHandedOff] = useState<boolean>(!link.prefill);
  const [accepted, setAccepted] = useState<BookingPrefill | undefined>();
  const prefillOfficeSeen = useRef<boolean>(false);
  const [selectionError, setSelectionError] = useState<string>('');
  let linkError = link.error || selectionError;
  let validated: BookingPrefill | undefined;
  if (link.prefill && !handedOff && !linkError) {
    const target = catalog.accessibleOffices.find((item) => item.id === link.prefill!.officeId);
    if (!target) linkError = 'Офис из ссылки недоступен или больше не существует.';
    else {
      try {
        validated = validateBookingLink(link.prefill, target);
      } catch (cause) {
        linkError = cause instanceof Error ? cause.message : 'Пространство из ссылки недоступно.';
      }
    }
  }
  useEffect(() => {
    if (handedOff || linkError || !validated) return;
    try {
      if (catalog.office?.id !== validated.officeId) catalog.selectOffice(validated.officeId);
      setAccepted(validated);
      setHandedOff(true);
    } catch (cause) {
      setSelectionError(
        cause instanceof Error ? cause.message : 'Не удалось выбрать офис из ссылки.',
      );
    }
  }, [handedOff, linkError, validated, catalog.office?.id, catalog.selectOffice]);
  useEffect(() => {
    if (!handedOff || !accepted) return;
    if (catalog.office?.id === accepted.officeId) {
      prefillOfficeSeen.current = true;
    } else if (prefillOfficeSeen.current) {
      setAccepted(undefined);
    }
  }, [handedOff, accepted, catalog.office?.id]);

  const openProposal = useCallback(
    (proposal: BookingProposal): void => {
      const prefill = proposalToBookingPrefill(proposal);
      const target = catalog.accessibleOffices.find((item) => item.id === prefill.officeId);
      if (!target) throw new Error('Офис из предложения недоступен или больше не существует.');
      const next = validateBookingLink(prefill, target);
      catalog.selectOffice(next.officeId);
      prefillOfficeSeen.current = false;
      setAccepted(next);
    },
    [catalog.accessibleOffices, catalog.selectOffice],
  );

  return { user, office: catalog.office, linkError, handedOff, accepted, openProposal };
}
