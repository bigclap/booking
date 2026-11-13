export type ElementKind = 'wall' | 'room' | 'desk' | 'furniture';

export interface PlanElement {
  id: string;
  kind: ElementKind;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  locked: boolean;
  resourceType?: 'meeting_room' | 'workplace';
  roomId?: string;
  seats?: number;
  bookable?: boolean;
  shared?: boolean;
  walls?: boolean;
  equipment?: Array<{ type: string; quantity: number }>;
  points?: Array<{ x: number; y: number }>;
}

export interface Floor {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: PlanElement[];
  background?: {
    src: string;
    name: string;
    opacity: number;
    visible: boolean;
    locked: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

export interface OfficeConfig {
  /** Server concurrency token; browser archives predate this field. */
  revision?: number;
  version: 1;
  id: string;
  name: string;
  address?: string;
  updatedAt: string;
  floors: Floor[];
  hours: Record<string, { enabled: boolean; start: string; end: string }>;
}

const SEAT_COUNTS: Record<string, number> = {
  chair: 1,
  'ergonomic-chair': 1,
  armchair: 1,
  beanbag: 1,
  fitball: 1,
  'sofa-2': 2,
  'sofa-3': 3,
};

export function uid(prefix = 'item'): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

export function createBlankFloor(name = 'Новый этаж'): Floor {
  return { id: uid('floor'), name, width: 1800, height: 1100, elements: [] };
}

export function getRoomCapacity(room: PlanElement): number {
  if (room.equipment !== undefined) {
    return room.equipment.reduce(
      (capacity, item) => capacity + (SEAT_COUNTS[item.type] ?? 0) * item.quantity,
      0,
    );
  }
  return room.seats ?? 0;
}

function fail(message: string): never {
  throw new Error(`Не удалось восстановить план: ${message}.`);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(value: unknown, field: string, required = false): asserts value is string {
  if (typeof value !== 'string' || value.length > 1000 || (required && !value.trim())) {
    fail(`некорректное поле «${field}»`);
  }
}

function numberField(
  value: unknown,
  field: string,
  min = -100000,
  max = 100000,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`некорректное число в поле «${field}»`);
  }
}

function validateConfig(value: unknown): asserts value is OfficeConfig {
  if (!object(value) || value.version !== 1) fail('неподдерживаемый формат конфигурации');
  textField(value.id, 'id', true);
  textField(value.name, 'название офиса');
  if (value.address !== undefined) {
    textField(value.address, 'адрес офиса');
    if (value.address.trim().length > 160) fail('адрес офиса должен быть не длиннее 160 символов');
  }
  textField(value.updatedAt, 'дата изменения', true);
  if (!Number.isFinite(Date.parse(value.updatedAt))) fail('некорректная дата изменения');
  if (!Array.isArray(value.floors) || value.floors.length === 0 || value.floors.length > 40) {
    fail('конфигурация должна содержать от 1 до 40 этажей');
  }
  const ids = new Set<string>([value.id]);
  const rememberId = (id: unknown) => {
    textField(id, 'id', true);
    if (ids.has(id)) fail(`повторяется идентификатор «${id}»`);
    ids.add(id);
  };
  for (const floor of value.floors) {
    if (!object(floor)) fail('некорректный этаж');
    rememberId(floor.id);
    textField(floor.name, 'название этажа');
    numberField(floor.width, 'ширина этажа', 1, 20000);
    numberField(floor.height, 'высота этажа', 1, 20000);
    if (!Array.isArray(floor.elements) || floor.elements.length > 10000)
      fail('некорректный список объектов');
    for (const element of floor.elements) {
      if (!object(element)) fail('некорректный объект плана');
      rememberId(element.id);
      if (!['wall', 'room', 'desk', 'furniture'].includes(String(element.kind)))
        fail('неизвестный вид объекта');
      textField(element.type, 'тип объекта', true);
      textField(element.name, 'название объекта');
      numberField(element.x, 'X');
      numberField(element.y, 'Y');
      numberField(element.width, 'ширина объекта', 1, 20000);
      numberField(element.height, 'высота объекта', 1, 20000);
      numberField(element.rotation, 'поворот', -360000, 360000);
      textField(element.color, 'цвет');
      if (typeof element.locked !== 'boolean') fail('некорректное состояние блокировки объекта');
      if (
        element.resourceType !== undefined &&
        !['meeting_room', 'workplace'].includes(String(element.resourceType))
      ) {
        fail('неизвестный тип бронируемого ресурса');
      }
      for (const field of ['bookable', 'shared', 'walls'] as const) {
        if (element[field] !== undefined && typeof element[field] !== 'boolean')
          fail(`некорректное поле «${field}»`);
      }
      if (element.seats !== undefined) {
        numberField(element.seats, 'число мест', 0, 100000);
        if (!Number.isInteger(element.seats)) fail('число мест должно быть целым');
      }
      if (element.roomId !== undefined) textField(element.roomId, 'связь с помещением', true);
      if (element.equipment !== undefined) {
        if (!Array.isArray(element.equipment) || element.equipment.length > 1000)
          fail('некорректное оснащение');
        for (const item of element.equipment) {
          if (!object(item)) fail('некорректный предмет оснащения');
          textField(item.type, 'вид оснащения', true);
          numberField(item.quantity, 'количество предметов', 0, 100000);
          if (!Number.isInteger(item.quantity)) fail('количество предметов должно быть целым');
        }
      }
      if (element.points !== undefined) {
        if (!Array.isArray(element.points) || element.points.length > 1000)
          fail('некорректный контур');
        for (const point of element.points) {
          if (!object(point)) fail('некорректная точка контура');
          numberField(point.x, 'X контура');
          numberField(point.y, 'Y контура');
        }
      }
    }
    const elements = floor.elements as Array<Record<string, unknown>>;
    const byId = new Map(elements.map((element) => [element.id, element]));
    for (const element of elements) {
      if (element.roomId === undefined) continue;
      const parent = byId.get(element.roomId);
      if (!parent || parent.kind !== 'room' || parent.id === element.id) {
        fail(`у объекта «${element.name}» отсутствует подходящее помещение`);
      }
      const ancestors = new Set<unknown>([element.id]);
      let cursor: Record<string, unknown> | undefined = parent;
      while (cursor) {
        if (ancestors.has(cursor.id)) fail('циклическая связь помещений');
        ancestors.add(cursor.id);
        cursor = cursor.roomId === undefined ? undefined : byId.get(cursor.roomId);
      }
    }
    if (floor.background !== undefined) {
      const background = floor.background;
      if (!object(background)) fail('некорректная подложка');
      if (
        typeof background.src !== 'string' ||
        !/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-zA-Z0-9+/=\s]+$/.test(background.src)
      ) {
        fail('подложка должна быть встроенным растровым изображением');
      }
      textField(background.name, 'название подложки');
      numberField(background.opacity, 'прозрачность подложки', 0, 1);
      if (background.x !== undefined) numberField(background.x, 'X подложки');
      if (background.y !== undefined) numberField(background.y, 'Y подложки');
      if (background.width !== undefined)
        numberField(background.width, 'ширина подложки', 1, 20000);
      if (background.height !== undefined)
        numberField(background.height, 'высота подложки', 1, 20000);
      if (typeof background.visible !== 'boolean' || typeof background.locked !== 'boolean')
        fail('некорректное состояние подложки');
    }
  }
  if (!object(value.hours)) fail('некорректное рабочее расписание');
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  for (const day of Object.values(value.hours)) {
    if (
      !object(day) ||
      typeof day.enabled !== 'boolean' ||
      typeof day.start !== 'string' ||
      !timePattern.test(day.start) ||
      typeof day.end !== 'string' ||
      !timePattern.test(day.end)
    ) {
      fail('некорректные рабочие часы');
    }
  }
}

