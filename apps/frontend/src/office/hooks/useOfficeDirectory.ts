import { useEffect, useState } from 'react';
import { useOffices } from '../hooks/OfficeProvider';
export function useOfficeDirectory() {
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
  return { offices, create, setCreate, query, setQuery, filtered };
}
export type OfficeDirectoryController = ReturnType<typeof useOfficeDirectory>;
