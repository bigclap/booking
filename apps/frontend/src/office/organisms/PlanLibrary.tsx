import { Styles } from '../../shared/atoms';
import { IconButton, Button } from '../../shared/atoms';
import { SearchField } from '../../shared/molecules';
import {
  Armchair,
  HelpCircle,
  ImagePlus,
  LockKeyhole,
  Search,
  Settings2,
  SquareDashed,
  BrickWall,
  Building2,
} from 'lucide-react';
import { CATALOG, CATEGORY_LABELS } from '../lib/catalog';
import type { CatalogCategory } from '../lib/catalog';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
export default function PlanLibrary({ editor }: { editor: OfficePlanEditor }) {
  const {
    office,
    floor,
    selectedId,
    setSelectedId,
    tool,
    setTool,
    tab,
    setTab,
    category,
    setCategory,
    search,
    setSearch,
    setPreview,
    setUnderlayOpen,
    setHelp,
    searchRef,
    filtered,
    list,
  } = editor;
  return (
    <>
      <aside className="library-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ПРОСТРАНСТВО</span>
            <h1>Конструктор</h1>
          </div>
          <IconButton
            title="Горячие клавиши"
            aria-label="Горячие клавиши"
            onClick={() => setHelp(true)}
            variant="ghost"
            size="sm"
          >
            <HelpCircle size={16} />
          </IconButton>
        </div>
        <div className="office-caption">
          <Building2 size={14} />
          <span>{office.name}</span>
        </div>
        <div className="library-tabs">
          <Button
            className={tab === 'catalog' ? 'active' : ''}
            onClick={() => setTab('catalog')}
            variant="ghost"
            size="sm"
          >
            Каталог
          </Button>
          <Button
            className={tab === 'layers' ? 'active' : ''}
            onClick={() => setTab('layers')}
            variant="ghost"
            size="sm"
          >
            Объекты <span>{floor.elements.length}</span>
          </Button>
        </div>
        <SearchField
          ref={searchRef}
          className="office-library-search"
          aria-label="Поиск объектов"
          placeholder="Найти объект…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          trailing={<kbd>⌘ K</kbd>}
        />
        {tab === 'catalog' ? (
          <>
            <div className="section-title">СОЗДАТЬ НА ПЛАНЕ</div>
            <div className="draft-tools">
              <Button
                className={tool === 'wall' ? 'active' : ''}
                onClick={() => {
                  setPreview(false);
                  setTool('wall');
                }}
                variant="ghost"
                size="sm"
              >
                <BrickWall size={20} />
                <span>Стена</span>
                <kbd>W</kbd>
              </Button>
              <Button
                className={tool === 'room' ? 'active' : ''}
                onClick={() => {
                  setPreview(false);
                  setSelectedId(null);
                  setTool('room');
                }}
                variant="ghost"
                size="sm"
              >
                <SquareDashed size={20} />
                <span>Помещение</span>
                <kbd>R</kbd>
              </Button>
            </div>
            <div className="section-title">
              МЕБЕЛЬ И ОСНАЩЕНИЕ <span>{CATALOG.length}</span>
            </div>
            <div className="category-chips">
              <Button
                className={category === 'all' ? 'active' : ''}
                onClick={() => setCategory('all')}
                variant="ghost"
                size="sm"
              >
                Всё
              </Button>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <Button
                  key={key}
                  className={category === key ? 'active' : ''}
                  onClick={() => setCategory(key as CatalogCategory)}
                  variant="ghost"
                  size="sm"
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="asset-grid">
              {filtered.map((item) => (
                <Button
                  key={item.type}
                  className={'asset-card' + (tool === 'asset:' + item.type ? ' active' : '')}
                  title={'Разместить: ' + item.name}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-office-asset', item.type);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => {
                    setPreview(false);
                    setTool('asset:' + item.type);
                  }}
                  variant="ghost"
                  size="sm"
                >
                  <div className="asset-picture">
                    <img src={item.asset} alt="" draggable={false} />
                    {item.seats > 1 && <small>{item.seats} места</small>}
                  </div>
                  <span>{item.name}</span>
                </Button>
              ))}
            </div>
            {!filtered.length && (
              <div className="catalog-empty">
                <Search size={22} />
                <p>Такого объекта пока нет</p>
                <Button
                  onClick={() => {
                    setSearch('');
                    setCategory('all');
                  }}
                  variant="ghost"
                  size="sm"
                >
                  Сбросить поиск
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="object-list">
            {list.map((item) => (
              <Button
                key={item.id}
                className={'object-row' + (selectedId === item.id ? ' active' : '')}
                onClick={() => {
                  setSelectedId(item.id);
                  setTool('select');
                  setPreview(false);
                }}
                variant="ghost"
                size="sm"
              >
                <span>
                  {item.kind === 'room' ? (
                    <SquareDashed size={16} />
                  ) : item.kind === 'wall' ? (
                    <BrickWall size={16} />
                  ) : (
                    <Armchair size={16} />
                  )}
                </span>
                <div>
                  <b>{item.name}</b>
                  <small>
                    {item.kind === 'room'
                      ? 'Помещение'
                      : item.kind === 'desk'
                        ? 'Рабочее место'
                        : item.kind === 'wall'
                          ? 'Стена'
                          : 'Оснащение'}
                  </small>
                </div>
                {item.locked && <LockKeyhole size={12} />}
              </Button>
            ))}
          </div>
        )}
        <Button
          className="underlay-shortcut"
          onClick={() => setUnderlayOpen(true)}
          variant="ghost"
          size="sm"
        >
          <ImagePlus size={16} />
          <span>
            Подложка плана
            <small>{floor.background ? floor.background.name : 'Загрузить изображение'}</small>
          </span>
          <Settings2 size={14} />
        </Button>
      </aside>
      <Styles id="office-library">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-library-search {
  flex-shrink: 0;
}
.office-library-search > kbd {
  font-size: 8px;
  white-space: nowrap;
  background: #f4f6fa;
  border: 1px solid #e7ecf3;
  border-radius: 4px;
  padding: 2px 3px;
  color: #a4b0c3;
}

.office-plan-editor .library-panel {
  width: 258px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e7eaf1;
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
.office-plan-editor .panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.office-plan-editor .eyebrow {
  font-size: 9px;
  letter-spacing: 1.5px;
  font-weight: 800;
  color: #99a2b4;
}
.office-plan-editor .panel-heading h1 {
  font-size: 20px;
  letter-spacing: -0.7px;
  margin: 5px 0 24px;
}
.office-plan-editor .section-title {
  font-size: 9px;
  font-weight: 800;
  color: #939eb1;
  letter-spacing: 1px;
  margin: 24px 0 12px;
}
.office-plan-editor .draft-tools {
  display: flex;
  gap: 8px;
}
.office-plan-editor .draft-tools button {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10px;
  background: #f7f8fb;
  border: 1px solid #e9ecf3;
  border-radius: 8px;
  padding: 11px 8px;
  flex: 1;
}
.office-plan-editor .draft-tools span {
  color: #8a94aa;
  font-size: 20px;
}
@media (max-width: 1100px) {
  .office-plan-editor .library-panel {
    width: 220px;
  }
}
@media (max-width: 850px) {
  .office-plan-editor .library-panel {
    width: 200px;
  }
}
.office-plan-editor .library-panel {
  padding: 23px 16px 15px;
  gap: 0;
  scrollbar-width: thin;
  scrollbar-color: #dfe4ee transparent;
}
.office-plan-editor .panel-heading h1 {
  margin-bottom: 20px;
}
.office-plan-editor .library-tabs {
  display: flex;
  border-bottom: 1px solid #e9edf4;
  margin: 0 -1px 15px;
  gap: 22px;
}
.office-plan-editor .library-tabs button {
  padding: 0 1px 10px;
  font-size: 11px;
  color: #99a4b6;
  border-bottom: 2px solid transparent;
}
.office-plan-editor .library-tabs button.active {
  color: #5266db;
  border-bottom-color: #6376e5;
  font-weight: 800;
}
.office-plan-editor .library-tabs span {
  font-size: 8px;
  padding: 1px 4px;
  border-radius: 4px;
  background: #f0f2f7;
  color: #9aa5b7;
  margin-left: 3px;
}
.office-plan-editor .section-title {
  margin: 21px 0 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 8px;
  letter-spacing: 1.2px;
}
.office-plan-editor .section-title > span {
  font-size: 9px;
  letter-spacing: 0;
  font-weight: 600;
  color: #bdc5d3;
}
.office-plan-editor .draft-tools {
  gap: 7px;
}
.office-plan-editor .draft-tools button {
  position: relative;
  padding: 10px 9px;
  gap: 7px;
  font-size: 9px;
  height: 44px;
  transition: 0.15s;
  background: #fafbfe;
}
.office-plan-editor .draft-tools button svg {
  color: #9aa7bc;
  flex-shrink: 0;
  width: 17px;
}
.office-plan-editor .draft-tools button span {
  font-size: 9px;
  color: #6f7d94;
}
.office-plan-editor .draft-tools button kbd {
  font-size: 7px;
  color: #b3bece;
  margin-left: auto;
}
.office-plan-editor .draft-tools button.active {
  background: #eef1ff;
  border-color: #a6b4f0;
  color: #5367d7;
}
.office-plan-editor .category-chips {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 13px;
}
.office-plan-editor .category-chips button {
  padding: 5px 8px;
  font-size: 8px;
  border-radius: 5px;
  color: #939eb2;
  background: #f4f6fa;
  border: 1px solid transparent;
}
.office-plan-editor .category-chips button.active {
  background: #edf0ff;
  color: #6173da;
  border-color: #dfe5fc;
}
.office-plan-editor .asset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.office-plan-editor .asset-card {
  border: 1px solid #e8ecf4;
  border-radius: 9px;
  background: linear-gradient(135deg, #fff, #f8f9fc);
  padding: 8px 6px 10px;
  min-width: 0;
  transition:
    transform 0.15s,
    border-color 0.15s,
    background 0.15s;
  cursor: grab;
}
.office-plan-editor .asset-card:hover {
  border-color: #acbaed;
  background: #f5f7ff;
  transform: translateY(-2px);
}
.office-plan-editor .asset-card.active {
  border-color: #7e91e8;
  background: #f0f3ff;
  box-shadow: 0 0 0 2px #edf1ff;
}
.office-plan-editor .asset-card > span {
  font-size: 8px;
  display: block;
  line-height: 1.5;
  min-height: 12px;
  color: #65738b;
  font-weight: 650;
}
.office-plan-editor .asset-picture {
  height: 65px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin-bottom: 5px;
}
.office-plan-editor .asset-picture img {
  max-width: 78px;
  max-height: 58px;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 4px 3px #53678110);
  pointer-events: none;
}
.office-plan-editor .asset-picture small {
  position: absolute;
  right: 0;
  top: 0;
  background: #f0f2f8;
  color: #9aa6ba;
  font-size: 6px;
  padding: 2px 4px;
  border-radius: 3px;
}
.office-plan-editor .catalog-empty {
  display: grid;
  place-items: center;
  color: #9eabc0;
  margin: 35px 0;
  font-size: 11px;
}
.office-plan-editor .catalog-empty button {
  color: #6b7de0;
  font-size: 10px;
}
.office-plan-editor .object-list {
  margin-top: 15px;
}
.office-plan-editor .object-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  text-align: left;
  border-radius: 7px;
  padding: 10px 8px;
  margin-bottom: 4px;
}
.office-plan-editor .object-row:hover {
  background: #f6f8fc;
}
.office-plan-editor .object-row.active {
  background: #eef2ff;
}
.office-plan-editor .object-row > span {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  color: #9ba9be;
  background: #f1f4f9;
  border-radius: 6px;
}
.office-plan-editor .object-row div {
  display: grid;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.office-plan-editor .object-row b {
  font-size: 10px;
  font-weight: 650;
  color: #687992;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.office-plan-editor .object-row small {
  font-size: 8px;
  color: #a8b1c2;
}
.office-plan-editor .object-row > svg {
  color: #a9b5c6;
}
@media (min-width: 1500px) {
  .office-plan-editor .library-panel {
    width: 275px;
  }
  .office-plan-editor .asset-picture {
    height: 78px;
  }
  .office-plan-editor .asset-picture img {
    max-width: 90px;
    max-height: 65px;
  }
  .office-plan-editor .asset-card > span {
    font-size: 9px;
  }
}
@media (max-width: 1200px) {
  .office-plan-editor .library-panel {
    width: 225px;
    padding-left: 13px;
    padding-right: 13px;
  }
  .office-plan-editor .asset-picture {
    height: 59px;
  }
  .office-plan-editor .category-chips button {
    padding: 5px 7px;
  }
}
@media (max-width: 950px) {
  .office-plan-editor .library-panel {
    width: 200px;
  }
  .office-plan-editor .category-chips {
    gap: 4px;
  }
  .office-plan-editor .asset-card > span {
    font-size: 7px;
  }
  .office-plan-editor .draft-tools button {
    padding: 8px 6px;
    gap: 4px;
  }
  .office-plan-editor .draft-tools button kbd {
    display: none;
  }
}
@media (max-width: 760px) {
  .office-plan-editor .library-panel {
    width: 166px;
    padding: 16px 10px;
  }
  .office-plan-editor .panel-heading h1 {
    font-size: 16px;
  }
  .office-plan-editor .eyebrow {
    font-size: 7px;
  }
  .office-plan-editor .category-chips button {
    font-size: 7px;
    padding: 4px 5px;
  }
  .office-plan-editor .asset-grid {
    gap: 6px;
  }
  .office-plan-editor .asset-picture {
    height: 49px;
  }
  .office-plan-editor .asset-picture img {
    max-width: 60px;
    max-height: 44px;
  }
  .office-plan-editor .asset-picture small {
    display: none;
  }
  .office-plan-editor .asset-card > span {
    font-size: 7px;
  }
}
.office-plan-editor .asset-card > span {
  font-size: 10px;
  color: #586d89;
}
.office-plan-editor .section-title {
  color: #8090a9;
  font-size: 9px;
}
.office-plan-editor .asset-picture small {
  font-size: 7px;
}
.office-plan-editor .library-tabs button {
  font-size: 12px;
}
.office-plan-editor .category-chips button {
  font-size: 9px;
}
.office-plan-editor .office-caption {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8a9ab0;
  font-size: 10px;
  margin: -6px 0 20px;
  min-width: 0;
}
.office-plan-editor .office-caption svg {
  color: #a0aec4;
  flex-shrink: 0;
}
.office-plan-editor .office-caption span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .office-plan-editor .office-caption {
    font-size: 8px;
    margin-bottom: 17px;
  }
}
.office-plan-editor .underlay-shortcut {
  margin-top: 23px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 9px;
  text-align: left;
  border: 1px dashed #dfe5ef;
  border-radius: 9px;
  background: #fbfcff;
  color: #7183a0;
  flex-shrink: 0;
}
.office-plan-editor .underlay-shortcut span {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 650;
}
.office-plan-editor .underlay-shortcut small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 400;
  color: #96a2b5;
}
`;
