import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Armchair,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Eye,
  Grid2X2,
  Hand,
  HelpCircle,
  ImagePlus,
  Layers,
  LockKeyhole,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Search,
  Settings2,
  SquareDashed,
  Trash2,
  Undo2,
  Upload,
  X,
  BrickWall,
  RotateCw,
  Building2,
  CheckCheck,
} from 'lucide-react';
import { CATALOG, CATEGORY_LABELS, getCatalogItem } from './catalog';
import type { CatalogCategory } from './catalog';
import { createBlankFloor, getRoomCapacity, parseConfig, uid } from './model';
import type { Floor, OfficeConfig, PlanElement } from './model';
import Inspector from './Inspector';
import UserMenu from './auth/UserMenu';
import { officeDetailsPath } from './admin/routes';
import { useOffices } from './offices/OfficeProvider';
import { useAuth } from './auth/AuthProvider';
import { ApiError } from './api/client';
import UnderlayPanel from './UnderlayPanel';
import ScaleChair from './ScaleChair';
import CanvasGrid, { GRID_STEP, getVisibleGridStep } from './CanvasGrid';
import RoomLabel from './RoomLabel';
import { getWallEndpoints, wallFromEndpoints, snapWallPoint } from './wallEditorGeometry';
import { getWallSegments, WALL_THICKNESS } from './wallGeometry';
import { resizeFromCorner, transformRoomChildren } from './editorGeometry';
import { getUnderlayBounds, resizeUnderlay } from './underlayGeometry';
import type { UnderlayBounds, UnderlayCorner } from './underlayGeometry';

const PLAN_DRAFT_PREFIX = 'plan-room.http-plan-draft.v1.';
type PlanDraft = { floors: Floor[]; savedAt: string; baseUpdatedAt: string; baseRevision?: number };
type Recovery = { draft?: PlanDraft; error?: string } | null;
const COLORS = ['#e5edf9', '#e3efe6', '#eee7f5', '#f6eadb', '#e2f0f1', '#f3e6e9'];
type Point = { x: number; y: number };
type Camera = Point & { zoom: number };
type Tool = 'select' | 'pan' | 'wall' | 'room' | string;
type DragState = {
  mode:
    | 'pan'
    | 'move'
    | 'resize'
    | 'rotate'
    | 'draw'
    | 'underlay-move'
    | 'underlay-resize'
    | 'wall-end';
  wallEndpoint?: 0 | 1;
  underlay?: UnderlayBounds;
  corner?: UnderlayCorner;
  point: Point;
  client: Point;
  before: OfficeConfig;
  original?: PlanElement;
  camera: Camera;
  drawKind?: 'wall' | 'room';
};
const clone = <T,>(value: T): T => structuredClone(value);
const round = (value: number) => Math.round(value * 100) / 100;

function readPlanDraft(key: string, office: OfficeConfig): Recovery {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as PlanDraft;
    const parsed = parseConfig(JSON.stringify({ ...office, floors: value.floors }));
    if (typeof value.savedAt !== 'string' || typeof value.baseUpdatedAt !== 'string')
      throw new Error();
    if (JSON.stringify(parsed.floors) === JSON.stringify(office.floors)) return null;
    return {
      draft: {
        floors: parsed.floors,
        savedAt: value.savedAt,
        baseUpdatedAt: value.baseUpdatedAt,
        baseRevision: value.baseRevision,
      },
    };
  } catch {
    return {
      error: 'Не удалось прочитать локальный черновик. Серверный план открыт без изменений.',
    };
  }
}

