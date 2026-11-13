import type { ReactElement } from 'react';
import { Spinner } from '../../shared/atoms';
import { Badge } from '../../shared/atoms';
import { Button, CloseButton, Styles } from '../../shared/atoms';

import BookingDateControls from '../molecules/BookingDateControls';
import BookingFloorControls from '../molecules/BookingFloorControls';
import BookingWorkspace from './BookingWorkspace';
import { AlertCircle, CheckCircle2, Clock3, History, Plus, RefreshCw, X } from 'lucide-react';

import BookingTimeline from '../organisms/BookingTimeline';
import BookingPlan from '../organisms/BookingPlan';

import { AdminShell } from '../../office/organisms';

import type { AdminBookingController } from '../hooks/useAdminBookingsPage';
import AdminBookingForm from './AdminBookingForm';
import AdminBookingHistory from './AdminBookingHistory';

export default function AdminBookingWorkspace({
  controller,
}: {
  controller: AdminBookingController;
}): ReactElement {
  const {
    office,
    user,
    data,
    bookings,
    date,
    floor,
    selectedId,
    timelineFocus,
    consumeTimelineFocus,
    cursorMinute,
    setCursorMinute,
    pageError,
    setPageError,
    notice,
    setNotice,
    historyOpen,
    setHistoryOpen,
    busy,
    workAreaRef,
    maxTimelineHeight,
    hours,
    resources,
    mapAvailable,
    cancelled,
    retainedBookings,
    chooseDate,
    chooseFloor,
    selectResource,
    openCreate,
    openBooking,
    changeBooking,
  } = controller;
  const dateControl = (
    <BookingDateControls date={date} onChange={chooseDate} disabled={busy} admin />
  );

  return (
    <>
      <Styles id="adminbookingworkspace">{styles}</Styles>
      <AdminShell
        section="offices"
        office={office}
        view="bookings"
        actions={
          <>
            <Button
              variant="secondary"
              className="bk-my-button ab-records-button"
              type="button"
              aria-label="История броней"
              aria-expanded={historyOpen}
              aria-controls="ab-office-records"
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <History size={15} />
              История
              {retainedBookings.length + cancelled.length > 0 && (
                <Badge tone="accent">{retainedBookings.length + cancelled.length}</Badge>
              )}
            </Button>
            <Button
              variant="secondary"
              className="bk-my-button ab-create-button"
              type="button"
              aria-label="Новая бронь"
              onClick={() => openCreate(selectedId || undefined)}
              disabled={!resources.length || !data.available || busy}
            >
              <Plus size={15} />
              Новая бронь
            </Button>
          </>
        }
        overlays={
          <>
            {notice && (
              <div className="ab-toast" role="status">
                <CheckCircle2 size={17} />
                {notice}
                <CloseButton
                  type="button"
                  aria-label="Закрыть уведомление"
                  onClick={() => setNotice('')}
                >
                  <X size={14} />
                </CloseButton>
              </div>
            )}
            <AdminBookingForm controller={controller} />
          </>
        }
      >
        <div className="ab-page ab-office-workspace">
          <BookingWorkspace
            className="ab-work-area"
            viewportRef={workAreaRef}
            mapClassName="ab-map-stage"
            timelineClassName="ab-timeline-card"
            map={
              <>
                <BookingPlan
                  floor={floor}
                  bookings={bookings}
                  date={date}
                  start={cursorMinute}
                  end={Math.min(1440, cursorMinute + 1)}
                  cursorMinute={cursorMinute}
                  selectedId={selectedId}
                  filter="all"
                  onSelect={selectResource}
                  disabled={!mapAvailable}
                  viewMode="moment"
                />
                <BookingFloorControls
                  floors={office.floors}
                  selectedId={floor.id}
                  onSelect={chooseFloor}
                  disabled={busy}
                  className="ab-floor-switcher"
                  label="Этаж расписания"
                />
                {(pageError || data.error) && (
                  <div className="ab-page-error ab-map-error" role="alert">
                    <AlertCircle size={16} />
                    <span>{pageError || data.error}</span>
                    {data.error ? (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => void data.refresh()}
                        disabled={data.loading || busy}
                      >
                        <RefreshCw size={15} />
                        Обновить
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => setPageError('')}
                        aria-label="Закрыть ошибку"
                      >
                        <X size={15} />
                      </Button>
                    )}
                  </div>
                )}
                {!hours.enabled && !pageError && !data.error && (
                  <div className="ab-map-notice">
                    <Clock3 size={14} />В этот день офис закрыт
                  </div>
                )}
                {resources.length === 0 && (
                  <div className="ab-map-empty">
                    На этом этаже пока нет помещений и рабочих мест
                  </div>
                )}
                <AdminBookingHistory controller={controller} />
              </>
            }
            timeline={
              <>
                {data.available ? (
                  <BookingTimeline
                    currentUserId={user?.id || ''}
                    canManageAll
                    focusBooking={timelineFocus}
                    onFocusConsumed={consumeTimelineFocus}
                    bookingEditMode={() => (data.available && !busy ? 'all' : 'none')}
                    initialHeight={205}
                    maxPanelHeight={maxTimelineHeight}
                    floor={floor}
                    bookings={bookings}
                    date={date}
                    range={{ start: hours.start, end: hours.end }}
                    dateControl={dateControl}
                    hours={hours}
                    cursorMinute={cursorMinute}
                    selectedId={selectedId}
                    onSelect={selectResource}
                    onRoomSelect={selectResource}
                    onRangeChange={() => undefined}
                    onCursorChange={setCursorMinute}
                    onBookingClick={openBooking}
                    onBookingChange={changeBooking}
                    onCreate={openCreate}
                  />
                ) : (
                  <div className="ab-availability-state ab-workspace-unavailable" role="status">
                    <div>
                      {data.loading ? <Spinner size={19} /> : <AlertCircle size={19} />}
                      <span>{data.loading ? 'Загружаем расписание' : 'Занятость недоступна'}</span>
                      {!data.loading && (
                        <Button
                          variant="secondary"
                          type="button"
                          className="adm-secondary"
                          onClick={() => void data.refresh()}
                        >
                          <RefreshCw size={14} />
                          Обновить
                        </Button>
                      )}
                    </div>
                    <div className="ab-unavailable-date">{dateControl}</div>
                  </div>
                )}
              </>
            }
          />
        </div>
      </AdminShell>
    </>
  );
}

