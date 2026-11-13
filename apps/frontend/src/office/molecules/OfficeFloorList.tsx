import { ArrowUpRight, Layers } from 'lucide-react';
import { officePlanPath } from '../lib/routes';
import { objectLabel } from '../lib/officeSettingsModel';
import type { OfficeSettingsController } from '../hooks/useOfficeSettings';
export default function OfficeFloorList({ controller }: { controller: OfficeSettingsController }) {
  const { office } = controller;
  return (
    <section
      className="office-detail-card office-detail-floors"
      aria-labelledby="office-floors-heading"
    >
      <div className="office-detail-card-heading">
        <span className="office-detail-card-icon">
          <Layers size={20} />
        </span>
        <div>
          <h2 id="office-floors-heading">
            Этажи <span>{office.floors.length}</span>
          </h2>
          <p>Планы и объекты пространства</p>
        </div>
        <a href={officePlanPath(office.id)} className="office-detail-plan-link">
          Открыть план
          <ArrowUpRight size={14} />
        </a>
      </div>
      <ul className="office-detail-floor-list">
        {office.floors.map((floor, index) => (
          <li key={floor.id}>
            <span className="office-detail-floor-number">{index + 1}</span>
            <div>
              <b>{floor.name}</b>
              <span>
                {floor.elements.length} {objectLabel(floor.elements.length)}
              </span>
            </div>
            <span
              className={'office-detail-floor-underlay' + (floor.background ? ' has-underlay' : '')}
            >
              {floor.background ? 'План загружен' : 'Без подложки'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