function inside(point: Point, room: PlanElement) {
  const cx = room.x + room.width / 2,
    cy = room.y + room.height / 2;
  const angle = (-(room.rotation || 0) * Math.PI) / 180;
  const x = (point.x - cx) * Math.cos(angle) - (point.y - cy) * Math.sin(angle);
  const y = (point.x - cx) * Math.sin(angle) + (point.y - cy) * Math.cos(angle);
  return Math.abs(x) <= room.width / 2 && Math.abs(y) <= room.height / 2;
}
function assignRoom(element: PlanElement, floor: Floor): PlanElement {
  if (element.kind !== 'furniture' && element.kind !== 'desk') return element;
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  const rooms = floor.elements
    .filter((item) => item.kind === 'room' && inside(center, item))
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return { ...element, roomId: rooms[0]?.id };
}
function reconcile(config: OfficeConfig, before: OfficeConfig): OfficeConfig {
  return {
    ...config,
    floors: config.floors.map((floor) => {
      const previous = before.floors.find((item) => item.id === floor.id);
      const roomIds = new Set(
        floor.elements.filter((item) => item.kind === 'room').map((item) => item.id),
      );
      const elements = floor.elements.map((item) =>
        item.roomId && !roomIds.has(item.roomId) ? { ...item, roomId: undefined } : item,
      );
      return {
        ...floor,
        elements: elements.map((item) => {
          if (item.kind !== 'room') return item;
          const counts = (items: PlanElement[]) => {
            const result = new Map<string, number>();
            items
              .filter((child) => child.kind === 'furniture' && child.roomId === item.id)
              .forEach((child) => result.set(child.type, (result.get(child.type) || 0) + 1));
            return result;
          };
          const was = counts(previous?.elements || []),
            now = counts(elements);
          const changed = [...new Set([...was.keys(), ...now.keys()])].filter(
            (type) => was.get(type) !== now.get(type),
          );
          // A geometry edit must preserve equipment declared by the server without furniture on the plan.
          if (!changed.length) return item;
          const quantities = new Map(
            (item.equipment || []).map((entry) => [entry.type, entry.quantity]),
          );
          changed.forEach((type) => {
            if (now.has(type)) quantities.set(type, now.get(type)!);
            else quantities.delete(type);
          });
          const room = {
            ...item,
            equipment: [...quantities].map(([type, quantity]) => ({ type, quantity })),
          };
          return changed.some((type) => (getCatalogItem(type)?.seats || 0) > 0)
            ? { ...room, seats: getRoomCapacity(room) }
            : room;
        }),
      };
    }),
  };
}
export default function App({ office }: { office: OfficeConfig }) {
  const { saveOfficePlan } = useOffices();
  const { user } = useAuth();
  const owner = `${user?.id || ''}:${office.id}`;
  const draftKey =
    PLAN_DRAFT_PREFIX + encodeURIComponent(user?.id || '') + '.' + encodeURIComponent(office.id);
  useEffect(() => {
    document.title = `${office.name} — План офиса · Администрирование`;
  }, [office.id, office.name]);
  const [config, setConfig] = useState<OfficeConfig>(() => office);
  const [recovery, setRecovery] = useState<Recovery>(() => readPlanDraft(draftKey, office));
  const configRef = useRef(config);
  configRef.current = config;
  const savedFloors = useRef(JSON.stringify(office.floors));
  const savedRevision = useRef(office.revision);
  const sourceOffice = useRef(office);
  const active = useRef(true);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const savingRef = useRef(false);
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const [saveTick, setSaveTick] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const [draftWarning, setDraftWarning] = useState('');
  const [floorId, setFloorId] = useState(() => config.floors[0].id);
  const floor = config.floors.find((item) => item.id === floorId) || config.floors[0];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = floor.elements.find((item) => item.id === selectedId) || null;
  const [underlayEditing, setUnderlayEditing] = useState(false);
  const [tool, setToolState] = useState<Tool>('select');
  const setTool = (next: Tool) => {
    setUnderlayEditing(false);
    setToolState(next);
  };
  const [tab, setTab] = useState<'catalog' | 'layers'>('catalog');
  const [category, setCategory] = useState<CatalogCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [grid, setGrid] = useState(true);
  const [preview, setPreview] = useState(false);
  const [settings, setSettings] = useState(false);
  const [underlayOpen, setUnderlayOpen] = useState(false);
  useEffect(() => {
    if (!floor.background?.visible || preview) setUnderlayEditing(false);
  }, [floor.background?.visible, preview]);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState('');
  const [saveState, setSaveState] = useState('Сохранено на сервере');
  const [camera, setCamera] = useState<Camera>({ x: -100, y: -100, zoom: 0.45 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [ghost, setGhost] = useState<PlanElement | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const undoRef = useRef<OfficeConfig[]>([]);
  const redoRef = useRef<OfficeConfig[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const fittedFloor = useRef<string | null>(null);
  const roomCount = floor.elements.filter((item) => item.kind === 'room' && item.bookable).length;
  const deskCount = floor.elements.filter((item) => item.kind === 'desk' && item.bookable).length;
  const underlay = getUnderlayBounds(floor);
  const gridStep = getVisibleGridStep(camera.zoom);
  const walls = useMemo(
    () =>
      getWallSegments(
        floor.elements.filter((item) => item.kind !== 'room' || item.walls !== false),
      ),
    [floor.elements],
  );
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const remember = useCallback((before: OfficeConfig) => {
    undoRef.current = [...undoRef.current.slice(-59), before];
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
  }, []);
  const commit = useCallback(
    (next: OfficeConfig, before?: OfficeConfig) => {
      const previous = before || configRef.current;
      remember(clone(previous));
      setConfig(reconcile({ ...next, updatedAt: new Date().toISOString() }, previous));
    },
    [remember],
  );
  const changeFloor = useCallback(
    (transform: (current: Floor) => Floor) => {
      const current = configRef.current;
      commit({
        ...current,
        floors: current.floors.map((item) => (item.id === floor.id ? transform(item) : item)),
      });
    },
    [floor.id, commit],
  );
  const undo = useCallback(() => {
    const before = undoRef.current.pop();
    if (!before) return;
    redoRef.current.push(clone(configRef.current));
    setConfig(before);
    setSelectedId(null);
    setHistoryTick((value) => value + 1);
  }, []);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(clone(configRef.current));
    setConfig(next);
    setSelectedId(null);
    setHistoryTick((value) => value + 1);
  }, []);
  const preserveDraft = useCallback(() => {
    if (recoveryRef.current || JSON.stringify(configRef.current.floors) === savedFloors.current)
      return;
    const current = configRef.current;
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        floors: current.floors,
        savedAt: new Date().toISOString(),
        baseUpdatedAt: sourceOffice.current.updatedAt,
        baseRevision: savedRevision.current,
      } satisfies PlanDraft),
    );
  }, [draftKey]);
  useEffect(() => {
    if (sourceOffice.current === office) return;
    sourceOffice.current = office;
    if (!savingRef.current && JSON.stringify(configRef.current.floors) === savedFloors.current) {
      savedFloors.current = JSON.stringify(office.floors);
      savedRevision.current = office.revision;
      setConfig(office);
    }
  }, [office]);
  useEffect(() => {
    active.current = true;
    const pagehide = () => {
      try {
        preserveDraft();
      } catch {
        /* The visible warning and beforeunload protect a failed local draft. */
      }
    };
    const beforeunload = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(configRef.current.floors) === savedFloors.current) return;
      pagehide();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('beforeunload', beforeunload);
    return () => {
      active.current = false;
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('beforeunload', beforeunload);
      pagehide();
    };
  }, [preserveDraft, owner]);
  useEffect(() => {
    if (recovery) return;
    if (
      JSON.stringify(config.floors) === savedFloors.current &&
      !savingRef.current &&
      !saveConflict
    ) {
      setSaveState('Сохранено на сервере');
      setSaveError('');
      try {
        localStorage.removeItem(draftKey);
        setDraftWarning('');
      } catch {
        setDraftWarning('План сохранён на сервере, но локальный черновик не удалось удалить.');
      }
      return;
    }
    try {
      preserveDraft();
      setDraftWarning('');
    } catch {
      setDraftWarning(
        'Не удалось сохранить локальный черновик. Не закрывайте страницу до сохранения на сервере.',
      );
    }
  }, [config, recovery, preserveDraft, draftKey, saveConflict]);
  useEffect(() => {
    if (recovery) {
      setSaveState('Ожидает решения по черновику');
      return;
    }
    if (saveConflict) {
      setSaveState('Конфликт изменений');
      return;
    }
    if (JSON.stringify(config.floors) === savedFloors.current) return;
    if (!savingRef.current)
      setSaveState(saveError ? 'Не удалось сохранить' : 'Есть несохранённые изменения');
    const timer = window.setTimeout(async () => {
      if (!active.current || ownerRef.current !== owner || savingRef.current || dragRef.current)
        return;
      const snapshot = configRef.current;
      const fingerprint = JSON.stringify(snapshot.floors);
      if (fingerprint === savedFloors.current) return;
      savingRef.current = true;
      setSaveState('Сохраняю…');
      let saved = false;
      try {
        const result = await saveOfficePlan(snapshot.id, snapshot.floors, savedRevision.current);
        if (!active.current || ownerRef.current !== owner) return;
        saved = true;
        savedFloors.current = fingerprint;
        savedRevision.current = result.revision;
        setSaveError('');
        if (JSON.stringify(configRef.current.floors) === fingerprint) {
          savedFloors.current = JSON.stringify(result.floors);
          configRef.current = result;
          setConfig(result);
          setSaveState('Сохранено на сервере');
          setDraftWarning('');
          try {
            localStorage.removeItem(draftKey);
          } catch {
            setDraftWarning('План сохранён на сервере, но локальный черновик не удалось удалить.');
          }
        } else {
          setSaveState('Есть несохранённые изменения');
          try {
            preserveDraft();
          } catch {
            setDraftWarning(
              'Не удалось сохранить локальный черновик. Не закрывайте страницу до сохранения на сервере.',
            );
          }
        }
      } catch (cause) {
        if (!active.current || ownerRef.current !== owner) return;
        setSaveState('Не удалось сохранить');
        if (cause instanceof ApiError && cause.status === 409) {
          setSaveConflict(true);
          setSaveError(
            'План изменён в другом окне. Ваши правки не записаны поверх чужих. Откройте актуальный план и сравните его с локальным черновиком перед восстановлением.',
          );
        } else
          setSaveError(
            cause instanceof Error ? cause.message : 'Не удалось сохранить план на сервере.',
          );
      } finally {
        savingRef.current = false;
        if (saved && active.current && ownerRef.current === owner)
          setSaveTick((value) => value + 1);
      }
    }, 450);
    return () => window.clearTimeout(timer);
    // Save errors remain visible until the next successful request; retries are explicit.
  }, [config, recovery, owner, saveOfficePlan, saveTick, draftKey, preserveDraft, saveConflict]);

  const resolveRecovery = (restore: boolean) => {
    try {
      if (restore && recovery?.draft) {
        remember(clone(configRef.current));
        setConfig({ ...configRef.current, floors: recovery.draft.floors });
      }
      localStorage.removeItem(draftKey);
      setRecovery(null);
      setSaveError('');
      setSaveState(restore ? 'Есть несохранённые изменения' : 'Сохранено на сервере');
    } catch {
      setSaveError(
        'Не удалось обработать локальный черновик. Проверьте доступ к хранилищу браузера.',
      );
    }
  };
  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const fit = useCallback(() => {
    const zoom = Math.max(
      0.12,
      Math.min((size.width - 90) / floor.width, (size.height - 90) / floor.height, 1.1),
    );
    setCamera({
      x: (floor.width - size.width / zoom) / 2,
      y: (floor.height - size.height / zoom) / 2,
      zoom,
    });
  }, [floor.width, floor.height, size]);
  useEffect(() => {
    if (size.width > 40 && size.height > 40 && fittedFloor.current !== floor.id) {
      fittedFloor.current = floor.id;
      fit();
    }
  }, [floor.id, size, fit]);
  const zoomAt = useCallback(
    (factor: number, client?: Point) => {
      setCamera((previous) => {
        const rect = svgRef.current?.getBoundingClientRect();
        const px = client && rect ? client.x - rect.left : size.width / 2;
        const py = client && rect ? client.y - rect.top : size.height / 2;
        const zoom = Math.min(3, Math.max(0.12, previous.zoom * factor));
        return {
          x: previous.x + px / previous.zoom - px / zoom,
          y: previous.y + py / previous.zoom - py / zoom,
          zoom,
        };
      });
    },
    [size],
  );
  useEffect(() => {
    const canvas = svgRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0015), { x: event.clientX, y: event.clientY });
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [zoomAt]);
  const pointFrom = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect(),
      current = cameraRef.current;
    return {
      x: current.x + (clientX - rect.left) / current.zoom,
      y: current.y + (clientY - rect.top) / current.zoom,
    };
  };
  const snap = (value: number) =>
    snapEnabled ? Math.round(value / GRID_STEP) * GRID_STEP : round(value);
  const snapWall = (point: Point, excludeId?: string) => {
    if (!snapEnabled) return point;
    const result = snapWallPoint(point, floor.elements, camera.zoom, excludeId);
    return result.matched ? result.point : { x: snap(point.x), y: snap(point.y) };
  };
  const insertAsset = (type: string, point: Point) => {
    const item = getCatalogItem(type);
    if (!item) return;
    const isDesk = type === 'desk' || type === 'standing-desk';
    const element: PlanElement = assignRoom(
      {
        id: uid(isDesk ? 'desk' : 'furniture'),
        kind: isDesk ? 'desk' : 'furniture',
        type,
        name: isDesk ? 'Рабочее место ' + (deskCount + 1) : item.name,
        x: snap(point.x - item.width / 2),
        y: snap(point.y - item.height / 2),
        width: item.width,
        height: item.height,
        rotation: 0,
        color: '#dce5f2',
        locked: false,
        ...(isDesk ? { resourceType: 'workplace', bookable: true } : {}),
      },
      floor,
    );
    changeFloor((current) => ({ ...current, elements: [...current.elements, element] }));
    setSelectedId(element.id);
    notify('Объект добавлен. Esc — завершить размещение');
  };
  const removeSelected = useCallback(() => {
    const element = configRef.current.floors
      .find((item) => item.id === floor.id)
      ?.elements.find((item) => item.id === selectedId);
    if (!element || element.locked) {
      if (element?.locked) notify('Сначала разблокируйте объект');
      return;
    }
    changeFloor((current) => ({
      ...current,
      elements: current.elements
        .filter((item) => item.id !== selectedId)
        .map((item) => (item.roomId === selectedId ? { ...item, roomId: undefined } : item)),
    }));
    setSelectedId(null);
    notify('Объект удалён · можно отменить');
  }, [selectedId, floor.id, changeFloor, notify]);
  const duplicateSelected = useCallback(() => {
    const element = floor.elements.find((item) => item.id === selectedId);
    if (!element) return;
    const copied = {
      ...clone(element),
      id: uid(element.kind),
      name: element.name + ' · копия',
      x: element.x + 30,
      y: element.y + 30,
      locked: false,
    };
    const children =
      element.kind === 'room'
        ? floor.elements
            .filter((item) => item.roomId === element.id)
            .map((item) => ({
              ...clone(item),
              id: uid(item.kind),
              roomId: copied.id,
              x: item.x + 30,
              y: item.y + 30,
            }))
        : [];
    changeFloor((current) => ({
      ...current,
      elements: [...current.elements, copied, ...children],
    }));
    setSelectedId(copied.id);
  }, [floor.elements, selectedId, changeFloor]);
  const updateSelected = (patch: Partial<PlanElement>) => {
    if (!selected) return;
    changeFloor((current) => {
      let updated = { ...selected, ...patch };
      if (patch.roomId) {
        const parent = current.elements.find((item) => item.id === patch.roomId);
        if (
          parent &&
          !inside({ x: updated.x + updated.width / 2, y: updated.y + updated.height / 2 }, parent)
        ) {
          updated = {
            ...updated,
            x: parent.x + (parent.width - updated.width) / 2,
            y: parent.y + (parent.height - updated.height) / 2,
          };
        }
      } else if (patch.x !== undefined || patch.y !== undefined)
        updated = assignRoom(updated, current);
      return {
        ...current,
        elements:
          selected.kind === 'room'
            ? transformRoomChildren(selected, updated, current.elements)
            : current.elements.map((item) => (item.id === selected.id ? updated : item)),
      };
    });
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (recoveryRef.current) return;
      if ((event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (key === 'escape') {
        if (dragRef.current) setConfig(dragRef.current.before);
        dragRef.current = null;
        setGhost(null);
        setTool('select');
        setSelectedId(null);
        setSettings(false);
        setHelp(false);
        setUnderlayOpen(false);
      }
      if (event.code === 'Space') {
        event.preventDefault();
        setSpacePressed(true);
      }
      if (key === 'v') setTool('select');
      if (key === 'h') setTool('pan');
      if (key === 'w') setTool('wall');
      if (key === 'r' && !selectedId) setTool('room');
      if ((key === 'delete' || key === 'backspace') && selectedId) {
        event.preventDefault();
        removeSelected();
      }
      if (key === 'r' && selected && !selected.locked)
        updateSelected({ rotation: (selected.rotation + 90) % 360 });
      if (
        ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) &&
        selected &&
        !selected.locked
      ) {
        event.preventDefault();
        const delta = event.shiftKey ? 10 : 1;
        updateSelected({
          x: selected.x + (key === 'arrowright' ? delta : key === 'arrowleft' ? -delta : 0),
          y: selected.y + (key === 'arrowdown' ? delta : key === 'arrowup' ? -delta : 0),
        });
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  });

  const startPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const point = pointFrom(event.clientX, event.clientY);
    const base: DragState = {
      mode: 'pan',
      point,
      client: { x: event.clientX, y: event.clientY },
      before: clone(configRef.current),
      camera: { ...cameraRef.current },
    };
    svgRef.current?.setPointerCapture(event.pointerId);
    if (spacePressed || tool === 'pan' || event.button === 1) {
      dragRef.current = base;
      return;
    }
    if (preview) return;
    if (underlayEditing && floor.background?.visible) {
      const control = (event.target as Element).closest('[data-underlay-action]');
      if (control) {
        const action = control.getAttribute('data-underlay-action')!;
        dragRef.current = {
          ...base,
          mode: action === 'move' ? 'underlay-move' : 'underlay-resize',
          underlay: { ...underlay },
          corner: action as UnderlayCorner,
        };
      }
      return;
    }
    if (tool.startsWith('asset:')) {
      insertAsset(tool.slice(6), point);
      return;
    }
    if (tool === 'room' || tool === 'wall') {
      dragRef.current = {
        ...base,
        mode: 'draw',
        point: tool === 'wall' ? snapWall(point) : { x: snap(point.x), y: snap(point.y) },
        drawKind: tool,
      };
      setSelectedId(null);
      return;
    }
    const node = (event.target as Element).closest('[data-element-id]');
    const id = node?.getAttribute('data-element-id');
    const element = floor.elements.find((item) => item.id === id);
    setSelectedId(element?.id || null);
    if (element && !element.locked) {
      const handle = (event.target as Element)
        .closest('[data-handle]')
        ?.getAttribute('data-handle');
      dragRef.current = {
        ...base,
        mode:
          element.kind === 'wall' && (handle === 'wall-start' || handle === 'wall-end')
            ? 'wall-end'
            : handle === 'resize'
              ? 'resize'
              : handle === 'rotate'
                ? 'rotate'
                : 'move',
        wallEndpoint: handle === 'wall-start' ? 0 : 1,
        original: clone(element),
      };
    }
  };
  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointFrom(event.clientX, event.clientY);
    setCursor(point);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'pan') {
      setCamera({
        ...drag.camera,
        x: drag.camera.x - (event.clientX - drag.client.x) / drag.camera.zoom,
        y: drag.camera.y - (event.clientY - drag.client.y) / drag.camera.zoom,
      });
      return;
    }
    if (drag.mode === 'underlay-move' || drag.mode === 'underlay-resize') {
      const original = drag.underlay!;
      const bounds =
        drag.mode === 'underlay-resize'
          ? resizeUnderlay(original, drag.point, point, drag.corner!)
          : {
              ...original,
              x: Math.max(-100000, Math.min(100000, round(original.x + point.x - drag.point.x))),
              y: Math.max(-100000, Math.min(100000, round(original.y + point.y - drag.point.y))),
            };
      setConfig({
        ...drag.before,
        floors: drag.before.floors.map((item) =>
          item.id === floor.id ? { ...item, background: { ...item.background!, ...bounds } } : item,
        ),
      });
      return;
    }
    if (drag.mode === 'draw') {
      const end = { x: snap(point.x), y: snap(point.y) },
        start = drag.point;
      let x = Math.min(start.x, end.x),
        y = Math.min(start.y, end.y),
        width = Math.max(10, Math.abs(end.x - start.x)),
        height = Math.max(10, Math.abs(end.y - start.y));
      if (drag.drawKind === 'wall') {
        // Keep new walls orthogonal, then connect exactly to nearby existing geometry.
        const constrained =
          width >= height ? { x: point.x, y: start.y } : { x: start.x, y: point.y };
        const endpoint = snapWall(constrained);
        setGhost(
          wallFromEndpoints(
            {
              id: 'ghost',
              kind: 'wall',
              type: 'wall',
              name: 'Стена',
              x: 0,
              y: 0,
              width: 1,
              height: WALL_THICKNESS,
              rotation: 0,
              color: '#657697',
              locked: false,
            },
            start,
            endpoint,
          ),
        );
        return;
      }
      setGhost({
        id: 'ghost',
        kind: drag.drawKind!,
        type: drag.drawKind === 'room' ? 'meeting-room' : 'wall',
        name: drag.drawKind === 'room' ? 'Новое помещение' : 'Стена',
        x,
        y,
        width,
        height,
        rotation: 0,
        color: COLORS[roomCount % COLORS.length],
        locked: false,
        ...(drag.drawKind === 'room'
          ? { resourceType: 'meeting_room', bookable: true, shared: false, equipment: [] }
          : {}),
      });
      return;
    }
    const original = drag.original!;
    const updated = clone(drag.before);
    const targetFloor = updated.floors.find((item) => item.id === floor.id)!;
    const target = targetFloor.elements.find((item) => item.id === original.id)!;
    if (drag.mode === 'wall-end') {
      const endpoints = getWallEndpoints(original);
      const moving = drag.wallEndpoint!,
        fixed = endpoints[moving === 0 ? 1 : 0];
      let endpoint = snapWall(point, original.id);
      if (event.shiftKey)
        endpoint =
          Math.abs(endpoint.x - fixed.x) >= Math.abs(endpoint.y - fixed.y)
            ? { x: endpoint.x, y: fixed.y }
            : { x: fixed.x, y: endpoint.y };
      endpoints[moving] = endpoint;
      Object.assign(target, wallFromEndpoints(original, endpoints[0], endpoints[1]));
    }
    if (drag.mode === 'move') {
      if (original.kind === 'wall') {
        const [start, end] = getWallEndpoints(original);
        const moved = snapWall(
          { x: start.x + point.x - drag.point.x, y: start.y + point.y - drag.point.y },
          original.id,
        );
        Object.assign(
          target,
          wallFromEndpoints(original, moved, {
            x: end.x + moved.x - start.x,
            y: end.y + moved.y - start.y,
          }),
        );
      } else {
        target.x = snap(original.x + point.x - drag.point.x);
        target.y = snap(original.y + point.y - drag.point.y);
        if (original.kind !== 'room') Object.assign(target, assignRoom(target, targetFloor));
      }
    }
    if (drag.mode === 'resize') {
      Object.assign(target, resizeFromCorner(original, drag.point, point, snap));
    }
    if (drag.mode === 'rotate') {
      const cx = original.x + original.width / 2,
        cy = original.y + original.height / 2;
      const angle =
        Math.atan2(point.y - cy, point.x - cx) - Math.atan2(drag.point.y - cy, drag.point.x - cx);
      target.rotation = Math.round(original.rotation + (angle * 180) / Math.PI);
    }
    if (original.kind === 'room')
      targetFloor.elements = transformRoomChildren(original, target, targetFloor.elements);
    setConfig(reconcile(updated, drag.before));
  };
  const finishPointer = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.mode === 'draw') {
      if (
        ghost &&
        (ghost.kind === 'wall' ? ghost.width >= GRID_STEP : ghost.width >= 30 || ghost.height >= 30)
      ) {
        const element = {
          ...ghost,
          id: uid(ghost.kind),
          name: ghost.kind === 'room' ? 'Переговорная ' + (roomCount + 1) : 'Стена',
        };
        commit(
          {
            ...drag.before,
            floors: drag.before.floors.map((item) =>
              item.id === floor.id ? { ...item, elements: [...item.elements, element] } : item,
            ),
          },
          drag.before,
        );
        setSelectedId(element.id);
        setTool('select');
      }
      setGhost(null);
    } else if (
      drag.mode !== 'pan' &&
      JSON.stringify(drag.before.floors) !== JSON.stringify(configRef.current.floors)
    ) {
      remember(drag.before);
      setConfig((current) => ({ ...current, updatedAt: new Date().toISOString() }));
    }
    setSaveTick((value) => value + 1);
  };
  const selectFloor = (id: string) => {
    if (id === floorId) return;
    if (dragRef.current) setConfig(dragRef.current.before);
    dragRef.current = null;
    setGhost(null);
    setCursor(null);
    setFloorId(id);
    setSelectedId(null);
    setTool('select');
  };
  const addFloor = () => {
    const current = dragRef.current?.before || config;
    dragRef.current = null;
    setGhost(null);
    setCursor(null);
    if (current.floors.length >= 40) {
      notify('Можно добавить до 40 этажей');
      return;
    }
    const number =
      Math.max(0, ...current.floors.map((item) => Number(item.name.match(/^(-?\d+)/)?.[1]) || 0)) +
      1;
    const added = createBlankFloor(number + ' этаж');
    commit({ ...current, floors: [...current.floors, added] }, current);
    setFloorId(added.id);
    setSelectedId(null);
    setTool('select');
    notify('Новый этаж готов. Начните с подложки или помещения.');
  };
  const removeFloor = () => {
    if (config.floors.length < 2) return;
    const floors = config.floors.filter((item) => item.id !== floor.id);
    commit({ ...config, floors });
    setFloorId(floors[0].id);
    setSelectedId(null);
    setSettings(false);
    setUnderlayEditing(false);
    notify('Этаж удалён · можно отменить');
  };
  const loadBackground = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Поддерживаются изображения PNG, JPEG и WebP');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notify('Изображение слишком большое. Максимум 20 МБ.');
      return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = data;
      await image.decode();
      const ratio = Math.min(1, 2200 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL('image/webp', 0.86);
      changeFloor((current) => {
        const width = current.elements.length ? current.width : canvas.width;
        const height = current.elements.length ? current.height : canvas.height;
        const fit = Math.min(width / canvas.width, height / canvas.height);
        return {
          ...current,
          width,
          height,
          background: {
            src,
            name: file.name,
            width: round(canvas.width * fit),
            height: round(canvas.height * fit),
            opacity: 0.7,
            visible: true,
            locked: true,
          },
        };
      });
      setTool('select');
      setSelectedId(null);
      setPreview(false);
      setGrid(true);
      setUnderlayOpen(false);
      setUnderlayEditing(true);
      fittedFloor.current = null;
      notify('Подложка загружена. Сравните её масштаб со стулом и растяните за углы.');
    } catch {
      notify('Не удалось открыть изображение. Попробуйте другой файл.');
    }
    if (uploadRef.current) uploadRef.current.value = '';
  };
  const filtered = CATALOG.filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      [item.name, ...(item.searchTerms || [])].some((term) =>
        term.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const list = floor.elements
    .filter((item) => item.kind !== 'furniture' || search)
    .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  const itemTool = tool.startsWith('asset:') ? getCatalogItem(tool.slice(6)) : null;
  const wallSnapMatch =
    cursor &&
    snapEnabled &&
    !underlayEditing &&
    (tool === 'wall' || dragRef.current?.mode === 'wall-end')
      ? snapWallPoint(cursor, floor.elements, camera.zoom, dragRef.current?.original?.id)
      : null;
  const selectedTransform = selected
    ? 'rotate(' +
      selected.rotation +
      ' ' +
      (selected.x + selected.width / 2) +
      ' ' +
      (selected.y + selected.height / 2) +
      ')'
    : '';
  const actionTitle = itemTool
    ? 'Разместите: ' + itemTool.name
    : tool === 'wall'
      ? 'Протяните, чтобы нарисовать стену'
      : tool === 'room'
        ? 'Протяните область помещения'
        : tool === 'pan' || spacePressed
          ? 'Перемещение холста'
          : 'Выбор и перемещение';
  void historyTick;

  return (
    <div className={'app-shell admin-plan-shell' + (preview ? ' is-preview' : '')}>
      {(recovery || saveError || draftWarning) && (
        <div className="recovery-banner" role="alert" style={{ flexWrap: 'wrap', gap: '8px 18px' }}>
          {recovery ? (
            <>
              <span>
                {recovery.error ||
                  (recovery.draft?.baseRevision !== undefined &&
                  recovery.draft.baseRevision !== office.revision
                    ? 'Серверный план изменился после создания черновика. Восстановление заменит его этажи локальной версией — сначала сравните планы.'
                    : 'Есть несохранённый локальный черновик этого плана. Восстановить его поверх серверной версии?')}
              </span>
              {recovery.draft && (
                <button onClick={() => resolveRecovery(true)}>Восстановить черновик</button>
              )}
              <button onClick={() => resolveRecovery(false)}>Отбросить черновик</button>
            </>
          ) : (
            <>
              {saveError && <span>{saveError}</span>}
              {draftWarning && <span>{draftWarning}</span>}
              {saveError &&
                (saveConflict ? (
                  <button onClick={() => window.location.reload()}>Открыть актуальный план</button>
                ) : (
                  <button onClick={() => setSaveTick((value) => value + 1)}>
                    Повторить сохранение
                  </button>
                ))}
            </>
          )}
          {saveError && recovery && <span>{saveError}</span>}
        </div>
      )}
      <header className="app-header plan-admin-header">
        <a
          className="brand plan-admin-brand"
          href="/admin/offices"
          aria-label="Администрирование — Офисы"
        >
          <span className="brand-mark">
            <Grid2X2 size={22} />
          </span>
          <span className="plan-admin-brand-copy">
            <b>планировка</b>
            <small>Администрирование</small>
          </span>
        </a>
        <nav className="plan-admin-breadcrumbs" aria-label="Путь в администрировании">
          <a href="/admin/offices">Офисы</a>
          <ChevronRight size={13} />
          <a
            className="plan-admin-office-name"
            href={officeDetailsPath(office.id)}
            title={office.name}
          >
            {office.name}
          </a>
          <ChevronRight size={13} />
          <strong aria-current="page">План</strong>
        </nav>
        <div className="header-actions plan-admin-actions">
          <span role="status" className={'save-state' + (saveError ? ' save-error' : '')}>
            <Check size={14} />
            {saveState}
          </span>
          <button
            className={'secondary-button preview-button' + (preview ? ' active' : '')}
            aria-label={preview ? 'К редактированию' : 'Предпросмотр'}
            onClick={() => {
              setPreview(!preview);
              setSelectedId(null);
              setTool('select');
            }}
          >
            <Eye size={15} />
            {preview ? 'К редактированию' : 'Предпросмотр'}
          </button>
          <UserMenu area="admin" />
        </div>
      </header>
      <div className="workspace" inert={!!recovery}>
        <nav className="nav-rail">
          <a
            className="rail-link"
            title="К деталям офиса"
            aria-label={`Вернуться к офису ${office.name}`}
            href={officeDetailsPath(office.id)}
          >
            <ArrowLeft />
          </a>
          <button
            className="rail-active"
            title="Конструктор"
            aria-label="Конструктор плана"
            onClick={() => {
              setPreview(false);
              setTab('catalog');
            }}
          >
            <Layers />
          </button>
          <button
            className="rail-bottom"
            title="Горячие клавиши"
            aria-label="Горячие клавиши"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={17} />
          </button>
        </nav>
        <aside className="library-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ПРОСТРАНСТВО</span>
              <h1>Конструктор</h1>
            </div>
          </div>
          <div className="office-caption">
            <Building2 size={14} />
            <span>{office.name}</span>
          </div>
          <div className="library-tabs">
            <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>
              Каталог
            </button>
            <button className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>
              Объекты <span>{floor.elements.length}</span>
            </button>
          </div>
          <label className="library-search">
            <Search size={14} />
            <input
              ref={searchRef}
              aria-label="Поиск объектов"
              placeholder="Найти объект…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </label>
          {tab === 'catalog' ? (
            <>
              <div className="section-title">СОЗДАТЬ НА ПЛАНЕ</div>
              <div className="draft-tools">
                <button
                  className={tool === 'wall' ? 'active' : ''}
                  onClick={() => {
                    setPreview(false);
                    setTool('wall');
                  }}
                >
                  <BrickWall size={20} />
                  <span>Стена</span>
                  <kbd>W</kbd>
                </button>
                <button
                  className={tool === 'room' ? 'active' : ''}
                  onClick={() => {
                    setPreview(false);
                    setSelectedId(null);
                    setTool('room');
                  }}
                >
                  <SquareDashed size={20} />
                  <span>Помещение</span>
                  <kbd>R</kbd>
                </button>
              </div>
              <div className="section-title">
                МЕБЕЛЬ И ОСНАЩЕНИЕ <span>{CATALOG.length}</span>
              </div>
              <div className="category-chips">
                <button
                  className={category === 'all' ? 'active' : ''}
                  onClick={() => setCategory('all')}
                >
                  Всё
                </button>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    className={category === key ? 'active' : ''}
                    onClick={() => setCategory(key as CatalogCategory)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="asset-grid">
                {filtered.map((item) => (
                  <button
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
                  >
                    <div className="asset-picture">
                      <img src={item.asset} alt="" draggable={false} />
                      {item.seats > 1 && <small>{item.seats} места</small>}
                    </div>
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
              {!filtered.length && (
                <div className="catalog-empty">
                  <Search size={22} />
                  <p>Такого объекта пока нет</p>
                  <button
                    onClick={() => {
                      setSearch('');
                      setCategory('all');
                    }}
                  >
                    Сбросить поиск
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="object-list">
              {list.map((item) => (
                <button
                  key={item.id}
                  className={'object-row' + (selectedId === item.id ? ' active' : '')}
                  onClick={() => {
                    setSelectedId(item.id);
                    setTool('select');
                    setPreview(false);
                  }}
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
                </button>
              ))}
            </div>
          )}
          <button className="underlay-shortcut" onClick={() => setUnderlayOpen(true)}>
            <ImagePlus size={16} />
            <span>
              Подложка плана
              <small>{floor.background ? floor.background.name : 'Загрузить изображение'}</small>
            </span>
            <Settings2 size={14} />
          </button>
        </aside>
        <main className="canvas-area">
          <div className="canvas-heading">
            <div>
              <h2>
                {floor.name}
                <span>{preview ? 'Предпросмотр' : 'Редактирование плана'}</span>
              </h2>
              <p>
                {roomCount} помещения <i>·</i> {deskCount} рабочих мест <i>·</i>{' '}
                {floor.elements.length} объектов
              </p>
            </div>
            <div className="canvas-heading-actions">
              <button
                className="icon-button"
                title="Настройки этажа"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={16} />
              </button>
              <button
                className={'secondary-button' + (underlayOpen ? ' active' : '')}
                aria-expanded={underlayOpen}
                onClick={() => setUnderlayOpen(!underlayOpen)}
              >
                <ImagePlus size={15} />
                Подложка
              </button>
            </div>
          </div>
          {underlayOpen && (
            <UnderlayPanel
              key={floor.id}
              floor={floor}
              onChange={(patch) => {
                if (patch.visible === false) setUnderlayEditing(false);
                changeFloor((current) =>
                  current.background
                    ? { ...current, background: { ...current.background, ...patch } }
                    : current,
                );
              }}
              onUpload={() => uploadRef.current?.click()}
              onRemove={() => {
                setUnderlayEditing(false);
                changeFloor((current) => ({ ...current, background: undefined }));
              }}
              onClose={() => setUnderlayOpen(false)}
              onEdit={() => {
                setTool('select');
                setSelectedId(null);
                setPreview(false);
                setUnderlayEditing(true);
                setGrid(true);
                setUnderlayOpen(false);
              }}
            />
          )}
          <div
            className={
              'editor-viewport ' +
              (tool === 'pan' || spacePressed
                ? 'cursor-pan'
                : tool === 'select'
                  ? ''
                  : 'cursor-place')
            }
            ref={viewportRef}
          >
            <div className="floor-switcher" role="group" aria-label="Этажи">
              <div className="floor-switcher-label">ЭТАЖ</div>
              <div className="floor-buttons">
                {config.floors.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={'floor-button' + (item.id === floor.id ? ' is-active' : '')}
                    title={item.name}
                    aria-label={'Перейти на ' + item.name}
                    aria-pressed={item.id === floor.id}
                    onClick={() => selectFloor(item.id)}
                  >
                    {item.name.match(/^-?\d+/)?.[0] || index + 1}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="floor-add"
                title={config.floors.length >= 40 ? 'Добавлено 40 этажей' : 'Добавить этаж'}
                aria-label="Добавить этаж"
                disabled={config.floors.length >= 40}
                onClick={addFloor}
              >
                <Plus size={17} />
              </button>
            </div>
            <svg
              ref={svgRef}
              className="editor-svg"
              aria-label="План офиса"
              viewBox={[
                camera.x,
                camera.y,
                size.width / camera.zoom,
                size.height / camera.zoom,
              ].join(' ')}
              onPointerDown={startPointer}
              onPointerMove={movePointer}
              onPointerUp={finishPointer}
              onPointerCancel={() => {
                if (dragRef.current) setConfig(dragRef.current.before);
                dragRef.current = null;
                setGhost(null);
              }}
              onPointerLeave={() => setCursor(null)}
              onContextMenu={(event) => event.preventDefault()}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const type = event.dataTransfer.getData('application/x-office-asset');
                if (type) insertAsset(type, pointFrom(event.clientX, event.clientY));
              }}
            >
              <defs>
                <filter id="floor-shadow" x="-15%" y="-15%" width="130%" height="140%">
                  <feDropShadow
                    dx="0"
                    dy="14"
                    stdDeviation="24"
                    floodColor="#6c80a0"
                    floodOpacity=".13"
                  />
                </filter>
              </defs>
              <rect
                x={camera.x}
                y={camera.y}
                width={size.width / camera.zoom}
                height={size.height / camera.zoom}
                fill="#f4f6fb"
              />
              <rect
                x="0"
                y="0"
                width={floor.width}
                height={floor.height}
                rx="3"
                fill="#fff"
                filter="url(#floor-shadow)"
              />
              {floor.background?.visible && (
                <image
                  className="plan-underlay"
                  href={floor.background.src}
                  x={underlay.x}
                  y={underlay.y}
                  width={underlay.width}
                  height={underlay.height}
                  preserveAspectRatio="xMidYMid meet"
                  opacity={floor.background.opacity}
                  pointerEvents="none"
                />
              )}
              {floor.elements
                .filter((item) => item.kind === 'room')
                .map((room) => (
                  <g
                    key={room.id}
                    data-element-id={room.id}
                    role="button"
                    aria-label={room.name}
                    transform={
                      'rotate(' +
                      room.rotation +
                      ' ' +
                      (room.x + room.width / 2) +
                      ' ' +
                      (room.y + room.height / 2) +
                      ')'
                    }
                    className="plan-object room-object"
                  >
                    <rect
                      x={room.x}
                      y={room.y}
                      width={room.width}
                      height={room.height}
                      fill={room.color}
                      fillOpacity={floor.background?.visible ? 0.45 : 0.8}
                    />
                  </g>
                ))}
              <g
                fill="none"
                stroke="#536174"
                strokeWidth={WALL_THICKNESS}
                strokeLinecap="butt"
                strokeLinejoin="round"
                pointerEvents="none"
              >
                {walls.map((wall, index) => (
                  <path
                    key={index}
                    d={'M' + wall.x1 + ' ' + wall.y1 + 'L' + wall.x2 + ' ' + wall.y2}
                  />
                ))}
              </g>
              {floor.elements
                .filter((item) => item.kind === 'wall')
                .map((item) => {
                  const [start, end] = getWallEndpoints(item);
                  return (
                    <g
                      key={item.id}
                      data-element-id={item.id}
                      role="button"
                      aria-label={item.name}
                      className="wall-hit"
                    >
                      <path
                        d={'M' + start.x + ' ' + start.y + 'L' + end.x + ' ' + end.y}
                        stroke="transparent"
                        strokeWidth={Math.max(WALL_THICKNESS, 14 / camera.zoom)}
                        fill="none"
                        pointerEvents="stroke"
                      />
                    </g>
                  );
                })}
              {floor.elements
                .filter((item) => item.kind === 'desk' || item.kind === 'furniture')
                .map((item) => {
                  const asset = getCatalogItem(item.type);
                  return (
                    <g
                      key={item.id}
                      data-element-id={item.id}
                      role="button"
                      aria-label={item.name}
                      transform={
                        'rotate(' +
                        item.rotation +
                        ' ' +
                        (item.x + item.width / 2) +
                        ' ' +
                        (item.y + item.height / 2) +
                        ')'
                      }
                      className={'plan-object ' + (item.locked ? 'object-locked' : '')}
                    >
                      <title>{item.name}</title>
                      {asset ? (
                        <image
                          href={asset.asset}
                          x={item.x}
                          y={item.y}
                          width={item.width}
                          height={item.height}
                          preserveAspectRatio="none"
                          pointerEvents="none"
                        />
                      ) : (
                        <rect
                          x={item.x}
                          y={item.y}
                          width={item.width}
                          height={item.height}
                          fill="#d5ddeb"
                          rx="8"
                        />
                      )}
                      <rect
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        fill="transparent"
                      />
                      {item.kind === 'desk' && item.bookable && (
                        <circle
                          cx={item.x + item.width - 5}
                          cy={item.y + 4}
                          r="6"
                          fill="#7398e7"
                          stroke="white"
                          strokeWidth="2"
                          pointerEvents="none"
                        />
                      )}
                    </g>
                  );
                })}
              {grid && !preview && (
                <CanvasGrid
                  x={camera.x}
                  y={camera.y}
                  width={size.width / camera.zoom}
                  height={size.height / camera.zoom}
                  zoom={camera.zoom}
                  step={gridStep}
                  editing={underlayEditing}
                />
              )}
              <g data-room-label-layer="constructor" pointerEvents="none">
                {floor.elements
                  .filter((item) => item.kind === 'room')
                  .map((room) => (
                    <RoomLabel
                      key={room.id}
                      room={room}
                      zoom={camera.zoom}
                      subtitle={
                        room.bookable
                          ? (room.shared ? 'Совместное · ' : 'Переговорная · ') +
                            getRoomCapacity(room) +
                            ' мест'
                          : 'Общая зона'
                      }
                    />
                  ))}
              </g>
              {!preview && selected?.kind === 'wall' && (
                <g className="wall-selection" data-element-id={selected.id}>
                  {(() => {
                    const [start, end] = getWallEndpoints(selected);
                    return (
                      <>
                        <path
                          d={'M' + start.x + ' ' + start.y + 'L' + end.x + ' ' + end.y}
                          fill="none"
                          stroke="#7586e5"
                          strokeWidth={2 / camera.zoom}
                          pointerEvents="none"
                        />
                        {!selected.locked &&
                          [start, end].map((point, index) => (
                            <g
                              key={index}
                              data-handle={index === 0 ? 'wall-start' : 'wall-end'}
                              role="button"
                              aria-label={index === 0 ? 'Начало стены' : 'Конец стены'}
                              className="wall-endpoint-handle"
                            >
                              <circle
                                cx={point.x}
                                cy={point.y}
                                r={12 / camera.zoom}
                                fill="transparent"
                              />
                              <circle
                                cx={point.x}
                                cy={point.y}
                                r={5 / camera.zoom}
                                fill="white"
                                stroke="#697cdb"
                                strokeWidth={1.5 / camera.zoom}
                                pointerEvents="none"
                              />
                            </g>
                          ))}
                        <text
                          x={(start.x + end.x) / 2}
                          y={(start.y + end.y) / 2 - 12 / camera.zoom}
                          textAnchor="middle"
                          fontSize={11 / camera.zoom}
                          fill="#677bc7"
                          stroke="white"
                          strokeWidth={3 / camera.zoom}
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {round(Math.hypot(end.x - start.x, end.y - start.y))} ед.
                        </text>
                      </>
                    );
                  })()}
                </g>
              )}
              {!preview && selected && selected.kind !== 'wall' && (
                <g
                  data-element-id={selected.id}
                  transform={selectedTransform}
                  className="selection-bounds"
                >
                  <rect
                    x={selected.x - 4}
                    y={selected.y - 4}
                    width={selected.width + 8}
                    height={selected.height + 8}
                    rx="3"
                    fill="none"
                    stroke="#5a6de3"
                    strokeWidth={1.5 / camera.zoom}
                    pointerEvents="none"
                  />
                  {!selected.locked && (
                    <>
                      <line
                        x1={selected.x + selected.width / 2}
                        y1={selected.y - 4}
                        x2={selected.x + selected.width / 2}
                        y2={selected.y - 29 / camera.zoom}
                        stroke="#7f8fe6"
                        strokeWidth={1 / camera.zoom}
                      />
                      <circle
                        data-handle="rotate"
                        cx={selected.x + selected.width / 2}
                        cy={selected.y - 29 / camera.zoom}
                        r={5 / camera.zoom}
                        fill="white"
                        stroke="#5a6de3"
                        strokeWidth={1.5 / camera.zoom}
                        className="rotate-handle"
                      />
                      <rect
                        data-handle="resize"
                        x={selected.x + selected.width - 4 / camera.zoom}
                        y={selected.y + selected.height - 4 / camera.zoom}
                        width={8 / camera.zoom}
                        height={8 / camera.zoom}
                        rx={2 / camera.zoom}
                        fill="white"
                        stroke="#5a6de3"
                        strokeWidth={1.5 / camera.zoom}
                        className="resize-handle"
                      />
                    </>
                  )}
                </g>
              )}
              {wallSnapMatch?.matched && !preview && (
                <g pointerEvents="none" className="wall-snap-marker">
                  <circle
                    cx={wallSnapMatch.point.x}
                    cy={wallSnapMatch.point.y}
                    r={7 / camera.zoom}
                    fill="white"
                    fillOpacity=".85"
                    stroke="#3baf91"
                    strokeWidth={1.5 / camera.zoom}
                  />
                  <circle
                    cx={wallSnapMatch.point.x}
                    cy={wallSnapMatch.point.y}
                    r={2 / camera.zoom}
                    fill="#3baf91"
                  />
                </g>
              )}
              {underlayEditing && floor.background?.visible && !preview && (
                <g className="underlay-edit-bounds" aria-label="Редактирование подложки">
                  <rect
                    data-underlay-action="move"
                    x={underlay.x}
                    y={underlay.y}
                    width={underlay.width}
                    height={underlay.height}
                    fill="transparent"
                    stroke="#697cdb"
                    strokeWidth={1.5 / camera.zoom}
                    strokeDasharray={5 / camera.zoom + ' ' + 4 / camera.zoom}
                    className="underlay-move-target"
                  />
                  {(['nw', 'ne', 'se', 'sw'] as UnderlayCorner[]).map((corner) => {
                    const x = underlay.x + (corner.includes('e') ? underlay.width : 0),
                      y = underlay.y + (corner.includes('s') ? underlay.height : 0);
                    return (
                      <g
                        key={corner}
                        data-underlay-action={corner}
                        role="button"
                        aria-label={'Изменить размер подложки ' + corner}
                        style={{
                          cursor:
                            corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                        }}
                      >
                        <rect
                          x={x - 12 / camera.zoom}
                          y={y - 12 / camera.zoom}
                          width={24 / camera.zoom}
                          height={24 / camera.zoom}
                          fill="transparent"
                        />
                        <rect
                          x={x - 5 / camera.zoom}
                          y={y - 5 / camera.zoom}
                          width={10 / camera.zoom}
                          height={10 / camera.zoom}
                          rx={2 / camera.zoom}
                          fill="white"
                          stroke="#697cdb"
                          strokeWidth={1.5 / camera.zoom}
                          pointerEvents="none"
                        />
                      </g>
                    );
                  })}
                </g>
              )}
              {underlayEditing && floor.background?.visible && !preview && (
                <ScaleChair
                  key={floor.id}
                  source={floor.background.src}
                  underlay={underlay}
                  viewport={{
                    x: camera.x,
                    y: camera.y,
                    width: size.width / camera.zoom,
                    height: size.height / camera.zoom,
                  }}
                  zoom={camera.zoom}
                  panEnabled={spacePressed || tool === 'pan'}
                  toWorld={pointFrom}
                />
              )}
              {ghost && (
                <g pointerEvents="none">
                  <rect
                    transform={
                      'rotate(' +
                      ghost.rotation +
                      ' ' +
                      (ghost.x + ghost.width / 2) +
                      ' ' +
                      (ghost.y + ghost.height / 2) +
                      ')'
                    }
                    x={ghost.x}
                    y={ghost.y}
                    width={ghost.width}
                    height={ghost.height}
                    fill={ghost.kind === 'wall' ? '#657697' : '#8396ec'}
                    fillOpacity=".23"
                    stroke="#657bea"
                    strokeWidth={1.5 / camera.zoom}
                    strokeDasharray={6 / camera.zoom + ' ' + 4 / camera.zoom}
                  />
                  <text
                    x={ghost.x}
                    y={ghost.y - 10 / camera.zoom}
                    fill="#6375c0"
                    fontSize={11 / camera.zoom}
                  >
                    {ghost.kind === 'wall'
                      ? Math.round(ghost.width) + ' ед.'
                      : Math.round(ghost.width) + ' × ' + Math.round(ghost.height)}
                  </text>
                </g>
              )}
              {itemTool && cursor && !dragRef.current && !preview && (
                <image
                  href={itemTool.asset}
                  x={cursor.x - itemTool.width / 2}
                  y={cursor.y - itemTool.height / 2}
                  width={itemTool.width}
                  height={itemTool.height}
                  opacity=".55"
                  pointerEvents="none"
                />
              )}
            </svg>
            {!floor.elements.length && !floor.background && (
              <div className="empty-floor">
                <div>
                  <ImagePlus size={28} />
                </div>
                <h3>Здесь будет ваш офис</h3>
                <p>
                  Загрузите план этажа или начните с помещения.
                  <br />
                  Объекты можно добавлять из каталога слева.
                </p>
                <button className="primary-button" onClick={() => uploadRef.current?.click()}>
                  <Upload size={16} />
                  Загрузить план
                </button>
              </div>
            )}
            {underlayEditing ? (
              <div className="underlay-edit-toolbar">
                <div>
                  <ImagePlus size={15} />
                  <span>
                    <b>Редактирование подложки</b>
                    <small>Сравните масштаб со стулом · Тяните за углы</small>
                  </span>
                </div>
                <button onClick={() => setUnderlayEditing(false)}>
                  <Check size={15} />
                  Готово
                </button>
              </div>
            ) : (
              <div className="canvas-mode-badge">
                <span />
                {preview ? 'Предпросмотр пространства' : actionTitle}
                {tool.startsWith('asset:') && (
                  <button onClick={() => setTool('select')}>
                    Esc <X size={12} />
                  </button>
                )}
              </div>
            )}
            {!preview && selected && (
              <div className="selection-actions">
                <button title="Дублировать · Ctrl D" onClick={duplicateSelected}>
                  <Copy size={15} />
                </button>
                <button
                  title="Повернуть · R"
                  disabled={selected.locked}
                  onClick={() => updateSelected({ rotation: (selected.rotation + 90) % 360 })}
                >
                  <RotateCw size={15} />
                </button>
                <button
                  title="Удалить · Delete"
                  disabled={selected.locked}
                  onClick={removeSelected}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
          <div className="floating-toolbar">
            <button
              title="Выбрать · V"
              aria-label="Инструмент выбора"
              className={tool === 'select' ? 'tool-active' : ''}
              onClick={() => setTool('select')}
            >
              <MousePointer2 size={18} />
            </button>
            <button
              title="Переместить холст · H / Пробел"
              className={tool === 'pan' ? 'tool-active' : ''}
              onClick={() => setTool('pan')}
            >
              <Hand size={18} />
            </button>
            <span />
            <button
              title="Отменить · Ctrl Z"
              aria-label="Отменить"
              disabled={!undoRef.current.length}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              title="Повторить · Ctrl Shift Z"
              aria-label="Повторить"
              disabled={!redoRef.current.length}
              onClick={redo}
            >
              <Redo2 size={17} />
            </button>
            <span />
            <button
              title="Привязка к сетке"
              className={snapEnabled ? 'tool-active subtle' : ''}
              onClick={() => setSnapEnabled(!snapEnabled)}
            >
              <Magnet size={17} />
            </button>
            <button
              title="Показать сетку"
              className={grid ? 'tool-active subtle' : ''}
              onClick={() => setGrid(!grid)}
            >
              <Grid2X2 size={17} />
            </button>
            <span />
            <button
              title="Уменьшить масштаб"
              aria-label="Уменьшить масштаб"
              onClick={() => zoomAt(0.8)}
            >
              <Minus size={16} />
            </button>
            <b>{Math.round(camera.zoom * 100)}%</b>
            <button
              title="Увеличить масштаб"
              aria-label="Увеличить масштаб"
              onClick={() => zoomAt(1.25)}
            >
              <Plus size={16} />
            </button>
            <button title="Вписать план" aria-label="Вписать план" onClick={fit}>
              <Maximize size={17} />
            </button>
          </div>
          <div className="canvas-footer">
            <span>
              <i />
              {preview ? 'Предпросмотр' : 'Режим конструктора'}
            </span>
            <span>
              {cursor
                ? Math.round(cursor.x) + ', ' + Math.round(cursor.y)
                : 'Привязка ' + GRID_STEP + ' ед.'}
              <em>·</em>
              {grid ? 'Линии ' + gridStep + ' ед.' : 'Сетка скрыта'}
            </span>
            <span>1:{round(1 / camera.zoom)}</span>
          </div>
        </main>
        {!preview && (
          <Inspector
            element={selected}
            floor={floor}
            onChange={updateSelected}
            onDelete={removeSelected}
            onDuplicate={duplicateSelected}
            onSelect={setSelectedId}
            onReorder={(direction) => {
              if (!selected) return;
              changeFloor((current) => ({
                ...current,
                elements:
                  direction === 'front'
                    ? [...current.elements.filter((item) => item.id !== selected.id), selected]
                    : [selected, ...current.elements.filter((item) => item.id !== selected.id)],
              }));
            }}
          />
        )}
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => void loadBackground(event.target.files?.[0])}
      />
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          {toast}
        </div>
      )}
      {(settings || help) && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSettings(false);
              setHelp(false);
              setUnderlayOpen(false);
            }
          }}
        >
          <section className="modal">
            <button
              className="modal-close icon-button"
              aria-label="Закрыть"
              onClick={() => {
                setSettings(false);
                setHelp(false);
                setUnderlayOpen(false);
              }}
            >
              <X size={18} />
            </button>
            <div className="modal-scroll">
              {help ? (
                <>
                  <span className="eyebrow">БЫСТРЕЕ С КЛАВИАТУРОЙ</span>
                  <h2>Каждому действию — свой жест</h2>
                  <div className="shortcut-list">
                    {[
                      ['V', 'Выбрать объект'],
                      ['H / Пробел', 'Перемещение холста'],
                      ['W', 'Нарисовать стену'],
                      ['R', 'Помещение / поворот объекта'],
                      ['Delete', 'Удалить выбранное'],
                      ['Ctrl D', 'Дублировать'],
                      ['Ctrl Z', 'Отменить'],
                      ['Ctrl Shift Z', 'Повторить'],
                      ['Esc', 'Завершить действие'],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <span>{label}</span>
                        <kbd>{key}</kbd>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <span className="eyebrow">ПЛАН ОФИСА</span>
                  <h2>Настройки этажа</h2>
                  <div className="field-grid">
                    <label className="field">
                      <span className="field-label">Название этажа</span>
                      <input
                        className="input"
                        value={floor.name}
                        onChange={(event) =>
                          changeFloor((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Размер плана</span>
                      <span className="input muted">
                        {floor.width} × {floor.height}
                      </span>
                    </label>
                  </div>
                  <button className="primary-button modal-done" onClick={() => setSettings(false)}>
                    <Check size={16} />
                    Готово
                  </button>
                  <button
                    className="danger-button remove-floor"
                    disabled={config.floors.length < 2}
                    onClick={removeFloor}
                  >
                    <Trash2 size={14} />
                    Удалить этот этаж
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
