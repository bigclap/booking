import { useEffect, useState } from 'react';
import { ArrowUpRight, Building2, Grid2X2, Layers, MapPin, Plus, Search } from 'lucide-react';
import AdminShell from './AdminShell';
import { useOffices } from '../offices/OfficeProvider';
import { CreateOfficeDialog } from '../offices/OfficeSwitcher';
import { getResources } from '../client/bookingModel';
import LegacyOfficeImport from '../offices/LegacyOfficeImport';
import { officePath } from './routes';
import '../offices/offices.css';

export default function OfficesPage() {
  const { offices } = useOffices();
  const [create, setCreate] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    document.title = 'Офисы — Администрирование';
  }, []);
  const filtered = offices.filter((item) =>
    `${item.name} ${item.address || ''}`
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  return (
    <AdminShell
      section="offices"
      overlays={
        create && (
          <CreateOfficeDialog
            onClose={() => setCreate(false)}
            onCreated={(office) => window.location.assign(officePath(office.id))}
          />
        )
      }
    >
      <div className="adm-content">
        <div className="adm-page-heading">
          <div>
            <span className="adm-eyebrow">УПРАВЛЕНИЕ ПРОСТРАНСТВОМ</span>
            <h1>
              Офисы <span>{offices.length}</span>
            </h1>
            <p>Настройки, планы этажей и бронирования каждого офиса.</p>
          </div>
          <button className="adm-primary" onClick={() => setCreate(true)}>
            <Plus size={17} />
            Добавить офис
          </button>
        </div>
        <LegacyOfficeImport />
        <div className="adm-list-toolbar office-list-toolbar">
          <label className="adm-search">
            <Search size={17} />
            <input
              aria-label="Поиск офисов"
              placeholder="Найти по названию или адресу"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="office-list-count">
            {offices.length}{' '}
            {offices.length === 1 ? 'офис' : offices.length < 5 ? 'офиса' : 'офисов'}
          </span>
        </div>
        <div className="office-cards">
          {filtered.map((item) => {
            const resources = item.floors.reduce(
              (count, floor) => count + getResources(floor).length,
              0,
            );
            return (
              <article className="office-card" key={item.id}>
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
                    {item.floors.length === 1
                      ? 'этаж'
                      : item.floors.length < 5
                        ? 'этажа'
                        : 'этажей'}
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
            );
          })}
          {filtered.length === 0 && (
            <div className="office-list-empty">
              <Search size={28} />
              <p>Офисов с таким названием или адресом нет.</p>
            </div>
          )}
        </div>
        <p className="adm-local-note">
          Доступ сотрудников к офисам назначается в разделе «Пользователи».
        </p>
      </div>
    </AdminShell>
  );
}
