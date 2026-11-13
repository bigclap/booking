import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CATALOG, getCatalogItem } from '../lib/catalog';
import type { CatalogCategory } from '../lib/catalog';
import { createBlankFloor, parseConfig, uid } from '../lib/officeModel';
import type { Floor, OfficeConfig, PlanElement } from '../lib/officeModel';
import { useOffices } from '../hooks/OfficeProvider';
import { useAuth } from '../../auth/hooks';
import { ApiError } from '../../shared/api';
import { GRID_STEP, getVisibleGridStep } from '../lib/grid';
import { getWallEndpoints, wallFromEndpoints, snapWallPoint } from '../lib/wallEditorGeometry';
import { getWallSegments, WALL_THICKNESS } from '../lib/wallGeometry';
import { resizeFromCorner, transformRoomChildren } from '../lib/editorGeometry';
import { getUnderlayBounds, resizeUnderlay } from '../lib/underlayGeometry';
import type { UnderlayCorner } from '../lib/underlayGeometry';
import { COLORS, clone, round, inside, assignRoom, reconcile } from '../lib/planEditing';
import type { Point, Camera, Tool, DragState } from '../lib/planEditorTypes';
const PLAN_DRAFT_PREFIX = 'plan-room.http-plan-draft.v1.';
type PlanDraft = { floors: Floor[]; savedAt: string; baseUpdatedAt: string; baseRevision?: number };
type Recovery = { draft?: PlanDraft; error?: string } | null;
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
export function useOfficePlanEditor(office: OfficeConfig) {
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

  return {
    office,
    config,
    setConfig,
    recovery,
    setSaveTick,
    saveError,
    saveConflict,
    draftWarning,
    floor,
    selectedId,
    setSelectedId,
    selected,
    underlayEditing,
    setUnderlayEditing,
    tool,
    setTool,
    tab,
    setTab,
    category,
    setCategory,
    search,
    setSearch,
    snapEnabled,
    setSnapEnabled,
    grid,
    setGrid,
    preview,
    setPreview,
    settings,
    setSettings,
    underlayOpen,
    setUnderlayOpen,
    help,
    setHelp,
    toast,
    saveState,
    camera,
    size,
    ghost,
    setGhost,
    cursor,
    setCursor,
    spacePressed,
    viewportRef,
    svgRef,
    uploadRef,
    searchRef,
    dragRef,
    undoRef,
    redoRef,
    roomCount,
    deskCount,
    underlay,
    gridStep,
    walls,
    changeFloor,
    undo,
    redo,
    resolveRecovery,
    fit,
    zoomAt,
    pointFrom,
    insertAsset,
    removeSelected,
    duplicateSelected,
    updateSelected,
    startPointer,
    movePointer,
    finishPointer,
    selectFloor,
    addFloor,
    removeFloor,
    loadBackground,
    filtered,
    list,
    itemTool,
    wallSnapMatch,
    selectedTransform,
    actionTitle,
  };
}
export type OfficePlanEditor = ReturnType<typeof useOfficePlanEditor>;