export function serializeConfig(config: OfficeConfig): string {
  validateConfig(config);
  return JSON.stringify(config, null, 2);
}

export function parseConfig(json: string): OfficeConfig {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return fail('сохранённые данные повреждены');
  }
  validateConfig(value);
  return value;
}

export function createDemoConfig(): OfficeConfig {
  const makeElement = (
    id: string,
    kind: ElementKind,
    type: string,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    extra: Partial<PlanElement> = {},
  ): PlanElement => ({
    id,
    kind,
    type,
    name,
    x,
    y,
    width,
    height,
    rotation: 0,
    color: '#d8e4ed',
    locked: false,
    ...extra,
  });
  const first: Floor = {
    id: 'floor-first',
    name: '1 этаж',
    width: 1800,
    height: 1100,
    elements: [],
  };
  const second: Floor = {
    id: 'floor-second',
    name: '2 этаж',
    width: 1800,
    height: 1100,
    elements: [],
  };

  const buildFloor = (floor: Floor, suffix: string, alternate = false) => {
    const elements = floor.elements;
    const add = (element: PlanElement) => {
      elements.push(element);
      return element;
    };
    const wall = (id: string, x: number, y: number, width: number, height: number) =>
      add(
        makeElement(`${suffix}-${id}`, 'wall', 'wall', 'Стена', x, y, width, height, {
          color: '#536677',
        }),
      );
    const furnish = (
      id: string,
      type: string,
      name: string,
      x: number,
      y: number,
      width: number,
      height: number,
      roomId?: string,
      rotation = 0,
    ) =>
      add(
        makeElement(`${suffix}-${id}`, 'furniture', type, name, x, y, width, height, {
          ...(roomId ? { roomId } : {}),
          rotation,
        }),
      );
    const room = (
      id: string,
      name: string,
      x: number,
      y: number,
      width: number,
      height: number,
      color: string,
      extra: Partial<PlanElement> = {},
    ) =>
      add(
        makeElement(`${suffix}-${id}`, 'room', 'meeting-room', name, x, y, width, height, {
          color,
          resourceType: 'meeting_room',
          bookable: true,
          shared: false,
          walls: false,
          equipment: [],
          ...extra,
        }),
      );
    const workstation = (
      id: string,
      name: string,
      x: number,
      y: number,
      roomId?: string,
      standing = false,
      compact = false,
    ) => {
      const width = compact ? 132 : 150;
      const height = compact ? 66 : 78;
      add(
        makeElement(
          `${suffix}-${id}`,
          'desk',
          standing ? 'standing-desk' : 'desk',
          name,
          x,
          y,
          width,
          height,
          {
            resourceType: 'workplace',
            bookable: true,
            seats: 1,
            ...(roomId ? { roomId } : {}),
            color: standing ? '#d2e4d9' : '#e8d4b6',
          },
        ),
      );
      furnish(
        `${id}-chair`,
        standing ? 'ergonomic-chair' : 'chair',
        standing ? 'Эргономичное кресло' : 'Стул',
        x + width / 2 - 25,
        y + height + 10,
        50,
        54,
        roomId,
        180,
      );
      furnish(`${id}-monitor`, 'monitor', 'Монитор', x + width / 2 - 32, y + 8, 64, 26, roomId);
      furnish(
        `${id}-keyboard`,
        'keyboard',
        'Клавиатура',
        x + width / 2 - 27,
        y + height - 23,
        44,
        15,
        roomId,
      );
      furnish(`${id}-mouse`, 'mouse', 'Мышь', x + width / 2 + 25, y + height - 25, 14, 20, roomId);
    };

    // Three enclosed rooms and a large open workspace share an uncluttered circulation band.
    const meeting = room(
      'meeting',
      alternate ? 'Высота' : 'Заводная',
      120,
      110,
      450,
      320,
      '#e9eef9',
    );
    const forest = room('forest', alternate ? 'Тихая' : 'Лесная', 120, 500, 450, 290, '#e4efe6');
    const cabinet = room(
      'cabinet',
      alternate ? 'Мастерская' : 'Кабинет',
      630,
      110,
      360,
      320,
      '#ede8f5',
      { shared: true },
    );
    const lounge = room(
      'lounge',
      alternate ? 'Кофейня' : 'Гостиная',
      630,
      500,
      360,
      290,
      '#f5eadb',
      { resourceType: undefined, bookable: false },
    );

    wall('outer-top', 90, 80, 1620, 12);
    wall('outer-left', 90, 80, 12, 930);
    wall('outer-right', 1698, 80, 12, 930);
    wall('outer-bottom-left', 90, 998, 1120, 12);
    wall('outer-bottom-right', 1340, 998, 370, 12);
    wall('room1-right-top', 590, 80, 10, 280);
    wall('room1-right-bottom', 590, 415, 10, 40);
    wall('left-separator-1', 90, 452, 330, 10);
    wall('left-separator-2', 500, 452, 100, 10);
    wall('middle-right-top', 1010, 80, 10, 280);
    wall('middle-right-bottom', 1010, 415, 10, 390);
    wall('middle-separator-1', 620, 452, 150, 10);
    wall('middle-separator-2', 850, 452, 170, 10);
    wall('room2-right-top', 590, 492, 10, 200);
    wall('room2-right-bottom', 590, 755, 10, 50);
    wall('lower-left-1', 90, 812, 330, 10);
    wall('lower-left-2', 500, 812, 520, 10);

    furnish('table-meeting', 'meeting-table', 'Переговорный стол', 235, 213, 220, 110, meeting.id);
    for (let index = 0; index < 4; index++) {
      furnish(
        `meeting-chair-top-${index}`,
        'chair',
        'Стул',
        230 + index * 62,
        155,
        48,
        50,
        meeting.id,
      );
      furnish(
        `meeting-chair-bottom-${index}`,
        'chair',
        'Стул',
        230 + index * 62,
        333,
        48,
        50,
        meeting.id,
        180,
      );
    }
    furnish('meeting-board', 'board', 'Доска', 138, 220, 32, 115, meeting.id, 90);
    furnish('meeting-projector', 'projector', 'Проектор', 500, 247, 42, 34, meeting.id);
    furnish('meeting-plant', 'plant', 'Растение', 500, 135, 50, 50, meeting.id);
    furnish('meeting-door', 'door', 'Дверь', 580, 360, 66, 66, undefined, 90);

    furnish('forest-sofa-left', 'sofa-2', 'Двухместный диван', 150, 580, 150, 75, forest.id, 90);
    furnish('forest-sofa-right', 'sofa-2', 'Двухместный диван', 395, 580, 150, 75, forest.id, 270);
    furnish('forest-table', 'meeting-table', 'Стол', 290, 590, 95, 85, forest.id);
    furnish('forest-armchair-1', 'armchair', 'Кресло', 245, 710, 65, 65, forest.id, 180);
    furnish('forest-armchair-2', 'armchair', 'Кресло', 345, 710, 65, 65, forest.id, 180);
    furnish('forest-board', 'board', 'Доска', 275, 515, 110, 28, forest.id);
    furnish('forest-plant', 'plant', 'Растение', 510, 720, 45, 45, forest.id);

    workstation('cabinet-desk-1', 'Кабинет · место 1', 650, 170, cabinet.id, false, true);
    workstation('cabinet-desk-2', 'Кабинет · место 2', 835, 170, cabinet.id, false, true);
    workstation('cabinet-desk-3', 'Кабинет · место 3', 650, 305, cabinet.id, true, true);
    workstation('cabinet-desk-4', 'Кабинет · место 4', 835, 305, cabinet.id, true, true);
    furnish('cabinet-door', 'door', 'Дверь', 1000, 360, 66, 66, undefined, 90);

    furnish('lounge-sofa', 'sofa-3', 'Трёхместный диван', 690, 600, 210, 75, lounge.id);
    furnish('lounge-beanbag-1', 'beanbag', 'Кресло-мешок', 660, 710, 65, 65, lounge.id);
    furnish('lounge-beanbag-2', 'beanbag', 'Кресло-мешок', 870, 710, 65, 65, lounge.id);
    furnish('lounge-table', 'desk', 'Журнальный стол', 755, 715, 85, 45, lounge.id);
    furnish('lounge-plant', 'plant', 'Растение', 930, 520, 45, 45, lounge.id);

    for (let row = 0; row < 3; row++) {
      workstation(
        `open-${row}-left`,
        `Место ${row * 2 + 1}`,
        1120,
        150 + row * 205,
        undefined,
        alternate ? row === 1 : row === 0,
      );
      workstation(
        `open-${row}-right`,
        `Место ${row * 2 + 2}`,
        1430,
        150 + row * 205,
        undefined,
        row === 2,
      );
    }
    furnish('open-plant-1', 'plant', 'Растение', 1070, 725, 62, 62);
    furnish('open-plant-2', 'plant', 'Растение', 1605, 725, 62, 62);
    furnish('open-fitball', 'fitball', 'Фитбол', 1300, 735, 58, 58);
    furnish('entry-sofa', 'sofa-2', 'Диван у входа', 170, 880, 150, 75);
    furnish('entry-plant', 'plant', 'Растение', 360, 900, 60, 60);
    furnish('entry-plant-right', 'plant', 'Растение', 1580, 900, 60, 60);
    furnish('entry-door', 'door', 'Вход', 1210, 940, 130, 65);

    for (const resource of elements.filter((element) => element.kind === 'room')) {
      const counts = new Map<string, number>();
      for (const item of elements.filter(
        (element) => element.kind === 'furniture' && element.roomId === resource.id,
      )) {
        counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
      }
      resource.equipment = [...counts].map(([type, quantity]) => ({ type, quantity }));
      resource.seats = getRoomCapacity(resource);
    }
  };

  buildFloor(first, 'f1');
  buildFloor(second, 'f2', true);
  return {
    version: 1,
    id: 'office-demo',
    name: 'Офис на Лесной',
    updatedAt: new Date().toISOString(),
    floors: [first, second],
    hours: Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day, index) => [
        day,
        { enabled: index < 5, start: '09:00', end: '19:00' },
      ]),
    ),
  };
}
