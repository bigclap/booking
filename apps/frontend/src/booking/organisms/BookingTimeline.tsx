import type { ReactElement } from 'react';
import { Styles } from '../../shared/atoms';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Armchair, Building2, ChevronDown } from 'lucide-react';
import type { Floor, PlanElement } from '../../office';
import type { ClientBooking, TimeRange } from '../types';
import { CURRENT_USER_ID } from '../types';
import {
  getResources,
  getRoomOccupancy,
  getRoomOccupancyBands,
  isWorkplace,
  minutesToTime,
} from '../lib/bookingModel';

export interface BookingTimelineProps {
  currentUserId?: string;
  canManageAll?: boolean;
  initialHeight?: number;
  maxPanelHeight?: number;
  bookingEditMode?: (booking: ClientBooking) => 'none' | 'end' | 'all';
  focusBooking?: { id: string; token: number } | null;
  onFocusConsumed?: (token: number) => void;
  floor: Floor;
  bookings: ClientBooking[];
  date: string;
  range: TimeRange;
  showRange?: boolean;
  dateControl?: ReactNode;
  hours: { start: number; end: number; enabled: boolean };
  cursorMinute: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRoomSelect?: (id: string) => void;
  onRangeChange: (range: TimeRange) => void;
  onCursorChange: (minute: number) => void;
  onBookingClick: (booking: ClientBooking) => void;
  onBookingChange: (id: string, start: number, end: number, resourceId?: string) => void;
  onCreate: (resourceId: string, start: number) => void;
}

interface BookingDrag {
  booking: ClientBooking;
  mode: 'move' | 'start' | 'end';
  originX: number;
  originY: number;
  pointerX: number;
  pointerY: number;
  nextResourceId: string | null;
  trackWidth: number;
  pointerId: number;
  moved: boolean;
  next: TimeRange;
}

interface RulerDrag {
  left: number;
  width: number;
  pointerId: number;
}

