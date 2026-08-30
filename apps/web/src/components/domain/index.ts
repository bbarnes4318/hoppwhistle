/**
 * The domain component layer.
 *
 * These compose the shadcn primitives in src/components/ui and are the only
 * things pages should reach for. If a page is hand-rolling a card, a table or
 * an empty state, that is the bug this layer exists to prevent.
 */

export { DataTable, type Column, type DataTableProps } from './data-table';
export {
  DurationBar,
  formatDurationSeconds,
  resolveDurationState,
  type DurationBarProps,
  type DurationBarState,
} from './duration-bar';
export { EmptyState, type EmptyStateProps } from './empty-state';
export {
  FilterBar,
  type DateRangeValue,
  type FilterBarProps,
  type FilterOption,
  type FilterSelect,
} from './filter-bar';
export {
  LiveStrip,
  type LiveConnectionState,
  type LiveMetric,
  type LiveStripProps,
} from './live-strip';
export { MoneyCell, formatMoney, type MoneyCellProps } from './money-cell';
export {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  type PanelBodyProps,
  type PanelHeaderProps,
} from './panel';
export { Pagination, type PaginationProps } from './pagination';
export { PhoneCell, formatPhone, type PhoneCellProps } from './phone-cell';
export { RecordingPlayer, type RecordingPlayerProps } from './recording-player';
export { SavedViews, useSavedViews, type SavedView, type SavedViewsProps } from './saved-views';
export { DrawerField, DrawerSection, SheetDrawer, type SheetDrawerProps } from './sheet-drawer';
export { StatTile, StatTileRow, type StatTileProps } from './stat-tile';
export { StatusChip, type StatusChipProps } from './status-chip';
export { ThemeScope, useThemeScope, type ThemeScopeProps } from './theme-scope';
export {
  DEFAULT_TONE,
  ENUM_TONE,
  formatEnumLabel,
  resolveTone,
  type StatusTone,
} from './status-tones';
