import { Button } from '../../shared/atoms';
import { Notice } from '../../shared/molecules';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
export default function PlanRecoveryNotice({ editor }: { editor: OfficePlanEditor }) {
  const { office, recovery, saveError, draftWarning, saveConflict, resolveRecovery, setSaveTick } =
    editor;
  if (!recovery && !saveError && !draftWarning) return null;
  const recoveryMessage =
    recovery?.error ||
    (recovery?.draft?.baseRevision !== undefined && recovery.draft.baseRevision !== office.revision
      ? 'Серверный план изменился после создания черновика. Восстановление заменит его этажи локальной версией — сначала сравните планы.'
      : 'Есть несохранённый локальный черновик этого плана. Восстановить его поверх серверной версии?');
  return (
    <Notice
      className="recovery-banner"
      role="alert"
      tone={saveError ? 'error' : 'warning'}
      actions={
        <>
          {recovery ? (
            <>
              {recovery.draft && (
                <Button size="sm" onClick={() => resolveRecovery(true)}>
                  Восстановить черновик
                </Button>
              )}
              <Button size="sm" onClick={() => resolveRecovery(false)}>
                Отбросить черновик
              </Button>
            </>
          ) : (
            saveError &&
            (saveConflict ? (
              <Button size="sm" onClick={() => window.location.reload()}>
                Открыть актуальный план
              </Button>
            ) : (
              <Button size="sm" onClick={() => setSaveTick((value) => value + 1)}>
                Повторить сохранение
              </Button>
            ))
          )}
        </>
      }
    >
      {recovery ? (
        recoveryMessage
      ) : (
        <>
          {saveError && <span>{saveError}</span>}
          {draftWarning && <span>{draftWarning}</span>}
        </>
      )}
      {saveError && recovery && <span>{saveError}</span>}
    </Notice>
  );
}
