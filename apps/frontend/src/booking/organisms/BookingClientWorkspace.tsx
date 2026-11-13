import type { ReactElement } from 'react';
import { Badge } from '../../shared/atoms';
import { Button, Styles } from '../../shared/atoms';

import BookingResourceControls from '../molecules/BookingResourceControls';
import BookingDateControls from '../molecules/BookingDateControls';
import BookingFloorControls from '../molecules/BookingFloorControls';
import BookingWorkspace from './BookingWorkspace';
import {
  Building2,
  CalendarDays,
  CheckCheck,
  Clock3,
  Grid2X2,
  MessageCircle,
  Sparkles,
} from 'lucide-react';

import BookingPlan from '../organisms/BookingPlan';
import BookingTimeline from '../organisms/BookingTimeline';

import { UserMenu } from '../../auth/organisms';
import { OfficeSwitcher } from '../../office/molecules';

import { AssistantPanel } from '../../assistant/organisms';

import type { BookingController } from '../hooks/useBookingPage';
import BookingResourcePanel from './BookingResourcePanel';
import MyBookingsPanel from './MyBookingsPanel';

export default function BookingClientWorkspace({
  controller,
}: {
  controller: BookingController;
}): ReactElement {
  const {
    office,
    currentUserId,
    officeView,
    date,
    bookingStore,
    bookings,
    saving,
    bookingsAvailable,
    bookingsLoading,
    setFloorId,
    floor,
    range,
    cursorMinute,
    setCursorMinute,
    filter,
    setFilter,
    selectedId,
    setSelectedId,
    panel,
    setPanel,
    timelineFocus,
    consumeTimelineFocus,
    setEditingId,
    notice,
    setMyBookingsOpen,
    chatOpen,
    setChatOpen,
    assistantStarted,
    assistantConversation,
    setAssistantConversation,
    hours,
    resources,
    selected,
    editMode,
    mapRange,
    mapRangeValid,
    formRangeComplete,
    availabilityLabel,
    mine,
    changeRange,
    openProposal,
    openAssistant,
    canContinueAssistant,
    chooseDate,
    selectResource,
    openCreate,
    showBooking,
    changeBooking,
  } = controller;
  const dateControl = <BookingDateControls date={date} onChange={chooseDate} />;

  return (
    <>
      <Styles id="bookingclientworkspace">{styles}</Styles>
      <div className="bk-shell">
        <header className="bk-header">
          <a className="bk-brand" href="/booking" aria-label="Планировка — бронирование">
            <span className="bk-brand-mark" aria-hidden="true">
              <Grid2X2 size={22} />
            </span>
            <span className="bk-brand-name">
              планировка<i>•</i>
            </span>
          </a>
          <div className="bk-office-context">
            <OfficeSwitcher />
            <i>/</i>
            <b>Бронирование</b>
          </div>
          <div className="bk-header-actions">
            <Button
              variant="secondary"
              className="bk-my-button"
              aria-label="Мои брони"
              onClick={() => setMyBookingsOpen(true)}
            >
              <CalendarDays size={15} />
              Мои брони{mine.length > 0 && <Badge tone="accent">{mine.length}</Badge>}
            </Button>
            <UserMenu />
          </div>
        </header>
        <BookingWorkspace
          landmark
          className="bk-main"
          toolbar={
            <div className="bk-map-toolbar">
              <BookingResourceControls value={filter} onChange={setFilter} />{' '}
              <span className="bk-free-count">
                <i />
                {availabilityLabel}
              </span>
            </div>
          }
          mapClassName={'bk-map-area' + (panel && selected ? ' has-card' : '')}
          map={
            <>
              <BookingPlan
                floor={floor}
                bookings={bookings}
                date={date}
                start={mapRange.start}
                end={mapRange.end}
                cursorMinute={cursorMinute}
                viewMode={panel === 'create' ? 'interval' : 'moment'}
                selectedId={selectedId}
                filter={filter}
                onSelect={selectResource}
                disabled={!mapRangeValid}
              />
              {resources.length === 0 && (
                <div className="bk-empty-office">
                  <Building2 size={29} />
                  <h2>На этом этаже пока нет мест</h2>
                  <p>Выберите другой этаж или офис. План этого этажа ещё готовится.</p>
                </div>
              )}
              <BookingFloorControls
                floors={officeView.floors}
                selectedId={floor.id}
                onSelect={(id) => {
                  setFloorId(id);
                  setSelectedId(null);
                  setPanel(null);
                  setEditingId(null);
                }}
              />
              {!hours.enabled && (
                <div className="bk-closed-note">
                  <Clock3 size={16} />В этот день офис закрыт. Выберите другую дату.
                </div>
              )}
              {bookingStore.error && (
                <div className="bk-save-error" role="alert">
                  {bookingStore.error}
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => void bookingStore.refresh()}
                  >
                    Повторить
                  </Button>
                </div>
              )}
              <BookingResourcePanel controller={controller} />{' '}
              <div hidden={!chatOpen}>
                {assistantStarted && (
                  <AssistantPanel
                    office={office}
                    floorId={floor.id}
                    date={date}
                    onClose={() => setChatOpen(false)}
                    onBookingsChanged={bookingStore.refresh}
                    onProposal={openProposal}
                    onConversationState={setAssistantConversation}
                  />
                )}
              </div>
              {!chatOpen && (
                <Button
                  variant="ghost"
                  className="bk-chat-launcher"
                  aria-label={
                    canContinueAssistant ? 'Продолжить диалог с помощником' : 'Открыть помощника'
                  }
                  onClick={openAssistant}
                >
                  <span>
                    <Sparkles size={18} />
                  </span>
                  <span>
                    {assistantConversation.processing
                      ? 'Подбираем место…'
                      : canContinueAssistant
                        ? 'Продолжить диалог'
                        : 'Найти с помощником'}
                    <small>
                      {canContinueAssistant ? 'Сообщения сохранены' : 'Опишите, что вам нужно'}
                    </small>
                  </span>
                  <MessageCircle size={16} />
                </Button>
              )}
            </>
          }
          timeline={
            <>
              {bookingsAvailable ? (
                <BookingTimeline
                  currentUserId={currentUserId}
                  focusBooking={timelineFocus}
                  onFocusConsumed={consumeTimelineFocus}
                  bookingEditMode={(booking) => (saving ? 'none' : editMode(booking))}
                  dateControl={dateControl}
                  showRange={panel === 'create' && formRangeComplete}
                  floor={floor}
                  bookings={bookings}
                  date={date}
                  range={range}
                  hours={hours}
                  cursorMinute={cursorMinute}
                  selectedId={selectedId}
                  onSelect={selectResource}
                  onRangeChange={changeRange}
                  onCursorChange={setCursorMinute}
                  onBookingClick={showBooking}
                  onBookingChange={changeBooking}
                  onCreate={openCreate}
                />
              ) : (
                <div className="bk-unavailable-timeline" role="status">
                  <p>
                    {bookingsLoading ? 'Загружаем расписание…' : 'Занятость пока неизвестна'}
                    {!bookingsLoading && (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => void bookingStore.refresh()}
                      >
                        Обновить
                      </Button>
                    )}
                  </p>
                  {dateControl}
                </div>
              )}
            </>
          }
        />
        {notice && (
          <div className="bk-toast" role="status">
            <CheckCheck size={17} />
            {notice}
          </div>
        )}
        <MyBookingsPanel controller={controller} />{' '}
      </div>
    </>
  );
}

