import { Eye, EyeOff, ImagePlus, Scan, Upload, X } from 'lucide-react';
import type { Floor } from './model';

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
    <section className="underlay-popover" aria-label="Настройки подложки">
      <div className="underlay-panel-heading">
        <ImagePlus size={16} />
        <b>Подложка плана</b>
        <button className="icon-button" aria-label="Закрыть настройки подложки" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {background ? (
        <>
          <div className="underlay-panel-file" title={background.name}>
            {background.name}
          </div>
          <button
            className={'underlay-visibility' + (background.visible ? ' is-visible' : '')}
            onClick={() => onChange({ visible: !background.visible })}
          >
            {background.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            {background.visible ? 'Скрыть подложку' : 'Показать подложку'}
            <span>{background.visible ? 'Видна' : 'Скрыта'}</span>
          </button>
          <button className="underlay-edit-button" disabled={!background.visible} onClick={onEdit}>
            <Scan size={16} />
            Редактировать подложку
          </button>
          <p className="underlay-edit-hint">
            {background.visible
              ? 'Двигайте изображение и тяните за углы на плане. Пропорции сохраняются.'
              : 'Покажите подложку, чтобы изменить её на плане.'}
          </p>
          <label className="underlay-opacity">
            Непрозрачность <span>{Math.round(background.opacity * 100)}%</span>
            <input
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
            <button onClick={onUpload}>Заменить изображение</button>
            <button onClick={onRemove}>Удалить</button>
          </div>
        </>
      ) : (
        <button className="upload-underlay" onClick={onUpload}>
          <Upload size={20} />
          <span>
            Загрузить изображение<small>PNG, JPEG или WebP</small>
          </span>
        </button>
      )}
    </section>
  );
}
