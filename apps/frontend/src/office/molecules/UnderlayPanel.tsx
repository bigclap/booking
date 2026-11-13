import { Styles } from '../../shared/atoms';
import { CloseButton, Button, Input } from '../../shared/atoms';
import { Eye, EyeOff, ImagePlus, Scan, Upload } from 'lucide-react';
import type { Floor } from '../lib/officeModel';
type Background = NonNullable<Floor['background']>;
interface Props {
  floor: Floor;
  onChange: (patch: Partial<Background>) => void;
  onUpload: () => void;
  onRemove: () => void;
  onClose: () => void;
  onEdit: () => void;
}
export default function UnderlayPanel({
  floor,
  onChange,
  onUpload,
  onRemove,
  onClose,
  onEdit,
}: Props) {
  const background = floor.background;
  return (
    <>
      <section className="underlay-popover" aria-label="Настройки подложки">
        <div className="underlay-panel-heading">
          <ImagePlus size={16} />
          <b>Подложка плана</b>
          <CloseButton
            aria-label="Закрыть настройки подложки"
            onClick={onClose}
            className="underlay-close"
          />
        </div>
        {background ? (
          <>
            <div className="underlay-panel-file" title={background.name}>
              {background.name}
            </div>
            <Button
              className={'underlay-visibility' + (background.visible ? ' is-visible' : '')}
              onClick={() => onChange({ visible: !background.visible })}
              variant="ghost"
              size="sm"
            >
              {background.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              {background.visible ? 'Скрыть подложку' : 'Показать подложку'}
              <span>{background.visible ? 'Видна' : 'Скрыта'}</span>
            </Button>
            <Button
              className="underlay-edit-button"
              disabled={!background.visible}
              onClick={onEdit}
              variant="ghost"
              size="sm"
            >
              <Scan size={16} />
              Редактировать подложку
            </Button>
            <p className="underlay-edit-hint">
              {background.visible
                ? 'Двигайте изображение и тяните за углы на плане. Пропорции сохраняются.'
                : 'Покажите подложку, чтобы изменить её на плане.'}
            </p>
            <label className="underlay-opacity">
              Непрозрачность <span>{Math.round(background.opacity * 100)}%</span>
              <Input
                aria-label="Прозрачность подложки"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={background.opacity}
                onChange={(event) => onChange({ opacity: Number(event.target.value) })}
              />
            </label>
            <div className="underlay-panel-actions">
              <Button onClick={onUpload} variant="ghost" size="sm">
                Заменить изображение
              </Button>
              <Button onClick={onRemove} variant="ghost" size="sm">
                Удалить
              </Button>
            </div>
          </>
        ) : (
          <Button className="upload-underlay" onClick={onUpload} variant="ghost" size="sm">
            <Upload size={20} />
            <span>
              Загрузить изображение<small>PNG, JPEG или WebP</small>
            </span>
          </Button>
        )}
      </section>
      <Styles id="office-underlay">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor .underlay-close {
  margin-left: auto;
}

.office-plan-editor .upload-underlay {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 13px 0 3px;
  color: #7d8da7;
  text-align: left;
}
.office-plan-editor .upload-underlay > span {
  font-size: 9px;
  font-weight: 600;
}
.office-plan-editor .upload-underlay small {
  display: block;
  font-size: 8px;
  color: #a5b0c2;
  margin-top: 4px;
}
@media (max-width: 760px) {
  .office-plan-editor .upload-underlay {
    gap: 5px;
  }
  .office-plan-editor .upload-underlay span {
    font-size: 7px;
  }
  .office-plan-editor .upload-underlay small {
    font-size: 6px;
  }
}
.office-plan-editor .underlay-popover {
  position: absolute;
  z-index: 25;
  top: 75px;
  right: 78px;
  width: 272px;
  padding: 16px;
  border: 1px solid #e0e6ef;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 14px 45px #30456620;
  color: #52647d;
}
.office-plan-editor .underlay-panel-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.office-plan-editor .underlay-panel-file {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #929eb0;
  margin: 9px 0 13px;
}
.office-plan-editor .underlay-visibility {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px;
  border: 1px solid #e1e6ef;
  border-radius: 7px;
  font-size: 11px;
  color: #6f7e95;
  background: #f7f9fc;
}
.office-plan-editor .underlay-visibility.is-visible {
  color: #5d72c4;
  background: #f3f5ff;
  border-color: #e0e5ff;
}
.office-plan-editor .underlay-visibility span {
  margin-left: auto;
  font-size: 9px;
  opacity: 0.7;
}
.office-plan-editor .underlay-opacity {
  display: block;
  font-size: 10px;
  color: #8392a8;
  margin: 17px 0;
}
.office-plan-editor .underlay-opacity span {
  float: right;
  color: #687b97;
}
.office-plan-editor .underlay-opacity input {
  display: block;
  width: 100%;
  margin: 10px 0 0;
  accent-color: #7d8bdf;
}
.office-plan-editor .underlay-panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid #edf0f5;
}
.office-plan-editor .underlay-panel-actions button {
  color: #7888ce;
  font-size: 10px;
  padding: 0;
}
.office-plan-editor .underlay-panel-actions button:last-child {
  color: #a7929a;
}
.office-plan-editor .underlay-popover .upload-underlay {
  margin-top: 15px;
}

.office-plan-editor .underlay-edit-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px;
  margin-top: 12px;
  color: #fff;
  background: #7c8bdd;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 600;
}
.office-plan-editor .underlay-edit-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.office-plan-editor .underlay-edit-hint {
  margin: 9px 1px 0;
  color: #94a0b4;
  font-size: 10px;
  line-height: 1.6;
}
.office-plan-editor .underlay-opacity .ui-input {
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}
`;