const styles = String.raw`
.bk-shell {
  height: 100dvh;
  min-height: 540px;
  display: flex;
  flex-direction: column;
  background: #f5f7fb;
  color: #35435a;
  font-family: Manrope, system-ui, sans-serif;
  overflow: hidden;
}
.bk-shell button,
.bk-shell input,
.bk-shell a {
  font-family: inherit;
}
.bk-shell a {
  text-decoration: none;
  color: inherit;
}
.bk-header {
  height: 64px;
  flex-shrink: 0;
  padding: 0 25px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: white;
  border-bottom: 1px solid #e7ebf2;
  z-index: 20;
}
.bk-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 23px;
  letter-spacing: -1px;
  font-weight: 800;
  color: #303c4b;
  white-space: nowrap;
}
.bk-brand-mark {
  height: 36px;
  width: 36px;
  display: grid;
  place-items: center;
  color: white;
  background: #727ddb;
  border: 1px solid #626ed0;
  border-radius: 11px;
  box-shadow: inset 0 1px 0 #ffffff3b;
}
.bk-brand i {
  font-style: normal;
  color: #aeb6d1;
  font-size: 24px;
  margin-left: 6px;
}
.bk-header-actions {
  display: flex;
  align-items: center;
  gap: 13px;
}
.bk-my-button {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid #e2e7f0;
  border-radius: 8px;
  background: white;
  color: #65758d;
  font-size: 11px;
}
.bk-eyebrow {
  font-size: 8px;
  letter-spacing: 1.5px;
  color: #a4aec0;
  font-weight: 700;
}
.bk-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.bk-map-toolbar {
  height: 47px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 26px;
  background: #f9fafd;
  border-bottom: 1px solid #e9edf5;
  gap: 12px;
}
.bk-free-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #8a9bb4;
  white-space: nowrap;
}
.bk-free-count i {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #80b59f;
}
.bk-map-area {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 170px;
  overflow: hidden;
}
.bk-empty-office {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  max-width: 340px;
  width: 80%;
  padding: 25px;
  background: #ffffffee;
  border: 1px solid #e4e9f3;
  border-radius: 14px;
  box-shadow: 0 7px 28px #42578008;
}
.bk-empty-office > svg {
  color: #9ca9ce;
}
.bk-empty-office h2 {
  font-size: 17px;
  color: #687994;
  letter-spacing: -0.4px;
  margin: 15px 0 9px;
}
.bk-empty-office p {
  font-size: 11px;
  color: #a0aabd;
  line-height: 1.8;
}
.bk-empty-office a {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #8c94cf;
  text-decoration: none;
  margin-top: 9px;
}
.bk-empty-floor {
  position: absolute;
  left: 50%;
  top: 45%;
  transform: translate(-50%, -50%);
  width: 280px;
  text-align: center;
  color: #a1aec1;
  pointer-events: none;
}
.bk-empty-floor > svg {
  margin: auto;
}
.bk-empty-floor h3 {
  font-size: 15px;
  color: #7c8ca7;
  margin: 14px 0 6px;
}
.bk-empty-floor p {
  font-size: 11px;
  line-height: 1.8;
}
.bk-closed-note {
  position: absolute;
  top: 17px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid #eadfc6;
  background: #fffcf4;
  color: #ad9876;
  border-radius: 8px;
  font-size: 11px;
  z-index: 4;
  white-space: nowrap;
}
.bk-save-error {
  position: absolute;
  left: 15px;
  top: 15px;
  background: #fff3f2;
  color: #bd807f;
  padding: 10px 14px;
  border: 1px solid #f0d7d4;
  border-radius: 8px;
  font-size: 11px;
  z-index: 25;
}
.bk-chat-launcher {
  position: absolute;
  right: 20px;
  bottom: 18px;
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e2e7f1;
  border-radius: 12px;
  box-shadow: 0 5px 20px #43547512;
  text-align: left;
  color: #8e9ac1;
  font-size: 10px;
}
.bk-chat-launcher > span:first-child {
  height: 31px;
  width: 31px;
  display: grid;
  place-items: center;
  background: #eef0fd;
  border-radius: 8px;
  color: #8b96d8;
}
.bk-chat-launcher > span:nth-child(2) {
  font-weight: 650;
  color: #7e8caf;
}
.bk-chat-launcher small {
  display: block;
  margin-top: 4px;
  color: #a9b2c5;
  font-size: 8px;
  font-weight: 400;
}
.has-card .bk-chat-launcher {
  width: 40px;
  height: 40px;
  padding: 4px;
  border-radius: 50%;
  bottom: 15px;
  right: 21px;
}
.has-card .bk-chat-launcher > span:nth-child(2),
.has-card .bk-chat-launcher > svg {
  display: none;
}
.has-card .bk-chat-launcher > span:first-child {
  background: none;
}
.bk-toast {
  position: fixed;
  left: 50%;
  top: 80px;
  transform: translateX(-50%);
  padding: 12px 17px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border: 1px solid #e1e7f1;
  border-radius: 10px;
  box-shadow: 0 8px 25px #40577f20;
  z-index: 100;
  color: #7f91b4;
  font-size: 11px;
  max-width: 90vw;
}
.bk-toast svg {
  color: #9ab6a6;
  flex-shrink: 0;
}
@media (min-width: 1700px) {
  .bk-map-toolbar {
    padding: 0 32px;
    height: 54px;
  }
  .bk-header {
    height: 70px;
    padding: 0 32px;
  }
}
@media (max-width: 1050px) {
  .bk-header {
    padding: 0 18px;
  }
}
@media (max-width: 720px) {
  .bk-shell {
    min-height: 620px;
  }
  .bk-header {
    height: 54px;
    padding: 0 13px;
    gap: 8px;
  }
  .bk-brand {
    font-size: 20px;
    gap: 7px;
  }
  .bk-brand-mark {
    height: 31px;
    width: 31px;
    border-radius: 9px;
  }
  .bk-brand i {
    display: none;
  }
  .bk-header-actions {
    gap: 8px;
  }
  .bk-my-button {
    font-size: 0;
    width: 32px;
    padding: 0;
    justify-content: center;
    border: 0;
    background: #f7f8fc;
  }
  .bk-map-toolbar {
    height: 43px;
    padding: 0 9px;
  }
  .bk-free-count {
    display: none;
  }
  .bk-map-area {
    min-height: 180px;
  }
  .bk-chat-launcher {
    right: 10px;
    bottom: 11px;
    width: 41px;
    height: 41px;
    border-radius: 50%;
    padding: 4px;
  }
  .bk-chat-launcher > span:nth-child(2),
  .bk-chat-launcher > svg {
    display: none;
  }
  .bk-chat-launcher > span:first-child {
    background: none;
  }
  .bk-closed-note {
    font-size: 9px;
    white-space: normal;
    width: calc(100% - 85px);
    left: 10px;
    transform: none;
    top: 10px;
    line-height: 1.5;
  }
  .bk-toast {
    top: 60px;
    font-size: 10px;
    padding: 10px 12px;
    width: max-content;
    max-width: 90vw;
  }
}
.bk-timeline-ruler-row > .bk-timeline-label {
  padding: 0 5px !important;
  overflow: visible;
}
@media (max-width: 720px) {
  .bk-map-area .bk-plan-zoom {
    right: 62px;
  }
}
.bk-unavailable-timeline {
  height: 205px;
  flex-shrink: 0;
  background: #fff;
  border-top: 1px solid #e1e7f1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}
.bk-unavailable-timeline > p {
  font-size: 12px;
  color: #899ab3;
  display: flex;
  align-items: center;
  gap: 12px;
}
.bk-unavailable-timeline > p > button {
  font: inherit;
  color: #667ebe;
  border: 0;
  background: transparent;
  text-decoration: underline;
}
.bk-office-context {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  color: #8d99ad;
  font-size: 10px;
}
.bk-office-context > i {
  font-style: normal;
  color: #c6ccda;
}
.bk-office-context > b {
  font-weight: 600;
  white-space: nowrap;
}
@media (max-width: 1000px) {
  .bk-office-context {
    gap: 5px;
  }
  .bk-office-context > b,
  .bk-office-context > i {
    display: none;
  }
}
@media (max-width: 760px) {
  .bk-office-context {
    max-width: 145px;
  }
}
.bk-main > .bk-map-area {
  min-height: 170px;
}
@media (max-width: 720px) {
  .bk-main > .bk-map-area {
    min-height: 180px;
  }
}
@media (max-width: 600px) {
  .bk-header {
    min-width: 0;
    justify-content: flex-start;
    gap: 8px;
  }
  .bk-brand {
    flex: 0 0 31px;
    width: 31px;
    min-width: 31px;
    gap: 0;
  }
  .bk-brand-name {
    display: none;
  }
  .bk-office-context {
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
    justify-content: flex-start;
  }
  .bk-office-context > .office-switcher {
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
  }
  .bk-office-context .office-switcher-trigger {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    justify-content: flex-start;
  }
  .bk-office-context .office-switcher-trigger > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bk-header-actions {
    flex: 0 0 auto;
  }
  .bk-header-actions > .bk-my-button {
    flex: 0 0 34px;
    width: 34px;
    min-width: 34px;
    max-width: 34px;
    min-height: 34px;
    height: 34px;
    padding: 0;
    gap: 0;
  }
}
`;
