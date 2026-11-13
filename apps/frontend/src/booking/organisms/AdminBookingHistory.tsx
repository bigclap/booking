import type { ReactElement } from 'react';
import { Badge } from '../../shared/atoms';
import { CloseButton, Styles } from '../../shared/atoms';

import BookingRecordCard from '../molecules/BookingRecordCard';
import { History, X } from 'lucide-react';

import { readableDate } from '../lib/bookingTime';
import type { AdminBookingController } from '../hooks/useAdminBookingsPage';

export default function AdminBookingHistory({
  controller,
}: {
  controller: AdminBookingController;
}): ReactElement {
  const {
    office,
    data,
    date,
    historyOpen,
    setHistoryOpen,
    busy,
    cancelled,
    retainedBookings,
    openBooking,
  } = controller;

  return (
    <>
      <Styles id="adminbookinghistory">{styles}</Styles>
      {historyOpen && (
        <section
          className="ab-records-panel"
          id="ab-office-records"
          aria-label="История и сохранённые записи"
        >
          <div className="ab-records-heading">
            <h2>Записи · {readableDate(date)}</h2>
            <CloseButton
              type="button"
              aria-label="Закрыть историю броней"
              onClick={() => setHistoryOpen(false)}
            >
              <X size={18} />
            </CloseButton>
          </div>
          <div className="ab-records-body">
            {!data.available ? (
              <p className="ab-records-empty">
                {data.loading ? 'Загружаем записи…' : 'Не удалось загрузить записи'}
              </p>
            ) : (
              <>
                {retainedBookings.length > 0 && (
                  <section className="ab-review-records" aria-label="Брони, требующие внимания">
                    <h3>Требуют внимания</h3>
                    <div>
                      {retainedBookings.map((item) => (
                        <BookingRecordCard
                          key={item.id}
                          booking={item}
                          office={office}
                          serverNow={data.serverNow}
                          onOpen={openBooking}
                          admin
                          disabled={busy}
                        />
                      ))}
                    </div>
                  </section>
                )}
                {cancelled.length > 0 && (
                  <details className="ab-cancelled" open>
                    <summary>
                      <History size={14} />
                      Отменённые записи<Badge tone="accent">{cancelled.length}</Badge>
                    </summary>
                    <div className="ab-history-records">
                      {cancelled.map((item) => (
                        <BookingRecordCard
                          key={item.id}
                          booking={item}
                          office={office}
                          serverNow={data.serverNow}
                          onOpen={openBooking}
                          admin
                          disabled={busy}
                        />
                      ))}
                    </div>
                  </details>
                )}
                {retainedBookings.length === 0 && cancelled.length === 0 && (
                  <p className="ab-records-empty">Сохранённых записей для этого этажа и даты нет</p>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}

const styles = String.raw`
.ab-cancelled {
  margin-top: 15px;
  background: #fff;
  border: 1px solid #e2e8f1;
  border-radius: 9px;
  color: #94a2b8;
}
.ab-cancelled > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  padding: 13px 15px;
  cursor: pointer;
}
.ab-cancelled > summary span {
  margin-left: auto;
  padding: 3px 6px;
  border-radius: 5px;
  background: #f2f5fa;
  font-size: 9px;
}
.ab-cancelled > div {
  border-top: 1px solid #edf0f6;
  padding: 4px 15px;
}
.ab-cancelled p {
  display: flex;
  align-items: center;
  gap: 15px;
  font-size: 10px;
  color: #9facc0;
  padding: 9px 0;
  margin: 0;
  line-height: 1.6;
}
.ab-cancelled p b {
  font-weight: 600;
  color: #8e9db4;
}
.ab-cancelled p span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ab-cancelled p time {
  margin-left: auto;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .ab-cancelled p {
    flex-wrap: wrap;
    gap: 5px 12px;
  }
  .ab-cancelled p b {
    width: 100%;
  }
}
.ab-records-button > span {
  min-width: 17px;
  padding: 2px 4px;
  border-radius: 4px;
  background: #edf0fa;
  color: #7b89b8;
  font-size: 9px;
  text-align: center;
}
.ab-records-panel {
  position: absolute;
  right: 76px;
  top: 14px;
  z-index: 16;
  display: flex;
  flex-direction: column;
  width: 360px;
  max-width: calc(100% - 36px);
  max-height: calc(100% - 28px);
  border: 1px solid #e0e7f1;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 40px #40577f24;
  overflow: hidden;
}
.ab-records-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px 11px 16px;
  border-bottom: 1px solid #edf0f6;
  flex-shrink: 0;
}
.ab-records-heading h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
  color: #71839f;
  line-height: 1.5;
}
.ab-records-body {
  min-height: 0;
  overflow: auto;
  padding: 13px;
  scrollbar-width: thin;
  scrollbar-color: #dce3ef transparent;
}
.ab-records-body .ab-review-records {
  margin: 0;
}
.ab-records-body .ab-review-records h3 {
  margin: 0 0 11px;
  color: #8998b2;
  font-size: 10px;
  font-weight: 650;
}
.ab-records-body .ab-review-records > div,
.ab-records-body .ab-history-records {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ab-records-body .ab-cancelled {
  margin: 12px 0 0;
  border: 0;
  background: transparent;
}
.ab-records-body .ab-cancelled:first-child {
  margin-top: 0;
}
.ab-records-body .ab-cancelled > summary {
  padding: 3px 1px 9px;
}
.ab-records-body .ab-cancelled > .ab-history-records {
  border: 0;
  padding: 0;
}
.ab-records-body .ab-saved-record {
  padding: 10px;
}
.ab-records-empty {
  margin: 9px 3px;
  color: #98a5bb;
  font-size: 11px;
  line-height: 1.7;
}
@media (max-width: 720px) {
  .ab-records-panel {
    right: 57px;
    top: 10px;
    max-width: calc(100% - 67px);
    max-height: calc(100% - 20px);
  }
  .ab-records-heading {
    padding: 8px 9px 8px 12px;
  }
  .ab-records-heading h2 {
    font-size: 11px;
  }
  .ab-records-body {
    padding: 10px;
  }
}
.ab-review-records {
  margin-top: 23px;
}
.ab-review-records h2 {
  font-size: 14px;
  color: #7f8fa8;
  margin: 0 0 10px;
}
.ab-review-records > div,
.ab-history-records {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.ab-cancelled .ab-history-records {
  padding: 8px 0 0;
}
`;
