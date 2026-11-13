import type { ReactElement } from 'react';
import { Styles } from '../../shared/atoms';
import { ArrowUpRight, Building2, Grid2X2, Layers, MapPin } from 'lucide-react';
import { getResources } from '../../booking';
import { officePath } from '../lib/routes';
import type { OfficeConfig } from '../lib/officeModel';
export default function OfficeCard({ office: item }: { office: OfficeConfig }): ReactElement {
  const resources = item.floors.reduce((count, floor) => count + getResources(floor).length, 0);
  return (
    <>
      <article className="office-card">
        <div className="office-card-top">
          <span className="office-card-logo">
            <Building2 size={23} />
          </span>
        </div>
        <h2>
          <a href={officePath(item.id)}>{item.name}</a>
        </h2>
        <div className="office-card-address">
          <MapPin size={13} />
          {item.address || 'Адрес не указан'}
        </div>
        <div className="office-card-stats">
          <span>
            <Layers size={14} />
            {item.floors.length}{' '}
            {item.floors.length === 1 ? 'этаж' : item.floors.length < 5 ? 'этажа' : 'этажей'}
          </span>
          <span>
            <Grid2X2 size={14} />
            {resources} для бронирования
          </span>
        </div>
        <div className="office-card-actions">
          <a className="office-open-link" href={officePath(item.id)}>
            Открыть офис
            <ArrowUpRight size={14} />
          </a>
        </div>
      </article>
      <Styles id="office-card">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-card {
  border: 1px solid #e2e7f1;
  background: white;
  border-radius: 13px;
  padding: 24px;
  box-shadow: 0 3px 6px #45567503;
  min-width: 0;
}
.office-card.is-selected {
  border-color: #b5bce8;
  box-shadow: 0 0 0 1px #b5bce815;
}
.office-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 19px;
}
.office-card-logo {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  background: #f0f3fc;
  color: #8996c6;
  border-radius: 12px;
}
.office-card-selected {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  color: #8b94cb;
  background: #f1f3fd;
  border-radius: 5px;
  padding: 5px 7px;
}
.office-card h2 {
  font-size: 17px;
  letter-spacing: -0.4px;
  color: #596981;
  margin: 0 0 10px;
  overflow-wrap: anywhere;
}
.office-card-address {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  line-height: 1.7;
  color: #a0aabd;
  min-height: 18px;
  overflow-wrap: anywhere;
}
.office-card-address svg {
  flex-shrink: 0;
}
.office-card-stats {
  display: flex;
  gap: 18px;
  margin: 22px 0 24px;
  font-size: 10px;
  color: #96a2b8;
}
.office-card-stats > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.office-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  border-top: 1px solid #edf0f6;
  padding-top: 17px;
}
.office-card-actions > a,
.office-card-actions > button:last-child {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  text-decoration: none;
  color: #8793c7;
}
@media (max-width: 760px) {
  .office-card {
    padding: 21px;
  }
  .office-card-actions {
    gap: 8px;
  }
}
.office-cards .office-card-actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
`;
