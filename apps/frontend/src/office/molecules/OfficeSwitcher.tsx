import { Styles } from '../../shared/atoms';
import { Button } from '../../shared/atoms';
import { SearchField } from '../../shared/molecules';
import { Building2, Check, ChevronDown, MapPin } from 'lucide-react';
import { useOfficeSwitcher } from '../hooks/useOfficeSwitcher';
export { default as CreateOfficeDialog } from './CreateOfficeDialog';
export default function OfficeSwitcher({ beforeChange }: { beforeChange?: () => void }) {
  const {
    accessibleOffices,
    office,
    ready,
    catalogError,
    open,
    query,
    setQuery,
    error,
    retrying,
    root,
    trigger,
    menu,
    filtered,
    toggle,
    choose,
    retry,
  } = useOfficeSwitcher(beforeChange);
  return (
    <>
      <>
        <div ref={root} className="office-switcher">
          <Button
            ref={trigger}
            className="office-switcher-trigger"
            aria-label={'Выбрать офис: ' + (office?.name || 'Не выбран')}
            aria-expanded={open}
            aria-controls={menu}
            disabled={!ready}
            onClick={toggle}
            variant="ghost"
            size="sm"
          >
            <Building2 size={15} />
            <span>{!ready ? 'Загрузка офисов…' : office?.name || 'Выбрать офис'}</span>
            <ChevronDown size={13} />
          </Button>
          {open && (
            <div id={menu} className="office-picker" aria-label="Выбор офиса">
              <div className="office-picker-heading">
                ВАШИ ОФИСЫ <span>{accessibleOffices.length}</span>
              </div>
              {accessibleOffices.length > 4 && (
                <SearchField
                  className="office-picker-search"
                  aria-label="Поиск офиса"
                  placeholder="Название или адрес"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
              <div className="office-picker-list">
                {filtered.map((item) => (
                  <Button
                    key={item.id}
                    className={
                      'office-picker-option' + (item.id === office?.id ? ' is-selected' : '')
                    }
                    aria-pressed={item.id === office?.id}
                    onClick={() => choose(item.id)}
                    variant="ghost"
                    size="sm"
                  >
                    <span className="office-picker-icon">
                      <Building2 size={18} />
                    </span>
                    <span>
                      <b>{item.name}</b>
                      <small>
                        {item.address ? (
                          <>
                            <MapPin size={10} />
                            {item.address}
                          </>
                        ) : (
                          `${item.floors.length} ${item.floors.length === 1 ? 'этаж' : item.floors.length < 5 ? 'этажа' : 'этажей'}`
                        )}
                      </small>
                    </span>
                    {item.id === office?.id && <Check size={16} />}
                  </Button>
                ))}
                {!filtered.length && !catalogError && (
                  <p className="office-picker-empty">
                    {query.trim() ? 'Офисов не найдено' : 'Нет доступных офисов'}
                  </p>
                )}
              </div>
              {catalogError && (
                <div role="alert" className="office-form-error">
                  <p>{catalogError}</p>
                  <Button
                    type="button"
                    disabled={retrying}
                    onClick={() => void retry()}
                    variant="secondary"
                    size="sm"
                  >
                    {retrying ? 'Загрузка…' : 'Повторить загрузку'}
                  </Button>
                </div>
              )}
              {error && (
                <p role="alert" className="office-form-error">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </>
      <Styles id="office-switcher">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-picker-search {
  margin: 0 5px 7px;
}
.office-switcher {
  position: relative;
  min-width: 0;
}
.office-switcher-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  color: #718098;
  text-align: left;
  white-space: nowrap;
}
.office-switcher-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.office-switcher-trigger > svg {
  flex-shrink: 0;
}
.office-switcher-trigger:hover,
.office-switcher-trigger[aria-expanded='true'] {
  border-color: #e5e8f5;
  background: #f7f8fe;
  color: #7e85c6;
}
.office-picker {
  position: absolute;
  left: 0;
  top: calc(100% + 9px);
  z-index: 160;
  width: 320px;
  padding: 8px;
  border: 1px solid #e0e6f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 45px #32477120;
  letter-spacing: normal;
  white-space: normal;
}
.office-picker-heading {
  font-size: 9px;
  letter-spacing: 1.2px;
  color: #a0aabd;
  padding: 10px 10px 13px;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
}
.office-picker-heading > span {
  letter-spacing: 0;
  font-size: 10px;
  color: #8a94b4;
}
.office-picker-list {
  max-height: 310px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.office-picker-option {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 11px 10px;
  text-align: left;
  border-radius: 8px;
}
.office-picker-option:hover {
  background: #f7f8fd;
}
.office-picker-option.is-selected {
  background: #f1f3fd;
}
.office-picker-icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: #f1f4f9;
  color: #9ca8bc;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.office-picker-option.is-selected .office-picker-icon {
  background: #e7eafd;
  color: #828bce;
}
.office-picker-option > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}
.office-picker-option b {
  display: block;
  font-size: 11px;
  font-weight: 650;
  color: #62718d;
  overflow-wrap: anywhere;
}
.office-picker-option small {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  color: #a0aabd;
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.office-picker-option > svg {
  color: #929bd8;
  flex-shrink: 0;
}
.office-picker-add {
  width: 100%;
  padding: 13px 10px 7px;
  margin-top: 5px;
  border-top: 1px solid #ecf0f6;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8790cd;
  font-size: 11px;
}
.office-picker-empty {
  font-size: 11px;
  color: #a1aabe;
  text-align: center;
  padding: 16px 8px;
}
.office-form-error {
  font-size: 10px;
  line-height: 1.7;
  padding: 10px 12px;
  background: #fff2f2;
  border: 1px solid #f4dce1;
  color: #b66471;
  border-radius: 8px;
  white-space: normal;
}
.office-picker button:focus-visible,
.office-switcher-trigger:focus-visible {
  outline: 2px solid #9ca7df;
  outline-offset: 2px;
}
@media (max-width: 1000px) {
  .office-switcher-trigger {
    max-width: 220px;
    font-size: 11px;
  }
}
@media (max-width: 760px) {
  .office-switcher-trigger {
    max-width: 155px;
    gap: 5px;
    padding: 8px 5px;
    font-size: 10px;
  }
  .office-switcher-trigger > svg:first-child {
    display: none;
  }
  .office-picker {
    position: fixed;
    left: 12px;
    right: 12px;
    top: 66px;
    width: auto;
    max-width: 380px;
    margin: 0 auto;
  }
  .app-header .office-header-context .office-switcher-trigger {
    max-width: 150px;
  }
  .app-header .office-switcher {
    width: 100%;
  }
  .app-header .office-switcher-trigger {
    width: 100%;
    max-width: 160px;
  }
}
`;
