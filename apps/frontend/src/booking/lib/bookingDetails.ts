import type { OfficeConfig } from '../../office';
import type { ClientBooking } from '../types';

export function isBookingHistorical(booking: ClientBooking, now: number): boolean {
  const end = booking.endsAt
    ? Date.parse(booking.endsAt)
    : Date.parse(booking.date + 'T00:00:00+03:00') + booking.end * 60_000;
  return booking.status === 'cancelled' || end <= now;
}

/** Historical labels come from the booking, never from another floor with the same resource ID. */
export function getBookingResourceDetails(
  booking: ClientBooking,
  office: OfficeConfig,
  options: { preferSnapshot?: boolean } = {},
) {
  const floor =
    !booking.buildingId || booking.buildingId === office.id
      ? office.floors.find((item) => item.id === booking.floorId)
      : undefined;
  const resource = floor?.elements.find((item) => item.id === booking.resourceId);
  const snapshot = booking.resourceSnapshot;
  const useSnapshot = options.preferSnapshot || !resource;
  const name =
    useSnapshot && snapshot?.name?.trim()
      ? snapshot.name
      : resource?.name || snapshot?.name || 'Пространство';
  const floorName =
    useSnapshot && snapshot?.floor_name?.trim()
      ? snapshot.floor_name
      : floor?.name || snapshot?.floor_name || 'Прежний этаж';
  return {
    name,
    floorName,
    removed: !resource,
    snapshot: !!(useSnapshot && (snapshot?.name || snapshot?.floor_name)),
    kind: useSnapshot ? snapshot?.kind || resource?.kind : resource?.kind || snapshot?.kind,
  };
}

const reviewMessages: Record<string, string> = {
  working_hours_changed: 'Изменились рабочие часы офиса. Проверьте дату и время брони.',
  resource_hierarchy_changed:
    'Изменился состав помещения или расположение места. Проверьте выбранное пространство.',
  resource_type_changed:
    'Изменился тип пространства. Проверьте, подходит ли оно для вашей встречи или работы.',
  resource_unavailable:
    'Пространство больше недоступно для бронирования. Выберите другое или отмените бронь.',
};
const genericReview = 'Условия брони изменились. Проверьте пространство, дату и время.';

export function getBookingReviewMessages(booking: ClientBooking): string[] {
  if (!booking.needsReview) return [];
  return [
    ...new Set(
      booking.reviewReasons?.length
        ? booking.reviewReasons.map((reason) => reviewMessages[reason] || genericReview)
        : [genericReview],
    ),
  ];
}

export function getBookingCancellationMessage(booking: ClientBooking): string | null {
  if (booking.status !== 'cancelled' && !booking.cancellationReason) return null;
  const start = Date.parse(booking.startsAt || '');
  const end = Date.parse(booking.endsAt || '');
  const scheduledEnd = Date.parse(booking.scheduledEndsAt || '');
  const action =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(scheduledEnd) &&
    end > start &&
    end < scheduledEnd
      ? 'Бронь досрочно завершена'
      : 'Бронь отменена';
  const messages: Record<string, string> = {
    user_cancelled: `${action} владельцем.`,
    admin_cancelled: `${action} администратором.`,
    access_revoked: `${action}, поскольку доступ к офису отозван.`,
    building_access_revoked: `${action}, поскольку доступ к офису отозван.`,
    building_access_removed: `${action}, поскольку доступ к офису отозван.`,
    user_disabled: `${action}, поскольку учётная запись сотрудника отключена.`,
  };
  return messages[booking.cancellationReason || ''] || `${action}. Запись сохранена в истории.`;
}

export function getBookingWarningMessages(booking: ClientBooking): string[] {
  return [
    ...new Set(
      (booking.warnings || []).map((warning) => {
        if (warning.code !== 'capacity_exceeded')
          return 'Для этой брони есть дополнительное предупреждение. Уточните условия у администратора.';
        const capacity =
          Number.isInteger(warning.capacity) && warning.capacity! >= 0
            ? warning.capacity
            : undefined;
        const rawParticipants = warning.participants ?? booking.participants;
        const participants =
          Number.isInteger(rawParticipants) && rawParticipants! > 0 ? rawParticipants : undefined;
        if (capacity !== undefined && participants !== undefined)
          return `Участников: ${participants}. Сидячих мест: ${capacity}. Бронь сохранена; участников больше, чем мест.`;
        return 'Участников больше, чем сидячих мест. Бронь сохранена.';
      }),
    ),
  ];
}