export default function BookingTimeline({
  currentUserId = CURRENT_USER_ID,
  canManageAll = false,
  initialHeight = 205,
  maxPanelHeight,
  bookingEditMode,
  focusBooking = null,
  onFocusConsumed,
  floor,
  bookings,
  date,
  range,
  showRange = false,
  dateControl,
  hours,
  cursorMinute,
  selectedId,
  onSelect,
  onRoomSelect,
  onCursorChange,
  onBookingClick,
  onBookingChange,
  onCreate,
}: BookingTimelineProps): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pinnedBookingId, setPinnedBookingId] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [panelHeight, setPanelHeight] = useState(() =>
    Math.max(
      140,
      Math.min(initialHeight, maxPanelHeight ?? Math.max(140, window.innerHeight - 260)),
    ),
  );
  const [preview, setPreview] = useState<{
    id: string;
    resourceId: string | null;
    start: number;
    end: number;
  } | null>(null);
  const bookingDrag = useRef<BookingDrag | null>(null);
  const rulerDrag = useRef<RulerDrag | null>(null);
  const suppressClick = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrame = useRef<number | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const pinnedBookingRef = useRef<string | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const consumedFocus = useRef<string | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const hoverExpand = useRef<{ id: string; timer: number } | null>(null);
  const resizeDrag = useRef<{ pointerId: number; startY: number; height: number } | null>(null);
  const maxHeight = Math.max(140, maxPanelHeight ?? viewportHeight - 320);
  const clampHeight = (height: number) =>
    Math.round(
      Math.max(140, Math.min(Math.max(140, maxPanelHeight ?? window.innerHeight - 260), height)),
    );
  const start = hours.end > hours.start ? hours.start : 9 * 60;
  const end = hours.end > hours.start ? hours.end : 19 * 60;
  const span = end - start;
  const percent = (minute: number) => Math.max(0, Math.min(100, ((minute - start) / span) * 100));
  const snapMinute = (minute: number) => Math.max(start, Math.min(end, Math.round(minute / 5) * 5));
  const rooms = useMemo(
    () => floor.elements.filter((element) => element.kind === 'room'),
    [floor.elements],
  );
  const resources = useMemo(() => getResources(floor), [floor]);
  const desks = useMemo(() => resources.filter(isWorkplace), [resources]);
  const roomIds = new Set(rooms.map((room) => room.id));
  const outside = desks.filter((desk) => !desk.roomId || !roomIds.has(desk.roomId));
  const activeBookings = bookings.filter(
    (booking) =>
      booking.floorId === floor.id && booking.date === date && booking.status === 'active',
  );
  const ticks: number[] = [];
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) ticks.push(minute);

  // Layout changes can emit pointerenter without the user moving. A pinned
  // saved booking is released only by actual pointer motion over a real band.
  const observePointer = (event: PointerEvent, allowRelease: boolean) => {
    const point = { x: event.clientX, y: event.clientY };
    const previous = lastPointer.current;
    const moved = previous
      ? Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.5
      : Math.hypot(event.movementX || 0, event.movementY || 0) >= 0.5;
    lastPointer.current = point;
    if (!allowRelease || !moved || !pinnedBookingRef.current) return;
    const target = document
      .elementFromPoint(point.x, point.y)
      ?.closest('.bk-timeline-booking:not(.is-ghost)');
    if (target && sectionRef.current?.contains(target)) {
      pinnedBookingRef.current = null;
      setPinnedBookingId(null);
    }
  };
  const enterBooking = (event: ReactPointerEvent<HTMLElement>) =>
    observePointer(event.nativeEvent, true);

  useEffect(() => {
    const move = (event: PointerEvent) => observePointer(event, true);
    const down = (event: PointerEvent) => observePointer(event, false);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', down, true);
    };
  }, []);
  useEffect(() => {
    pinnedBookingRef.current = null;
    setPinnedBookingId(null);
  }, [floor.id, date]);

  useEffect(() => {
    setExpanded(new Set());
    setPreview(null);
    return () => {
      if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
      if (hoverExpand.current) window.clearTimeout(hoverExpand.current.timer);
      hoverExpand.current = null;
      autoScrollFrame.current = null;
      bookingDrag.current = null;
      resizeDrag.current = null;
    };
  }, [floor.id]);
  useEffect(() => {
    const selected = desks.find((desk) => desk.id === selectedId);
    if (!selected) return;
    const id =
      selected.roomId && rooms.some((room) => room.id === selected.roomId)
        ? selected.roomId
        : 'outside';
    setExpanded((previous) => (previous.size === 1 && previous.has(id) ? previous : new Set([id])));
  }, [selectedId, desks, rooms]);

  useEffect(() => {
    if (!focusBooking) return;
    const key = `${focusBooking.id}:${focusBooking.token}`;
    if (consumedFocus.current === key) return;
    const booking = bookings.find(
      (item) =>
        item.id === focusBooking.id &&
        item.status === 'active' &&
        item.floorId === floor.id &&
        item.date === date,
    );
    if (!booking) return;
    const resource = floor.elements.find((element) => element.id === booking.resourceId);
    if (!resource) return;
    const groupId =
      resource.kind === 'room'
        ? resource.id
        : resource.roomId && rooms.some((room) => room.id === resource.roomId)
          ? resource.roomId
          : 'outside';
    let stopped = false;
    let frame = 0;
    let missingFrames = 0;
    const reveal = () => {
      if (stopped || consumedFocus.current === key) return;
      // A server response must not interrupt an active drag or panel resize.
      if (bookingDrag.current || resizeDrag.current || rulerDrag.current) {
        frame = requestAnimationFrame(reveal);
        return;
      }
      if (expandedRef.current.size !== 1 || !expandedRef.current.has(groupId)) {
        setExpanded(new Set([groupId]));
        frame = requestAnimationFrame(reveal);
        return;
      }
      const body = bodyRef.current;
      const band =
        body &&
        Array.from(body.querySelectorAll<HTMLElement>('[data-booking-id]')).find(
          (element) => element.getAttribute('data-booking-id') === booking.id,
        );
      if (!body || !band) {
        // Wait for the accordion's DOM commit, but do not run an endless loop
        // when the resource is absent or the server window no longer shows it.
        if (++missingFrames < 12) frame = requestAnimationFrame(reveal);
        return;
      }
      const bodyRect = body.getBoundingClientRect(),
        bandRect = band.getBoundingClientRect();
      const centered =
        body.scrollTop + bandRect.top - bodyRect.top + bandRect.height / 2 - body.clientHeight / 2;
      body.scrollTop = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, centered));
      consumedFocus.current = key;
      pinnedBookingRef.current = booking.id;
      setPinnedBookingId(booking.id);
      onFocusConsumed?.(focusBooking.token);
    };
    frame = requestAnimationFrame(reveal);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [
    focusBooking?.id,
    focusBooking?.token,
    floor.id,
    date,
    bookings,
    floor.elements,
    rooms,
    expanded,
    onFocusConsumed,
  ]);

  const toggle = (id: string) =>
    setExpanded((previous) => (previous.has(id) ? new Set() : new Set([id])));

  useEffect(() => {
    const fitHeight = () => {
      setViewportHeight(window.innerHeight);
      setPanelHeight((previous) =>
        Math.round(
          Math.max(
            140,
            Math.min(Math.max(140, maxPanelHeight ?? window.innerHeight - 260), previous),
          ),
        ),
      );
    };
    window.addEventListener('resize', fitHeight);
    return () => window.removeEventListener('resize', fitHeight);
  }, [maxPanelHeight]);
  useEffect(() => {
    if (maxPanelHeight !== undefined)
      setPanelHeight((previous) => Math.max(140, Math.min(previous, Math.floor(maxPanelHeight))));
  }, [maxPanelHeight]);
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeDrag.current = { pointerId: event.pointerId, startY: event.clientY, height: panelHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    setPanelHeight(clampHeight(drag.height + drag.startY - event.clientY));
  };
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeDrag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    resizeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const rulerValue = (clientX: number, drag: RulerDrag) =>
    snapMinute(start + ((clientX - drag.left) / drag.width) * span);
  const startRuler = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !hours.enabled) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const drag: RulerDrag = { left: rect.left, width: rect.width, pointerId: event.pointerId };
    rulerDrag.current = drag;
    event.currentTarget.setPointerCapture(event.pointerId);
    onCursorChange(rulerValue(event.clientX, drag));
  };
  const moveRuler = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rulerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onCursorChange(rulerValue(event.clientX, drag));
  };
  const finishRuler = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (rulerDrag.current?.pointerId !== event.pointerId) return;
    rulerDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const dropResource = (clientX: number, clientY: number): string | null => {
    const hit = document.elementFromPoint(clientX, clientY);
    const row = hit?.closest<HTMLElement>('[data-timeline-resource], [data-timeline-row-resource]');
    const id =
      row?.getAttribute('data-timeline-resource') ??
      row?.getAttribute('data-timeline-row-resource');
    // Eligibility comes from the catalog; the booking owner validates conflicts
    // and adjusts participants when switching between a room and one place.
    return resources.find((resource) => resource.id === id)?.id ?? null;
  };

  const updateDragPreview = (drag: BookingDrag) =>
    setPreview((previous) => {
      if (
        previous?.id === drag.booking.id &&
        previous.resourceId === drag.nextResourceId &&
        previous.start === drag.next.start &&
        previous.end === drag.next.end
      )
        return previous;
      return { id: drag.booking.id, resourceId: drag.nextResourceId, ...drag.next };
    });
  const clearHoverExpand = () => {
    if (hoverExpand.current) window.clearTimeout(hoverExpand.current.timer);
    hoverExpand.current = null;
  };
  const queueHoverExpand = (clientX: number, clientY: number) => {
    const header = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-timeline-group-header]');
    const id = header?.getAttribute('data-timeline-group-header');
    const hasChildren =
      id === 'outside' ? outside.length > 0 : desks.some((desk) => desk.roomId === id);
    if (!id || !hasChildren || expandedRef.current.has(id)) {
      clearHoverExpand();
      return;
    }
    if (hoverExpand.current?.id === id) return;
    clearHoverExpand();
    hoverExpand.current = {
      id,
      timer: window.setTimeout(() => {
        const drag = bookingDrag.current;
        const hit =
          drag &&
          document
            .elementFromPoint(drag.pointerX, drag.pointerY)
            ?.closest<HTMLElement>('[data-timeline-group-header]');
        if (
          !drag ||
          !drag.moved ||
          drag.mode !== 'move' ||
          hit?.getAttribute('data-timeline-group-header') !== id
        ) {
          clearHoverExpand();
          return;
        }
        const oldTop = hit.getBoundingClientRect().top;
        hoverExpand.current = null;
        setExpanded(new Set([id]));
        requestAnimationFrame(() => {
          const current = bookingDrag.current;
          if (!current) return;
          const movedHeader = Array.from(
            sectionRef.current?.querySelectorAll<HTMLElement>('[data-timeline-group-header]') ?? [],
          ).find((element) => element.getAttribute('data-timeline-group-header') === id);
          if (movedHeader && bodyRef.current)
            bodyRef.current.scrollTop += movedHeader.getBoundingClientRect().top - oldTop;
          current.nextResourceId = dropResource(current.pointerX, current.pointerY);
          updateDragPreview(current);
          startAutoScroll();
        });
      }, 450),
    };
  };
  const stopAutoScroll = () => {
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = null;
  };
  const startAutoScroll = () => {
    if (autoScrollFrame.current !== null) return;
    let previousTime = performance.now();
    const frame = (now: number) => {
      autoScrollFrame.current = null;
      const drag = bookingDrag.current,
        body = bodyRef.current;
      if (!drag || !drag.moved || drag.mode !== 'move' || !body) return;
      const rect = body.getBoundingClientRect();
      const edge = 24;
      if (
        drag.pointerX < rect.left ||
        drag.pointerX > rect.right ||
        drag.pointerY < rect.top - edge ||
        drag.pointerY > rect.bottom + edge
      )
        return;
      let speed = 0;
      if (drag.pointerY < rect.top + edge)
        speed = -Math.min(600, Math.max(90, ((rect.top + edge - drag.pointerY) / edge) * 420));
      else if (drag.pointerY > rect.bottom - edge)
        speed = Math.min(600, Math.max(90, ((drag.pointerY - rect.bottom + edge) / edge) * 420));
      if (!speed) return;
      const elapsed = Math.min(40, Math.max(1, now - previousTime));
      previousTime = now;
      const before = body.scrollTop;
      body.scrollTop += (speed * elapsed) / 1000;
      if (body.scrollTop !== before) {
        drag.nextResourceId = dropResource(drag.pointerX, drag.pointerY);
        updateDragPreview(drag);
        queueHoverExpand(drag.pointerX, drag.pointerY);
      } else if (
        (speed < 0 && body.scrollTop <= 0) ||
        (speed > 0 && body.scrollTop >= body.scrollHeight - body.clientHeight)
      )
        return;
      autoScrollFrame.current = requestAnimationFrame(frame);
    };
    autoScrollFrame.current = requestAnimationFrame(frame);
  };

  const startBookingDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    booking: ClientBooking,
    mode: BookingDrag['mode'],
  ) => {
    event.stopPropagation();
    if (
      event.button !== 0 ||
      (!canManageAll && booking.ownerId !== currentUserId) ||
      !hours.enabled
    )
      return;
    const allowed = bookingEditMode?.(booking) ?? 'all';
    if (allowed === 'none' || (allowed === 'end' && mode !== 'end')) return;
    event.preventDefault();
    const track = event.currentTarget.closest('.bk-timeline-track')!;
    bookingDrag.current = {
      booking,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      nextResourceId: booking.resourceId,
      trackWidth: track.getBoundingClientRect().width,
      pointerId: event.pointerId,
      moved: false,
      next: { start: booking.start, end: booking.end },
    };
    sectionRef.current?.setPointerCapture(event.pointerId);
  };
  const moveBooking = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = bookingDrag.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    if (Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) > 3)
      drag.moved = true;
    if (!drag.moved) return;
    const delta = Math.round((((event.clientX - drag.originX) / drag.trackWidth) * span) / 5) * 5;
    const original = drag.booking;
    if (drag.mode === 'move') {
      drag.nextResourceId = dropResource(event.clientX, event.clientY);
      const duration = original.end - original.start;
      const nextStart = Math.max(start, Math.min(end - duration, original.start + delta));
      drag.next = { start: nextStart, end: nextStart + duration };
    } else if (drag.mode === 'start')
      drag.next = {
        start: Math.max(start, Math.min(original.end - 5, original.start + delta)),
        end: original.end,
      };
    else
      drag.next = {
        start: original.start,
        end: Math.min(end, Math.max(original.start + 5, original.end + delta)),
      };
    updateDragPreview(drag);
    if (drag.mode === 'move') queueHoverExpand(event.clientX, event.clientY);
    startAutoScroll();
  };
  const finishBooking = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const drag = bookingDrag.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    stopAutoScroll();
    clearHoverExpand();
    bookingDrag.current = null;
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled) {
      suppressClick.current = drag.booking.id;
      window.setTimeout(() => {
        if (suppressClick.current === drag.booking.id) suppressClick.current = null;
      }, 0);
      if (!drag.moved) {
        onBookingClick(drag.booking);
        return;
      }
      const resourceId =
        drag.mode === 'move' ? dropResource(event.clientX, event.clientY) : drag.booking.resourceId;
      if (
        resourceId &&
        (resourceId !== drag.booking.resourceId ||
          drag.next.start !== drag.booking.start ||
          drag.next.end !== drag.booking.end)
      )
        onBookingChange(drag.booking.id, drag.next.start, drag.next.end, resourceId);
    }
  };

  const markers = () => (
    <>
      {ticks.map((minute) => (
        <i className="bk-timeline-grid-line" key={minute} style={{ left: percent(minute) + '%' }} />
      ))}
      {showRange && (
        <span
          className="bk-timeline-range"
          style={{
            left: percent(range.start) + '%',
            width: Math.max(0, percent(range.end) - percent(range.start)) + '%',
          }}
        />
      )}
      <span className="bk-timeline-cursor-line" style={{ left: percent(cursorMinute) + '%' }} />
    </>
  );

  const track = (resource: PlanElement, canCreate: boolean) => (
    <div
      className="bk-timeline-track"
      data-timeline-resource={resource.id}
      onClick={(event) => {
        if (
          !canCreate ||
          !hours.enabled ||
          (event.target as HTMLElement).closest('.bk-timeline-booking')
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        const minute = Math.min(
          end - 5,
          snapMinute(start + ((event.clientX - rect.left) / rect.width) * span),
        );
        onSelect(resource.id);
        onCreate(resource.id, minute);
      }}
    >
      {markers()}
      {resource.kind === 'room' &&
        getRoomOccupancyBands(floor, resource.id, date, bookings, start, end).map((band) => {
          const full = band.occupied >= band.total;
          return (
            <button
              key={`${band.start}-${band.end}-${band.occupied}`}
              type="button"
              className={
                'bk-timeline-booking bk-timeline-summary-band' + (full ? ' is-full' : ' is-partial')
              }
              data-room-occupancy-band
              data-occupied={band.occupied}
              data-total={band.total}
              style={{
                left: `calc(${percent(band.start)}% + 1px)`,
                width: `max(2px, calc(${Math.max(0, percent(band.end) - percent(band.start))}% - 2px))`,
              }}
              aria-label={`${resource.name}: занято ${band.occupied} из ${band.total} мест, ${minutesToTime(band.start)}–${minutesToTime(band.end)}`}
              title={`${full ? 'Все места заняты' : 'Частичная занятость'}: ${band.occupied}/${band.total} · ${minutesToTime(band.start)}–${minutesToTime(band.end)}`}
              onPointerEnter={enterBooking}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget
                  .closest('.bk-timeline-track')!
                  .getBoundingClientRect();
                const minute =
                  event.detail === 0
                    ? band.start
                    : start + ((event.clientX - rect.left) / rect.width) * span;
                onCursorChange(snapMinute(minute));
                onSelect(resource.id);
              }}
            >
              <span className="bk-timeline-booking-label">
                {band.occupied}/{band.total}
              </span>
            </button>
          );
        })}
      {activeBookings
        .filter(
          (booking) =>
            (booking.resourceId === resource.id ||
              (isWorkplace(resource) &&
                booking.resourceId === resource.roomId &&
                floor.elements.some(
                  (parent) =>
                    parent.id === resource.roomId &&
                    parent.kind === 'room' &&
                    parent.bookable === true,
                ))) &&
            booking.end > start &&
            booking.start < end,
        )
        .map((booking) => {
          const shown = booking;
          const own = booking.ownerId === currentUserId;
          const inherited = booking.resourceId !== resource.id;
          const editMode = bookingEditMode?.(booking) ?? 'all';
          const editable =
            (own || canManageAll) && !inherited && hours.enabled && editMode !== 'none';
          return (
            <button
              key={booking.id}
              type="button"
              data-booking-id={inherited ? undefined : booking.id}
              onPointerEnter={enterBooking}
              className={
                'bk-timeline-booking' +
                (own ? ' is-own' : '') +
                (editable ? ' is-editable' : ' is-readonly') +
                (editable && editMode === 'all' ? ' is-movable' : '') +
                (editable && !own ? ' is-manageable' : '') +
                (inherited ? ' is-inherited' : '') +
                (editable && pinnedBookingId === booking.id ? ' is-focused' : '') +
                (preview?.id === booking.id ? ' is-source-dragging' : '')
              }
              style={{
                left: percent(shown.start) + '%',
                width: Math.max(0.5, percent(shown.end) - percent(shown.start)) + '%',
              }}
              aria-label={`${inherited ? 'Бронь помещения, ' : ''}${own ? 'Ваша бронь' : booking.ownerName}: ${minutesToTime(shown.start)}–${minutesToTime(shown.end)}${booking.needsReview ? ', требует проверки' : ''}`}
              title={`${own ? 'Ваша бронь' : booking.ownerName} · ${minutesToTime(shown.start)}–${minutesToTime(shown.end)}${booking.participants ? ` · ${booking.participants} чел.` : ''}${booking.needsReview ? ' · Условия брони изменились' : ''}`}
              onPointerDown={(event) => {
                if (inherited) {
                  event.stopPropagation();
                  return;
                }
                const handle = (event.target as HTMLElement)
                  .closest('[data-booking-handle]')
                  ?.getAttribute('data-booking-handle');
                startBookingDrag(
                  event,
                  booking,
                  handle === 'start' || handle === 'end' ? handle : 'move',
                );
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (suppressClick.current === booking.id) {
                  suppressClick.current = null;
                  return;
                }
                onBookingClick(booking);
              }}
            >
              {editable && editMode === 'all' && (
                <span data-booking-handle="start" className="bk-timeline-booking-edge edge-start" />
              )}
              <span className="bk-timeline-booking-label">
                {booking.needsReview ? '⚠ ' : ''}
                {inherited ? 'Комната занята' : own ? 'Вы' : booking.ownerName.split(' ')[0]}
              </span>
              {editable && (
                <span data-booking-handle="end" className="bk-timeline-booking-edge edge-end" />
              )}
            </button>
          );
        })}
      {preview?.resourceId === resource.id && (
        <div
          className={
            'bk-timeline-booking is-ghost' +
            (bookings.find((booking) => booking.id === preview.id)?.ownerId === currentUserId
              ? ' is-own'
              : '')
          }
          aria-hidden="true"
          style={{
            left: percent(preview.start) + '%',
            width: Math.max(0.5, percent(preview.end) - percent(preview.start)) + '%',
          }}
        >
          <span className="bk-timeline-booking-label">
            {bookings.find((booking) => booking.id === preview.id)?.ownerId === currentUserId
              ? 'Вы'
              : bookings.find((booking) => booking.id === preview.id)?.ownerName.split(' ')[0]}{' '}
            · {minutesToTime(preview.start)}–{minutesToTime(preview.end)}
          </span>
        </div>
      )}
    </div>
  );

  const deskRow = (desk: PlanElement) => (
    <div
      key={desk.id}
      data-timeline-row-resource={desk.id}
      className={
        'bk-timeline-row is-desk' +
        (selectedId === desk.id ? ' is-selected' : '') +
        (preview?.resourceId === desk.id ? ' is-drop-target' : '')
      }
    >
      <div className="bk-timeline-label">
        <button
          type="button"
          className="bk-timeline-resource-name"
          onClick={() => onSelect(desk.id)}
        >
          <Armchair size={13} />
          <span>{desk.name}</span>
        </button>
      </div>
      {track(desk, true)}
    </div>
  );

  const groupHeader = (id: string, name: string, children: PlanElement[], room?: PlanElement) => {
    const occupancy = room
      ? getRoomOccupancy(floor, room.id, date, cursorMinute, bookings)
      : {
          total: outside.length,
          occupied: outside.filter((desk) =>
            activeBookings.some(
              (booking) =>
                booking.resourceId === desk.id &&
                booking.start <= cursorMinute &&
                booking.end > cursorMinute,
            ),
          ).length,
          exclusive: false,
        };
    const partial =
      occupancy.occupied > 0 && occupancy.occupied < occupancy.total && !occupancy.exclusive;
    const isOpen = expanded.has(id);
    return (
      <div key={id} className="bk-timeline-group">
        <div
          data-timeline-row-resource={room?.id}
          data-timeline-group-header={id}
          className={
            'bk-timeline-row is-room' +
            (selectedId === id ? ' is-selected' : '') +
            (preview?.resourceId === id ? ' is-drop-target' : '')
          }
        >
          <div className="bk-timeline-label bk-timeline-group-heading" onClick={() => toggle(id)}>
            <button
              type="button"
              className={'bk-timeline-disclosure' + (isOpen ? ' is-open' : '')}
              aria-label={`${isOpen ? 'Свернуть' : 'Раскрыть'} ${name}`}
              aria-expanded={isOpen}
              onClick={(event) => {
                event.stopPropagation();
                toggle(id);
              }}
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              className="bk-timeline-resource-name"
              aria-expanded={isOpen}
              onClick={(event) => {
                event.stopPropagation();
                if (room) onRoomSelect?.(room.id);
                toggle(id);
              }}
            >
              <Building2 size={13} />
              <span>{name}</span>
            </button>
            {occupancy.total > 0 && (
              <span
                className={
                  'bk-timeline-occupancy' +
                  (partial ? ' is-partial' : occupancy.occupied ? ' is-full' : '')
                }
                title={`Занято ${occupancy.occupied} из ${occupancy.total} мест в ${minutesToTime(cursorMinute)}`}
              >
                {occupancy.occupied}/{occupancy.total}
              </span>
            )}
          </div>
          {room ? (
            track(room, room.bookable === true)
          ) : (
            <div className="bk-timeline-track is-group-track">
              {markers()}
              <span className="bk-timeline-group-hint">{children.length} рабочих мест</span>
            </div>
          )}
        </div>
        {isOpen &&
          (children.length ? (
            children.map(deskRow)
          ) : (
            <div className="bk-timeline-no-desks">
              {room?.bookable && !room.shared
                ? 'Помещение бронируется целиком'
                : 'Отдельные рабочие места не добавлены'}
            </div>
          ))}
      </div>
    );
  };

  return (
    <>
      <Styles id="bookingtimeline">{styles}</Styles>
      <section
        className="bk-timeline"
        aria-label="Расписание этажа"
        ref={sectionRef}
        style={{ height: panelHeight }}
        onPointerMove={moveBooking}
        onPointerUp={(event) => finishBooking(event)}
        onPointerCancel={(event) => finishBooking(event, true)}
        onLostPointerCapture={(event) => finishBooking(event, true)}
      >
        <div
          className="bk-timeline-resizer"
          role="separator"
          aria-label="Высота расписания"
          aria-orientation="horizontal"
          aria-valuemin={140}
          aria-valuemax={maxHeight}
          aria-valuenow={panelHeight}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          onDoubleClick={() => setPanelHeight(clampHeight(initialHeight))}
          onKeyDown={(event) => {
            if (
              event.key === 'ArrowUp' ||
              event.key === 'ArrowDown' ||
              event.key === 'Home' ||
              event.key === 'End'
            ) {
              event.preventDefault();
              setPanelHeight((previous) =>
                clampHeight(
                  event.key === 'Home'
                    ? 140
                    : event.key === 'End'
                      ? maxHeight
                      : previous + (event.key === 'ArrowUp' ? 20 : -20),
                ),
              );
            }
          }}
        >
          <span />
        </div>
        <div className="bk-timeline-body" ref={bodyRef}>
          {!hours.enabled && <div className="bk-timeline-closed">В этот день офис закрыт</div>}
          {rooms.map((room) =>
            groupHeader(
              room.id,
              room.name,
              desks.filter((desk) => desk.roomId === room.id),
              room,
            ),
          )}
          {outside.length > 0 && groupHeader('outside', 'Рабочие места', outside)}
          {!rooms.length && !outside.length && (
            <div className="bk-timeline-empty">На этом этаже пока нет помещений и рабочих мест</div>
          )}
        </div>
        <div className="bk-timeline-ruler-row">
          <div className="bk-timeline-label bk-timeline-date-control">{dateControl}</div>
          <div
            className="bk-timeline-ruler"
            role="slider"
            tabIndex={0}
            aria-label="Курсор времени"
            aria-valuemin={start}
            aria-valuemax={end}
            aria-valuenow={cursorMinute}
            aria-valuetext={minutesToTime(cursorMinute)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                onCursorChange(snapMinute(cursorMinute + (event.key === 'ArrowLeft' ? -5 : 5)));
              }
            }}
            onPointerDown={startRuler}
            onPointerMove={moveRuler}
            onPointerUp={finishRuler}
            onPointerCancel={finishRuler}
          >
            {showRange && (
              <span
                className="bk-timeline-ruler-range"
                style={{
                  left: percent(range.start) + '%',
                  width: Math.max(0, percent(range.end) - percent(range.start)) + '%',
                }}
              />
            )}
            {ticks.map((minute) => (
              <span
                key={minute}
                className={
                  'bk-timeline-tick' +
                  (minute === end ? ' is-last' : minute === start ? ' is-first' : '')
                }
                style={{ left: percent(minute) + '%' }}
              >
                {minutesToTime(minute)}
              </span>
            ))}
            <span
              className="bk-timeline-cursor-label"
              style={{ left: percent(cursorMinute) + '%' }}
            >
              {minutesToTime(cursorMinute)}
            </span>
            <span
              className="bk-timeline-cursor-head"
              style={{ left: percent(cursorMinute) + '%' }}
              title={minutesToTime(cursorMinute)}
            />
          </div>
        </div>
      </section>
    </>
  );
}

