import { Styles } from '../../shared/atoms';
import { Spinner } from '../../shared/atoms';
import { CheckCircle2 } from 'lucide-react';
import type { AccessOperation } from '../../shared/api';
export function AccessOperationReceipt({
  operation,
  name,
}: {
  operation: AccessOperation;
  name?: string;
}) {
  const completed = operation.status === 'completed';
  return (
    <>
      <Styles id="access-operation-receipt">{styles}</Styles>
      <div className={`adm-access-receipt${completed ? ' is-completed' : ''}`}>
        <span className="adm-access-receipt-icon">
          {completed ? <CheckCircle2 size={17} /> : <Spinner size={17} />}
        </span>
        <div>
          {name && <span className="adm-access-receipt-name">{name}</span>}
          <b>{completed ? 'Отзыв доступа завершён' : 'Отзыв доступа выполняется'}</b>
          {completed ? (
            <p>
              Будущих броней отменено: {operation.cancelled_count}. Текущих завершено:{' '}
              {operation.terminated_count}.
            </p>
          ) : (
            <p>
              {operation.publication?.last_error
                ? 'Обработка задерживается. Продолжаем проверять состояние.'
                : 'Права обновлены. Освобождение броней выполняется в фоне.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

const styles = String.raw`
.adm-access-receipt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid #e9e6f8;
  background: #faf9ff;
  border-radius: 9px;
  padding: 12px;
  min-width: 0;
  color: #8a86bd;
}
.adm-access-receipt.is-completed {
  border-color: #e1ede6;
  background: #f8fbf9;
  color: #88a694;
}
.adm-access-receipt-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.adm-access-receipt > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.adm-access-receipt-name {
  display: block;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.6;
  color: #687b95;
  margin-bottom: 3px;
}
.adm-access-receipt b {
  display: block;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.6;
}
.adm-access-receipt p {
  font-size: 9px;
  line-height: 1.8;
  color: #97a3b6;
  margin: 3px 0 0;
}
@media (max-width: 570px) {
  .adm-access-receipt {
    padding: 10px;
    gap: 8px;
  }
}
`;
