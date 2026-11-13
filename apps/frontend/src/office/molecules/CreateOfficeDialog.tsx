import { Building2, Plus } from 'lucide-react';
import { Button, Input, Styles } from '../../shared/atoms';
import { Dialog, Field, Notice } from '../../shared/molecules';
import { useCreateOffice } from '../hooks/useCreateOffice';
import type { CreateOfficeOptions } from '../hooks/useCreateOffice';

export default function CreateOfficeDialog(options: CreateOfficeOptions) {
  const form = useCreateOffice(options);
  return (
    <>
      <Dialog
        open
        onClose={form.onClose}
        busy={form.busy}
        title="Новый офис"
        eyebrow="ПРОСТРАНСТВО"
        closeLabel="Закрыть создание офиса"
        className="office-create-dialog"
        bodyClassName="office-create-scroll"
        footer={
          <>
            <Button onClick={form.onClose} disabled={form.busy}>
              Отмена
            </Button>
            <Button form={form.formId} type="submit" variant="primary" disabled={form.busy}>
              <Plus size={16} />
              {form.busy
                ? form.created
                  ? 'Открываем…'
                  : 'Создаём…'
                : form.created
                  ? 'Открыть офис'
                  : 'Создать офис'}
            </Button>
          </>
        }
      >
        <p>Добавьте здание, затем соберите его план.</p>
        <form id={form.formId} onSubmit={form.submit}>
          <Field label="Название офиса" className="office-create-field">
            <Input
              value={form.name}
              onChange={(event) => form.setName(event.target.value)}
              required
              maxLength={80}
              placeholder="Например, Офис на Невском"
              disabled={form.busy || !!form.created}
              autoFocus
            />
          </Field>
          <Field label="Адрес" hint="Необязательно" className="office-create-field">
            <Input
              value={form.address}
              onChange={(event) => form.setAddress(event.target.value)}
              maxLength={160}
              placeholder="Город, улица, дом"
              disabled={form.busy || !!form.created}
            />
          </Field>
          <Notice className="office-create-note">
            <Building2 size={16} />
            Один пустой этаж для начала. Рабочие часы задаются в настройках офиса, план — в
            конструкторе.
          </Notice>
          {form.created && form.error && (
            <Notice>Офис уже создан. Повторное нажатие откроет его.</Notice>
          )}
          {form.error && <Notice tone="error">{form.error}</Notice>}
        </form>
      </Dialog>
      <Styles id="office-create-dialog">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-create-dialog .office-create-scroll > p {
  font-size: 11px;
  color: #99a4b9;
  line-height: 1.7;
  margin: 0 0 24px;
}
.office-create-field {
  margin-bottom: 16px;
}
.office-create-dialog .office-create-note {
  margin: 20px 0 16px;
}
.office-create-note .ui-notice-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.office-create-note .ui-notice-content > svg {
  flex-shrink: 0;
  margin-top: 2px;
}
`;