const styles = String.raw`
.bk-timeline {
  --bk-timeline-label: 218px;
  display: flex;
  flex-direction: column;
  min-height: 150px;
  height: 205px;
  flex-shrink: 0;
  border-top: 1px solid #e3e8f0;
  background: #fff;
  color: #53677e;
  overflow: hidden;
}
.bk-timeline button {
  font-family: inherit;
}
.bk-timeline-body {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  padding-right: 25px;
  scrollbar-width: none;
}
.bk-timeline-body::-webkit-scrollbar {
  display: none;
}
.bk-timeline-row,
.bk-timeline-ruler-row {
  display: grid;
  grid-template-columns: var(--bk-timeline-label) minmax(0, 1fr);
}
.bk-timeline-row {
  height: 35px;
  min-height: 35px;
  border-bottom: 1px solid #f0f2f7;
}
.bk-timeline-row.is-room {
  background: #fff;
}
.bk-timeline-row.is-desk {
  background: #fcfdff;
}
.bk-timeline-row.is-selected {
  background: #f0f3fd;
}
.bk-timeline-row.is-drop-target {
  background: #edf2ff;
  box-shadow: inset 3px 0 #8a9bdf;
}
.bk-timeline-row.is-drop-target .bk-timeline-track {
  box-shadow: inset 0 0 0 1px #acb9e8;
}
.bk-timeline-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-left: 20px;
  padding-right: 9px;
  min-width: 0;
  border-right: 1px solid #edf0f5;
}
.bk-timeline-row.is-desk .bk-timeline-label {
  padding-left: 44px;
}
.bk-timeline-resource-name {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  min-width: 0;
  flex: 1;
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  color: #63748c;
  background: transparent;
  border: 0;
}
.bk-timeline-resource-name > span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.bk-timeline-resource-name > svg {
  flex-shrink: 0;
  color: #a3b0c2;
}
.bk-timeline-row.is-selected .bk-timeline-resource-name,
.bk-timeline-row.is-drop-target .bk-timeline-resource-name {
  color: #6b7fc1;
}
.bk-timeline-row.is-desk .bk-timeline-resource-name {
  font-size: 9px;
  font-weight: 500;
}
.bk-timeline-disclosure {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  padding: 0;
  width: 18px;
  height: 24px;
  border: 0;
  background: transparent;
  color: #a0aec0;
  transform: rotate(-90deg);
}
.bk-timeline-disclosure.is-open {
  transform: rotate(0);
}
.bk-timeline-disclosure:disabled {
  opacity: 0.2;
  cursor: default;
}
.bk-timeline-occupancy {
  font-size: 8px;
  font-weight: 650;
  border-radius: 4px;
  color: #7c9a88;
  background: #f0f7f3;
  padding: 3px 5px;
  white-space: nowrap;
}
.bk-timeline-occupancy.is-partial {
  background: #fff2da;
  color: #b28a47;
}
.bk-timeline-occupancy.is-full {
  background: #f9e9e9;
  color: #bc8585;
}
.bk-timeline-track {
  position: relative;
  min-width: 0;
  height: 34px;
  cursor: pointer;
}
.bk-timeline-range {
  position: absolute;
  top: 0;
  bottom: 0;
  background: #7c91e211;
  border-left: 1px solid #b2bee15c;
  border-right: 1px solid #b2bee15c;
  pointer-events: none;
}
.bk-timeline-grid-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #edf0f6;
  pointer-events: none;
}
.bk-timeline-cursor-line {
  position: absolute;
  top: 0;
  bottom: -1px;
  width: 1px;
  background: #8b9fd28c;
  z-index: 3;
  pointer-events: none;
}
.bk-timeline-booking {
  position: absolute;
  top: 7px;
  height: 20px;
  min-width: 3px;
  padding: 0 5px;
  background: #f3cdcd;
  border: 1px solid #e9b9b9;
  border-radius: 5px;
  color: #b07d7d;
  z-index: 2;
  overflow: hidden;
  white-space: nowrap;
  touch-action: pan-y;
  cursor: pointer;
  box-sizing: border-box;
}
.bk-timeline-booking.is-own {
  background: #f3d7db;
  color: #8b77ac;
}
.bk-timeline-booking.is-editable {
  touch-action: none;
}
.bk-timeline-booking.is-movable {
  cursor: grab;
}
.bk-timeline-booking.is-movable:active {
  cursor: grabbing;
}
.bk-timeline-booking.is-own.is-editable {
  box-shadow: 0 3px 12px #5971ac38;
}
.bk-timeline-booking.is-inherited {
  cursor: pointer;
  touch-action: pan-y;
  background: #f0d8d8;
  color: #b29494;
}
.bk-timeline-booking.is-editable.is-source-dragging {
  opacity: 0.22;
}
.bk-timeline-booking.is-movable.is-source-dragging {
  cursor: grabbing;
}
.bk-timeline-booking.is-ghost {
  z-index: 5;
  pointer-events: none;
  box-shadow: 0 2px 7px #6377b634;
  background: #e8d7f0;
  opacity: 0.96;
}
.bk-timeline-booking.is-editable:hover,
.bk-timeline-booking.is-editable.is-focused {
  box-shadow: 0 4px 18px #52679e50;
  z-index: 4;
}
.bk-timeline-booking-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  font-size: 8px;
  line-height: 16px;
  font-weight: 650;
}
.bk-timeline-booking-edge {
  display: none;
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  z-index: 2;
  cursor: ew-resize;
}
.bk-timeline-booking.is-editable .bk-timeline-booking-edge {
  display: block;
}
.bk-timeline-booking-edge:after {
  content: '';
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 1px;
  background: #a492c5;
  border-radius: 1px;
  opacity: 0;
}
.bk-timeline-booking.is-own.is-editable .bk-timeline-booking-edge:after {
  opacity: 0.95;
  background: #6b7dc0;
}
.bk-timeline-booking.is-editable:hover .bk-timeline-booking-edge:after,
.bk-timeline-booking.is-editable.is-focused .bk-timeline-booking-edge:after {
  opacity: 1;
}
.bk-timeline-booking-edge.edge-start {
  left: 0;
}
.bk-timeline-booking-edge.edge-start:after {
  left: 3px;
}
.bk-timeline-booking-edge.edge-end {
  right: 0;
}
.bk-timeline-booking-edge.edge-end:after {
  right: 3px;
}
.bk-timeline-group-hint {
  position: absolute;
  top: 11px;
  left: 12px;
  font-size: 8px;
  color: #b7c0cf;
  pointer-events: none;
}
.bk-timeline-ruler-row {
  flex-shrink: 0;
  min-height: 31px;
  height: 31px;
  background: #fafbfd;
  border-top: 1px solid #e6ebf3;
  padding-right: 25px;
}
.bk-timeline-ruler-row > .bk-timeline-label {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: #a1adbf;
  padding-left: 26px;
}
.bk-timeline-ruler {
  height: 30px;
  position: relative;
  cursor: crosshair;
  touch-action: none;
}
.bk-timeline-tick {
  position: absolute;
  top: 9px;
  transform: translateX(-50%);
  font-size: 9px;
  font-weight: 500;
  color: #94a2b6;
  pointer-events: none;
  white-space: nowrap;
}
.bk-timeline-tick.is-first {
  transform: none;
  margin-left: 6px;
}
.bk-timeline-tick.is-last {
  transform: translateX(-100%);
}
.bk-timeline-ruler-range {
  position: absolute;
  top: 0;
  bottom: 0;
  background: #e9edfc;
  pointer-events: none;
}
.bk-timeline-cursor-head {
  position: absolute;
  top: -4px;
  width: 7px;
  height: 7px;
  background: #667fce;
  transform: translateX(-50%) rotate(45deg);
  z-index: 4;
  pointer-events: none;
}
.bk-timeline-empty,
.bk-timeline-closed {
  padding: 13px 25px;
  font-size: 10px;
  color: #a2adbd;
}
.bk-timeline-closed {
  padding: 7px 25px;
  background: #faf7f1;
  color: #ad9978;
  border-bottom: 1px solid #f1e9dc;
}
.bk-timeline-disclosure:focus-visible,
.bk-timeline-resource-name:focus-visible,
.bk-timeline-booking:focus-visible,
.bk-timeline-ruler:focus-visible {
  outline: 2px solid #a6b3eb;
  outline-offset: -2px;
}
@media (max-width: 800px) {
  .bk-timeline {
    --bk-timeline-label: 176px;
    height: 205px;
  }
  .bk-timeline-label {
    padding-left: 11px;
  }
  .bk-timeline-row.is-desk .bk-timeline-label {
    padding-left: 30px;
  }
  .bk-timeline-ruler-row,
  .bk-timeline-body {
    padding-right: 14px;
  }
  .bk-timeline-ruler-row > .bk-timeline-label {
    padding-left: 16px;
    font-size: 7px;
  }
  .bk-timeline-tick {
    font-size: 8px;
  }
}
@media (max-width: 520px) {
  .bk-timeline {
    --bk-timeline-label: 128px;
    height: 205px;
    min-height: 150px;
  }
  .bk-timeline-label {
    padding-left: 4px;
    padding-right: 5px;
    gap: 3px;
  }
  .bk-timeline-resource-name {
    font-size: 9px;
    gap: 4px;
  }
  .bk-timeline-resource-name > svg {
    display: none;
  }
  .bk-timeline-disclosure {
    width: 16px;
  }
  .bk-timeline-occupancy {
    font-size: 7px;
    padding: 2px 3px;
  }
  .bk-timeline-row.is-desk .bk-timeline-label {
    padding-left: 24px;
  }
  .bk-timeline-row.is-desk .bk-timeline-resource-name {
    font-size: 8px;
  }
  .bk-timeline-ruler-row > .bk-timeline-label {
    padding-left: 10px;
    font-size: 7px;
    letter-spacing: 0.3px;
  }
  .bk-timeline-ruler-row,
  .bk-timeline-body {
    padding-right: 10px;
  }
  .bk-timeline-tick {
    font-size: 7px;
  }
  .bk-timeline-tick:nth-of-type(2n) {
    opacity: 0.35;
  }
  .bk-timeline-booking-label {
    font-size: 7px;
  }
  .bk-timeline-booking {
    padding: 0 2px;
    border-radius: 4px;
  }
  .bk-timeline-group-hint {
    font-size: 7px;
    left: 6px;
  }
}

.bk-timeline-ruler-row {
  position: relative;
  z-index: 8;
}
.bk-timeline-ruler-row > .bk-timeline-date-control {
  padding: 0 10px;
  justify-content: center;
}
.bk-timeline-cursor-label {
  position: absolute;
  bottom: 35px;
  transform: translateX(-50%);
  padding: 3px 5px;
  border-radius: 4px;
  background: #7f91d3;
  color: white;
  font-size: 8px;
  font-weight: 650;
  line-height: 12px;
  pointer-events: none;
  box-shadow: 0 1px 4px #536da522;
  z-index: 5;
}
.bk-timeline-cursor-label:after {
  content: '';
  position: absolute;
  bottom: -3px;
  left: calc(50% - 3px);
  width: 6px;
  height: 6px;
  background: #7f91d3;
  transform: rotate(45deg);
}
@media (max-width: 520px) {
  .bk-timeline-ruler-row > .bk-timeline-date-control {
    padding: 0 3px;
  }
  .bk-timeline-cursor-label {
    font-size: 7px;
    padding: 2px 4px;
  }
}

.bk-timeline-group-heading {
  cursor: pointer;
}
.bk-timeline-no-desks {
  min-height: 30px;
  display: flex;
  align-items: center;
  padding: 7px 26px 7px 45px;
  border-bottom: 1px solid #edf0f6;
  background: #fafbfe;
  color: #9ca9bb;
  font-size: 9px;
  line-height: 1.5;
}
@media (max-width: 520px) {
  .bk-timeline-no-desks {
    padding-left: 24px;
    font-size: 8px;
  }
}

.bk-timeline {
  min-height: 140px;
}
.bk-timeline-resizer {
  height: 8px;
  min-height: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: ns-resize;
  touch-action: none;
  user-select: none;
  background: #fff;
}
.bk-timeline-resizer > span {
  height: 3px;
  width: 32px;
  border-radius: 3px;
  background: #d5dce9;
  pointer-events: none;
}
.bk-timeline-resizer:hover > span,
.bk-timeline-resizer:focus-visible > span {
  background: #92a4d8;
}
.bk-timeline-resizer:focus-visible {
  outline: 2px solid #b6c3e8;
  outline-offset: -2px;
}
@media (max-width: 520px) {
  .bk-timeline {
    min-height: 140px;
  }
}

.bk-timeline-summary-band {
  z-index: 1;
  background: #ffe8c2;
  border-color: #df9b3e;
  color: #b27e32;
  cursor: pointer;
  touch-action: pan-y;
}
.bk-timeline-summary-band.is-full {
  background: #f3cdcd;
  border-color: #e9b9b9;
  color: #b07d7d;
}
.bk-timeline-summary-band .bk-timeline-booking-label {
  font-weight: 650;
}
`;
