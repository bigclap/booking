import { Styles, Button } from '../../shared/atoms';
import { Download, LoaderCircle } from 'lucide-react';
import { useLegacyOfficeImport } from '../hooks/useLegacyOfficeImport';
export default function LegacyOfficeImport() {
  const { visible, remaining, busyId, archiveError, error, transfer } = useLegacyOfficeImport();
  if (!visible) return null;
  return (
    <>
      <section className="office-legacy-import" aria-label="Сохранённые планы браузера">
        <div>
          <Download size={18} />
          <b>Сохранённые планы этого браузера</b>
        </div>
        <p>
          Перенесите план на сервер. Исходная копия, старые пользователи и брони останутся в
          браузерном архиве.
        </p>
        {remaining.map((item) => (
          <div className="office-legacy-row" key={item.id}>
            <span>
              <b>{item.name}</b>
              <small>{item.floors.length} этажей</small>
            </span>
            <Button
              type="button"
              disabled={busyId !== null}
              onClick={() => void transfer(item)}
              variant="secondary"
              size="sm"
            >
              {busyId === item.id ? (
                <LoaderCircle size={14} className="office-import-spinner" />
              ) : (
                <Download size={14} />
              )}
              Перенести на сервер
            </Button>
          </div>
        ))}
        {(archiveError || error) && (
          <p role="alert" className="office-legacy-error">
            {archiveError || error}
          </p>
        )}
      </section>
      <Styles id="office-legacy">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-import-spinner {
  animation: office-import-spin 1s linear infinite;
}
@keyframes office-import-spin {
  to {
    transform: rotate(360deg);
  }
}

.office-legacy-import {
  padding: 18px;
  border: 1px solid #dce4f6;
  border-radius: 12px;
  background: #f4f7ff;
  margin-bottom: 22px;
}
.office-legacy-import > div:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #61769e;
}
.office-legacy-import > p {
  font-size: 11px;
  line-height: 1.7;
  color: #8190aa;
  margin: 8px 0 12px;
}
.office-legacy-row {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
  padding: 10px 0;
  border-top: 1px solid #e1e7f3;
}
.office-legacy-row > span {
  display: flex;
  gap: 5px;
  flex-direction: column;
  min-width: 0;
}
.office-legacy-row b {
  font-size: 12px;
  color: #627493;
  overflow-wrap: anywhere;
}
.office-legacy-row small {
  font-size: 10px;
  color: #8b9bb3;
}
.office-legacy-row button {
  flex-shrink: 0;
}
.office-legacy-import .office-legacy-error {
  color: #b2545b;
  margin-bottom: 0;
}
@media (max-width: 570px) {
  .office-legacy-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .office-legacy-row button {
    width: 100%;
    justify-content: center;
  }
}
`;
