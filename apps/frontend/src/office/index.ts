export type { ElementKind, PlanElement, Floor, OfficeConfig } from './lib/officeModel';
export {
  getRoomCapacity,
  createBlankFloor,
  parseConfig,
  serializeConfig,
  uid,
} from './lib/officeModel';
export type { CatalogCategory, CatalogItem } from './lib/catalog';
export { CATALOG, CATEGORY_LABELS, getCatalogItem } from './lib/catalog';