const styles = String.raw`
.ab-timeline-card {
  flex: 0 0 auto;
  border: 0;
  border-top: 1px solid #e2e7f0;
  box-shadow: none;
  border-radius: 0;
  overflow: hidden;
  min-width: 0;
  background: #fff;
}
.ab-timeline-card .bk-timeline {
  border-top: 0;
}
.ab-timeline-card .bk-timeline-row {
  height: 35px;
  min-height: 35px;
}
.ab-timeline-card .bk-timeline-row.is-desk {
  height: 34px;
  min-height: 34px;
}
.ab-timeline-card .bk-timeline-body {
  padding-top: 0;
}
.ab-timeline-card .bk-timeline-resizer {
  height: 8px;
  min-height: 8px;
}
.ab-page-error {
  padding: 11px 13px;
  border: 1px solid #f0d8dc;
  background: #fff4f5;
  border-radius: 8px;
  margin: 10px 0 15px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
  color: #b47e86;
  line-height: 1.7;
}
.ab-page-error > svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.ab-page-error > button {
  display: flex;
  margin-left: auto;
  color: #ba929a;
}
.ab-toast {
  position: fixed;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 210;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 30px);
  padding: 13px 17px;
  background: #fff;
  box-shadow: 0 8px 35px #435b7b22;
  border: 1px solid #e0e8ee;
  border-radius: 11px;
  color: #7e9e91;
  font-size: 11px;
  line-height: 1.5;
}
.ab-toast > svg {
  flex-shrink: 0;
}
.ab-toast > button {
  display: flex;
  color: #a5b1c0;
  margin-left: 6px;
}
@media (max-width: 760px) {
  .ab-timeline-card .bk-timeline-ruler-row > .bk-timeline-date-control {
    padding-left: 2px;
    padding-right: 2px;
  }
}
.ab-availability-state {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0;
  gap: 0;
  text-align: center;
  color: #95a2ba;
}
.ab-availability-state button,
.ab-page-error > button {
  align-items: center;
  gap: 7px;
}
.ab-page.ab-office-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  max-width: none !important;
  margin: 0 !important;
  overflow: hidden;
}
.ab-work-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.ab-map-stage {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 100px;
  min-width: 0;
  overflow: hidden;
  background: #f4f6fb;
}
.ab-map-stage > .bk-plan {
  min-height: 0;
}
.ab-map-stage .bk-plan-caption {
  display: none;
}
.ab-map-stage .bk-plan-legend {
  top: auto;
}
.office-workspace-actions .ab-create-button {
  background: #f4f5fc;
  border-color: #e2e6f5;
  color: #7482c7;
  font-weight: 650;
}
.office-workspace-actions .ab-create-button:hover:not(:disabled) {
  background: #eceffa;
}
.office-workspace-actions .ab-create-button:disabled {
  opacity: 0.5;
}
.ab-map-stage > .ab-floor-switcher {
  right: 18px;
  top: 14px;
  max-height: calc(100% - 28px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.ab-map-stage > .ab-floor-switcher button {
  flex-shrink: 0;
}
.ab-map-error {
  position: absolute;
  left: 18px;
  right: 76px;
  top: 14px;
  z-index: 13;
  max-height: calc(100% - 28px);
  overflow: auto;
  margin: 0;
  background: #fff4f5f5;
  box-shadow: 0 5px 18px #40577f0d;
}
.ab-map-error > span {
  min-width: 0;
  flex: 1;
}
.ab-map-error > button {
  flex-shrink: 0;
  align-self: center;
  white-space: nowrap;
}
.ab-map-notice {
  position: absolute;
  top: 14px;
  left: 18px;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #ffffffeb;
  color: #8f9cb2;
  font-size: 10px;
  pointer-events: none;
}
.ab-map-empty {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: 300px;
  width: 75%;
  padding: 17px 20px;
  border: 1px solid #e3e9f2;
  border-radius: 10px;
  background: #fffffff0;
  color: #95a2b8;
  font-size: 11px;
  line-height: 1.7;
  text-align: center;
  pointer-events: none;
}
.ab-workspace-unavailable > div:first-child {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 10px;
  padding: 16px;
  font-size: 11px;
}
.ab-workspace-unavailable .adm-secondary {
  min-height: 30px;
  padding: 6px 9px;
  font-size: 10px;
}
.ab-unavailable-date {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  border-top: 1px solid #edf0f6;
  padding: 4px 12px;
}
@media (max-width: 720px) {
  .ab-map-stage > .ab-floor-switcher {
    right: 10px;
    top: 10px;
    max-height: calc(100% - 20px);
  }
  .ab-map-error {
    left: 10px;
    right: 57px;
    top: 10px;
    font-size: 10px;
    padding: 9px;
    gap: 6px;
  }
  .ab-map-error > button {
    font-size: 9px;
    gap: 4px;
  }
  .ab-map-notice {
    left: 10px;
    top: 10px;
    font-size: 9px;
  }
  .ab-map-stage .bk-plan-legend {
    left: 10px;
    bottom: 11px;
    padding: 7px 9px;
    font-size: 8px;
    gap: 9px;
  }
  .ab-map-stage .bk-plan-zoom {
    bottom: 10px;
  }
  .ab-workspace-unavailable > div:first-child {
    font-size: 10px;
    flex-wrap: wrap;
  }
}
.ab-records-button,
.ab-create-button {
  min-height: 34px;
  font-size: 10px;
}
@media (max-width: 720px) {
  .ab-records-button,
  .ab-create-button {
    width: 32px;
    min-width: 32px;
    padding: 0;
    font-size: 0;
    gap: 0;
  }
  .ab-records-button > .ui-badge {
    display: none;
  }
}
`;
