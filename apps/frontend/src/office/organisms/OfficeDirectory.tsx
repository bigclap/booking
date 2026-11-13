import type { ReactElement } from 'react';
import { Styles, Button, Badge } from '../../shared/atoms';
import { PageHeading, SearchField } from '../../shared/molecules';
import { Plus, Search } from 'lucide-react';
import LegacyOfficeImport from '../molecules/LegacyOfficeImport';
import OfficeCard from '../molecules/OfficeCard';
import type { OfficeDirectoryController } from '../hooks/useOfficeDirectory';
export default function OfficeDirectory({
  controller,
}: {
  controller: OfficeDirectoryController;
}): ReactElement {
  const { offices, setCreate, query, setQuery, filtered } = controller;
  return (
    <>
      <section className="adm-content office-directory">
        <PageHeading
          className="office-directory-heading"
          eyebrow="УПРАВЛЕНИЕ ПРОСТРАНСТВОМ"
          title={
            <>
              Офисы <Badge className="office-directory-count">{offices.length}</Badge>
            </>
          }
          description="Настройки, планы этажей и бронирования каждого офиса."
          actions={
            <Button onClick={() => setCreate(true)} variant="primary" size="sm">
              <Plus size={17} />
              Добавить офис
            </Button>
          }
        />
        <LegacyOfficeImport />
        <div className="office-list-toolbar">
          <SearchField
            className="office-directory-search"
            aria-label="Поиск офисов"
            placeholder="Найти по названию или адресу"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="office-list-count">
            {offices.length}{' '}
            {offices.length === 1 ? 'офис' : offices.length < 5 ? 'офиса' : 'офисов'}
          </span>
        </div>
        <div className="office-cards">
          {filtered.map((item) => (
            <OfficeCard key={item.id} office={item} />
          ))}
          {filtered.length === 0 && (
            <div className="office-list-empty">
              <Search size={28} />
              <p>Офисов с таким названием или адресом нет.</p>
            </div>
          )}
        </div>
        <p className="office-directory-note">
          Доступ сотрудников к офисам назначается в разделе «Пользователи».
        </p>
      </section>
      <Styles id="office-directory">{styles}</Styles>
    </>
  );
}
const styles = String.raw`
.office-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 20px;
}
.office-list-empty {
  padding: 60px 20px;
  text-align: center;
  font-size: 12px;
  color: #a1aabd;
  grid-column: 1/-1;
}
@media (max-width: 1000px) {
  .office-cards {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
}
@media (max-width: 760px) {
  .office-cards {
    grid-template-columns: 1fr;
  }
}

.office-list-toolbar {
  margin-bottom: 24px;
  border: 1px solid #e7ebf3;
  background: white;
  border-radius: 11px;
}
.office-list-count {
  font-size: 10px;
  color: #a0aabd;
}

.office-directory {
  min-width: 0;
}
.office-directory-heading h1 {
  display: flex;
  align-items: center;
  gap: 12px;
}
.office-directory-count {
  font-size: 12px;
  min-width: 29px;
  height: 25px;
  letter-spacing: 0;
}
.office-list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px;
}
.office-directory-search {
  max-width: 380px;
  flex: 1;
  height: 39px;
}
.office-directory-note {
  font-size: 9px;
  line-height: 1.7;
  color: #a7b1c2;
  margin-top: 16px;
}
@media (max-width: 1200px) {
  .office-list-toolbar {
    padding: 16px;
    gap: 12px;
  }
}
@media (max-width: 760px) {
  .office-list-toolbar {
    padding: 13px;
    gap: 9px;
  }
  .office-directory-note {
    font-size: 8px;
  }
}
@media (max-width: 570px) {
  .office-list-toolbar {
    flex-wrap: wrap;
  }
  .office-directory-search {
    max-width: none;
    flex-basis: 100%;
  }
}
`;
