import type { ReactElement } from 'react';
import { Badge } from '../../shared/atoms';
import { Button, Styles } from '../../shared/atoms';

import { Dialog } from '../../shared/molecules';

import BookingRecordCard from '../molecules/BookingRecordCard';
import { CalendarDays } from 'lucide-react';

import type { BookingController } from '../hooks/useBookingPage';

export default function MyBookingsPanel({
  controller,
}: {
  controller: BookingController;
}): ReactElement {
  const {
    office,
    bookingStore,
    myBookingsOpen,
    setMyBookingsOpen,
    mine,
    cancelledMine,
    showBooking,
  } = controller;

  return (
    <>
      <Styles id="my-bookings-panel">{styles}</Styles>
      <Dialog
        closeLabel="Закрыть мои брони"
        open={myBookingsOpen}
        onClose={() => setMyBookingsOpen(false)}
        ariaLabel="Мои брони"
        className="bk-my-bookings"
        bodyClassName="bk-my-scroll"
        backdropClassName="bk-modal-backdrop"
      >
        {' '}
        <div className="bk-eyebrow">ВСЁ ПОД РУКОЙ</div>
        <h2>
          Мои брони <Badge tone="accent">{mine.length}</Badge>
        </h2>
        <p>Брони в офисе «{office.name}»</p>
        {mine.length ? (
          <div className="bk-my-list">
            {mine.map((item) => (
              <BookingRecordCard
                key={item.id}
                booking={item}
                office={office}
                serverNow={bookingStore.serverNow}
                onOpen={showBooking}
              />
            ))}
          </div>
        ) : (
          <div className="bk-no-bookings">
            <CalendarDays size={32} />
            <h3>Здесь появятся ваши планы</h3>
            <p>Выберите место на плане и создайте первую бронь.</p>
            <Button
              variant="primary"
              className="bk-primary"
              onClick={() => setMyBookingsOpen(false)}
            >
              Найти место
            </Button>
          </div>
        )}
        {cancelledMine.length > 0 && (
          <details className="booking-history-list">
            <summary>Отменённые записи · {cancelledMine.length}</summary>
            <div className="bk-my-list">
              {cancelledMine.map((item) => (
                <BookingRecordCard
                  key={item.id}
                  booking={item}
                  office={office}
                  serverNow={bookingStore.serverNow}
                  onOpen={showBooking}
                />
              ))}
            </div>
          </details>
        )}
      </Dialog>
    </>
  );
}

const styles = String.raw`
.bk-my-bookings h2 {
  font-size: 23px;
  letter-spacing: -0.6px;
  color: #617391;
  margin: 8px 0;
}
.bk-my-bookings h2 > span {
  font-size: 13px;
  color: #9ba8c8;
  margin-left: 7px;
}
.bk-my-bookings > p {
  font-size: 11px;
  color: #a0aec1;
  margin: 0 0 21px;
}
.bk-my-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bk-my-list > button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px;
  border: 1px solid #e8edf4;
  border-radius: 9px;
  text-align: left;
  background: #fff;
  color: #a1acc3;
}
.bk-my-icon {
  display: grid;
  place-items: center;
  height: 37px;
  width: 37px;
  background: #f2f4fd;
  border-radius: 9px;
  color: #9aa8d4;
}
.bk-my-list b {
  font-size: 12px;
  color: #7f91ad;
  font-weight: 650;
}
.bk-my-list small {
  display: block;
  color: #a7b3c5;
  font-size: 10px;
  margin-top: 5px;
}
.bk-my-list > button > svg {
  margin-left: auto;
}
.bk-no-bookings {
  text-align: center;
  padding: 25px 10px;
  color: #b1bed4;
}
.bk-no-bookings > svg {
  margin: auto;
}
.bk-no-bookings h3 {
  font-size: 15px;
  color: #95a3bd;
  margin: 15px 0 8px;
}
.bk-no-bookings p {
  font-size: 11px;
  color: #aab5c7;
  line-height: 1.8;
  margin-bottom: 20px;
}
@media (max-width: 720px) {
  .bk-my-bookings h2 {
    font-size: 21px;
  }
}
.booking-history-list {
  margin-top: 20px;
}
.booking-history-list > summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 0;
  font-size: 12px;
  color: #8393ae;
  cursor: pointer;
}
.bk-my-bookings.ui-dialog-panel {
  max-height: 80dvh;
  padding: 0;
}
.bk-my-scroll {
  padding: 28px;
}
.bk-my-scroll > h2 {
  padding-right: 34px;
}
.bk-my-scroll > p {
  font-size: 11px;
  color: #a0aec1;
  margin: 0 0 21px;
}
.bk-no-bookings > .bk-primary {
  width: 100%;
  margin-top: 15px;
}
@media (max-width: 720px) {
  .bk-my-scroll {
    padding: 23px 18px;
  }
}
`;
