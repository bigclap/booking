import type { ReactElement } from 'react';
import { Button, CloseButton, Styles } from '../../shared/atoms';

import { Armchair, ArrowRight, Check, DoorOpen, MapPin, Plus, Users, X } from 'lucide-react';
import { getCatalogItem } from '../../office';

import { isWorkplace, minutesToTime } from '../lib/bookingModel';

import BookingDetails from '../molecules/BookingDetails';

import { readableDate } from '../lib/bookingTime';
import type { BookingController } from '../hooks/useBookingPage';
import BookingForm from './BookingForm';

export default function BookingResourcePanel({
  controller,
}: {
  controller: BookingController;
}): ReactElement {
  const {
    currentUserId,
    date,
    saving,
    bookingsAvailable,
    floor,
    cursorMinute,
    panel,
    setPanel,
    hours,
    activeBooking,
    selected,
    editMode,
    historicalBooking,
    bookingResource,
    mapRangeValid,
    conflicts,
    roomCapacity,
    openCreate,
    showBooking,
    editBooking,
    cancelBooking,
    equipment,
    deskFeatures,
    nearbyContext,
  } = controller;

  return (
    <>
      <Styles id="bookingresourcepanel">{styles}</Styles>
      {panel && selected && (
        <aside className="bk-resource-card" aria-label="Карточка бронирования">
          <CloseButton
            className="bk-card-close"
            aria-label="Закрыть карточку"
            onClick={() => setPanel(null)}
          >
            <X size={17} />
          </CloseButton>
          <div className="bk-resource-scroll">
            <div className={'bk-card-cover ' + (selected.kind === 'room' ? 'is-room' : 'is-desk')}>
              <div className="bk-card-cover-grid" />
              {selected.kind === 'room' ? (
                <DoorOpen size={46} strokeWidth={1.2} />
              ) : (
                <img
                  src={getCatalogItem(selected.type)?.asset || '/assets/furniture/desk.svg'}
                  alt=""
                />
              )}
              <span>
                <MapPin size={11} />
                {panel === 'booking' ? bookingResource?.floorName : floor.name}
              </span>
            </div>
            <div className="bk-card-body">
              <div className="bk-card-kind">
                {panel === 'booking' && historicalBooking
                  ? 'ИСТОРИЯ БРОНИ'
                  : selected.kind === 'room'
                    ? 'ПОМЕЩЕНИЕ'
                    : 'РАБОЧЕЕ МЕСТО'}
              </div>
              <h2>{panel === 'booking' ? bookingResource?.name : selected.name}</h2>
              {!(panel === 'booking' && historicalBooking) && (
                <>
                  <div className="bk-card-facts">
                    <span>
                      {selected.kind === 'room' ? <Users size={14} /> : <Armchair size={14} />}
                      {selected.kind === 'room'
                        ? roomCapacity > 0
                          ? roomCapacity + ' сидячих мест'
                          : 'Сидячие места не указаны'
                        : 'Для одного'}
                    </span>
                    {selected.shared && (
                      <span>
                        <Users size={14} />
                        Есть отдельные места
                      </span>
                    )}
                  </div>
                  {isWorkplace(selected) ? (
                    <section className="bk-desk-equipment">
                      <h3>Оснащение рабочего места</h3>
                      <div>
                        {deskFeatures.map((item) => {
                          const catalog = getCatalogItem(item.type);
                          return (
                            <span key={item.type}>
                              {catalog && <img src={catalog.asset} alt="" />}
                              <b>{catalog?.name || 'Оснащение'}</b>
                              {item.quantity > 1 && <small>×{item.quantity}</small>}
                            </span>
                          );
                        })}
                      </div>
                      {!equipment.length && <p>Дополнительное оснащение не указано</p>}
                    </section>
                  ) : (
                    equipment.filter((item) => getCatalogItem(item.type)?.category === 'equipment')
                      .length > 0 && (
                      <div className="bk-equipment">
                        {equipment
                          .filter((item) => getCatalogItem(item.type)?.category === 'equipment')
                          .map((item) => (
                            <span key={item.type}>
                              {getCatalogItem(item.type)?.name}
                              {item.quantity > 1 ? ' ×' + item.quantity : ''}
                            </span>
                          ))}
                      </div>
                    )
                  )}
                </>
              )}

              {!(panel === 'booking' && historicalBooking) && nearbyContext.length > 0 && (
                <section className="bk-spatial-context">
                  <h3>Ближайшие объекты</h3>
                  <div>
                    {nearbyContext.map((item) => (
                      <span key={item.id}>
                        {getCatalogItem(item.type) && (
                          <img src={getCatalogItem(item.type)!.asset} alt="" />
                        )}
                        {item.name}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              {panel === 'resource' && (
                <>
                  <div
                    className={
                      'bk-availability ' +
                      (mapRangeValid && !conflicts.length ? 'is-free' : 'is-busy')
                    }
                  >
                    <span className="bk-status-dot" />
                    <div>
                      <b>
                        {!bookingsAvailable
                          ? 'Занятость неизвестна'
                          : !hours.enabled
                            ? 'Офис закрыт'
                            : !mapRangeValid
                              ? 'Вне рабочих часов'
                              : conflicts.length
                                ? 'Занято в ' + minutesToTime(cursorMinute)
                                : 'Свободно в ' + minutesToTime(cursorMinute)}
                      </b>
                      <small>{readableDate(date)}</small>
                    </div>
                  </div>
                  {conflicts.length > 0 && (
                    <div className="bk-conflict-list">
                      <span>БРОНЬ В ЭТО ВРЕМЯ</span>
                      {conflicts.map((item) => (
                        <Button variant="secondary" key={item.id} onClick={() => showBooking(item)}>
                          <span>
                            <b>
                              {minutesToTime(item.start)}–{minutesToTime(item.end)}
                            </b>
                            <small>
                              {item.ownerId === currentUserId ? 'Ваша бронь' : item.ownerName}
                            </small>
                          </span>
                          <ArrowRight size={14} />
                        </Button>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="primary"
                    className="bk-primary"
                    disabled={!hours.enabled || !bookingsAvailable || saving}
                    onClick={() => openCreate(selected.id, cursorMinute)}
                  >
                    <Plus size={16} />
                    {conflicts.length ? 'Выбрать другое время' : 'Забронировать'}
                  </Button>
                </>
              )}

              {panel === 'create' && <BookingForm controller={controller} />}

              {panel === 'booking' && activeBooking && (
                <>
                  <BookingDetails booking={activeBooking} />
                  <div
                    className={
                      'bk-booking-owner ' +
                      (activeBooking.ownerId === currentUserId ? 'is-mine' : '')
                    }
                  >
                    <span>
                      {activeBooking.ownerId === currentUserId ? (
                        <Check size={17} />
                      ) : (
                        <Users size={17} />
                      )}
                    </span>
                    <div>
                      <b>
                        {activeBooking.ownerId === currentUserId
                          ? 'Ваша бронь'
                          : activeBooking.ownerName}
                      </b>
                      <small>
                        {historicalBooking
                          ? 'Сохранённая запись'
                          : activeBooking.needsReview
                            ? 'Проверьте условия брони'
                            : activeBooking.ownerId === currentUserId
                              ? 'Всё готово к вашему приходу'
                              : 'Владелец брони'}
                      </small>
                    </div>
                  </div>
                  <dl className="bk-booking-details">
                    <div>
                      <dt>Дата</dt>
                      <dd>{readableDate(activeBooking.date)}</dd>
                    </div>
                    <div>
                      <dt>Время</dt>
                      <dd>
                        {minutesToTime(activeBooking.start)}–{minutesToTime(activeBooking.end)}
                      </dd>
                    </div>
                    {activeBooking.participants && (
                      <div>
                        <dt>Участники</dt>
                        <dd>{activeBooking.participants}</dd>
                      </div>
                    )}
                  </dl>
                  {activeBooking.ownerId === currentUserId &&
                    editMode(activeBooking) !== 'none' && (
                      <>
                        <Button
                          variant="primary"
                          className="bk-primary"
                          disabled={saving || !bookingsAvailable}
                          onClick={() => editBooking(activeBooking)}
                        >
                          Изменить бронь
                        </Button>
                        <Button
                          variant="secondary"
                          className="bk-cancel-button"
                          disabled={saving || !bookingsAvailable}
                          onClick={() => void cancelBooking(activeBooking)}
                        >
                          {editMode(activeBooking) === 'end'
                            ? 'Завершить сейчас'
                            : 'Отменить бронь'}
                        </Button>
                      </>
                    )}
                </>
              )}
            </div>
          </div>
        </aside>
      )}

      {panel === 'booking' && !selected && activeBooking && (
        <aside className="bk-resource-card" aria-label="Карточка недоступного ресурса">
          <CloseButton
            className="bk-card-close"
            aria-label="Закрыть карточку"
            onClick={() => setPanel(null)}
          >
            <X size={17} />
          </CloseButton>
          <div className="bk-resource-scroll">
            <div className="bk-card-body">
              <div className="bk-card-kind">
                {historicalBooking ? 'ИСТОРИЯ БРОНИ' : 'ПРОСТРАНСТВО НЕДОСТУПНО'}
              </div>
              <h2>{bookingResource?.name}</h2>
              <p className="booking-record-summary">
                <span>{bookingResource?.floorName}</span>
                <small>Пространство больше не доступно на плане. Запись о брони сохранена.</small>
              </p>
              <BookingDetails booking={activeBooking} />
              <dl className="bk-booking-details">
                <div>
                  <dt>Владелец</dt>
                  <dd>
                    {activeBooking.ownerId === currentUserId ? 'Вы' : activeBooking.ownerName}
                  </dd>
                </div>
                <div>
                  <dt>Дата</dt>
                  <dd>{readableDate(activeBooking.date)}</dd>
                </div>
                <div>
                  <dt>Время</dt>
                  <dd>
                    {minutesToTime(activeBooking.start)}–{minutesToTime(activeBooking.end)}
                  </dd>
                </div>
              </dl>
              {activeBooking.ownerId === currentUserId && editMode(activeBooking) !== 'none' && (
                <Button
                  variant="secondary"
                  className="bk-cancel-button"
                  disabled={saving || !bookingsAvailable}
                  onClick={() => void cancelBooking(activeBooking)}
                >
                  {editMode(activeBooking) === 'end' ? 'Завершить сейчас' : 'Отменить бронь'}
                </Button>
              )}
            </div>
          </div>
        </aside>
      )}
    </>
  );
}

const styles = String.raw`
.bk-resource-card {
  position: absolute;
  right: 79px;
  top: 16px;
  width: 286px;
  max-height: calc(100% - 30px);
  display: flex;
  flex-direction: column;
  z-index: 10;
  background: #fff;
  border: 1px solid #e0e6f1;
  border-radius: 13px;
  box-shadow: 0 15px 45px #40577f19;
  overflow: hidden;
}
.bk-card-cover {
  height: 95px;
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eff3fc;
  overflow: hidden;
  color: #8e9bc0;
}
.bk-card-cover.is-room {
  background: #edf3ee;
  color: #96b09b;
}
.bk-card-cover-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(#b8c8dd15 1px, transparent 1px),
    linear-gradient(90deg, #b8c8dd15 1px, transparent 1px);
  background-size: 14px 14px;
}
.bk-card-cover > img {
  height: 64px;
  width: 130px;
  object-fit: contain;
  position: relative;
  filter: drop-shadow(0 7px 5px #667d9a10);
}
.bk-card-cover > svg {
  position: relative;
}
.bk-card-cover > span {
  position: absolute;
  left: 12px;
  bottom: 9px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: #8d9db6;
  font-size: 8px;
}
.bk-card-body {
  overflow-y: auto;
  padding: 17px;
}
.bk-card-kind {
  font-size: 8px;
  letter-spacing: 1.3px;
  color: #a1adc0;
  font-weight: 700;
}
.bk-card-body h2 {
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -0.5px;
  margin: 7px 0 10px;
  color: #50617d;
}
.bk-card-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  color: #8b9bb2;
  font-size: 9px;
}
.bk-card-facts > span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.bk-equipment {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 12px;
}
.bk-equipment span {
  background: #f5f7fb;
  border: 1px solid #edf0f5;
  color: #91a0b5;
  padding: 4px 6px;
  border-radius: 5px;
  font-size: 8px;
}
.bk-availability {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px;
  border: 1px solid #e3eee7;
  background: #f4faf6;
  border-radius: 8px;
  margin: 16px 0;
  color: #82aa91;
}
.bk-availability.is-busy {
  color: #be8b8b;
  border-color: #f0dfdf;
  background: #fff8f8;
}
.bk-status-dot {
  height: 6px;
  width: 6px;
  background: currentColor;
  border-radius: 50%;
  flex-shrink: 0;
}
.bk-availability b {
  font-size: 10px;
  font-weight: 650;
  display: block;
}
.bk-availability small {
  font-size: 9px;
  display: block;
  margin-top: 4px;
  opacity: 0.8;
}
.bk-card-footnote {
  text-align: center;
  color: #a7b0c0;
  font-size: 8px;
  line-height: 1.5;
  margin: 9px 0 0;
}
.bk-conflict-list {
  margin-bottom: 15px;
}
.bk-conflict-list > span {
  display: block;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #acb4c4;
  margin-bottom: 5px;
}
.bk-conflict-list > button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  background: none;
  color: #9ba8bc;
  border-bottom: 1px solid #f0f2f7;
  text-align: left;
}
.bk-conflict-list b {
  display: block;
  font-size: 10px;
  color: #8b9bb3;
  font-weight: 600;
}
.bk-conflict-list small {
  display: block;
  font-size: 9px;
  color: #adb6c5;
  margin-top: 3px;
}
.bk-resource-card:has(.bk-booking-form) .bk-card-cover {
  display: none;
}
.bk-booking-owner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 19px;
  padding: 11px;
  border: 1px solid #e7ebf4;
  background: #f8f9fc;
  border-radius: 8px;
  color: #93a0b8;
}
.bk-booking-owner.is-mine {
  color: #8696d9;
  background: #f5f6ff;
  border-color: #e7eafb;
}
.bk-booking-owner > span {
  height: 29px;
  width: 29px;
  display: grid;
  place-items: center;
  background: #fff;
  border-radius: 50%;
}
.bk-booking-owner b {
  display: block;
  font-size: 11px;
  color: #7c8dae;
  font-weight: 650;
}
.bk-booking-owner small {
  display: block;
  font-size: 8px;
  color: #a8b1c4;
  margin-top: 4px;
}
.bk-booking-details {
  display: flex;
  flex-direction: column;
  gap: 13px;
  margin: 19px 0;
  color: #8c9db6;
  font-size: 10px;
}
.bk-booking-details > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bk-booking-details dt {
  color: #a8b2c3;
}
.bk-booking-details dd {
  margin: 0;
  font-weight: 600;
}
.bk-cancel-button {
  display: block;
  width: 100%;
  text-align: center;
  background: none;
  color: #b5949d;
  font-size: 10px;
  padding: 13px 0 0;
}
@media (min-width: 1700px) {
  .bk-resource-card {
    width: 310px;
    right: 90px;
    top: 22px;
  }
  .bk-card-cover {
    height: 125px;
  }
  .bk-card-body {
    padding: 21px;
  }
}
@media (max-width: 1050px) {
  .bk-resource-card {
    right: 76px;
    width: 270px;
  }
}
@media (max-width: 720px) {
  .bk-resource-card {
    right: 55px;
    left: 10px;
    top: 10px;
    width: auto;
    max-width: 320px;
    max-height: calc(100% - 20px);
    border-radius: 10px;
  }
  .bk-card-cover {
    height: 65px;
  }
  .bk-card-body {
    padding: 13px;
  }
  .bk-card-body h2 {
    font-size: 18px;
  }
  .bk-availability {
    margin: 12px 0;
    padding: 9px;
  }
}
.bk-desk-equipment {
  margin: 16px 0;
}
.bk-desk-equipment h3 {
  margin: 0 0 10px;
  font-size: 9px;
  letter-spacing: 0.3px;
  font-weight: 650;
  color: #96a3b9;
}
.bk-desk-equipment > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bk-desk-equipment > div > span {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 27px;
  padding: 5px 8px;
  background: #f8f9fd;
  border: 1px solid #edf0f6;
  border-radius: 6px;
}
.bk-desk-equipment img {
  width: 24px;
  height: 23px;
  object-fit: contain;
  flex-shrink: 0;
}
.bk-desk-equipment b {
  font-size: 10px;
  font-weight: 500;
  color: #8494ae;
}
.bk-desk-equipment small {
  margin-left: auto;
  font-size: 9px;
  color: #a0acc0;
}
.bk-desk-equipment p {
  font-size: 9px;
  line-height: 1.5;
  color: #a5b0c2;
  margin: 8px 0;
}
.bk-spatial-context {
  margin: 15px 0;
}
.bk-spatial-context h3 {
  font-size: 9px;
  font-weight: 650;
  color: #96a3b9;
  margin: 0 0 8px;
}
.bk-spatial-context > div {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.bk-spatial-context span {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #f5f8fb;
  border: 1px solid #e6edf5;
  padding: 5px 7px;
  border-radius: 6px;
  font-size: 9px;
  color: #8b9eb8;
}
.bk-spatial-context img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
.bk-resource-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.bk-resource-card > .bk-card-close {
  position: absolute;
  top: 10px;
  right: 22px;
  z-index: 5;
}
.bk-resource-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #d9e1ed transparent;
}
.bk-resource-scroll > .bk-card-body {
  overflow: visible;
}
:is(.bk-resource-card:has(.bk-booking-form), .bk-resource-card:not(:has(.bk-card-cover)))
  .bk-card-kind,
:is(.bk-resource-card:has(.bk-booking-form), .bk-resource-card:not(:has(.bk-card-cover)))
  .bk-card-body
  > h2 {
  padding-right: 44px;
}
.bk-resource-card .bk-primary {
  width: 100%;
  margin-top: 17px;
}
.bk-resource-card .bk-cancel-button {
  width: 100%;
  margin-top: 9px;
}
`;
