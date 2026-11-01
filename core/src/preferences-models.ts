import { z } from 'zod';

export enum ThemeMode {
    Light = 'light',
    Dark = 'dark',
    Auto = 'auto'
}

export enum FileSort {
    NameAscending = 'name-asc',
    NameDescending = 'name-desc',
    ModifiedDescending = 'modified-desc',
    ModifiedAscending = 'modified-asc'
}

export enum FileLayout {
    List = 'list',
    Grid = 'grid'
}

export const DEFAULT_FILE_LAYOUT = FileLayout.List;
export const FileLayoutSchema = z.enum(FileLayout);

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
export const MAX_REFRESH_INTERVAL_SECONDS = 86_400;
export const DEFAULT_CONCURRENT_WORKERS = 8;
export const MAX_CONCURRENT_WORKERS = 32;

export const ThemeSchema = z.enum(ThemeMode);
export const FileSortSchema = z.enum(FileSort);
export const RefreshIntervalSchema = z.int().min(0).max(MAX_REFRESH_INTERVAL_SECONDS);
export const ConcurrentWorkersSchema = z.int().min(1).max(MAX_CONCURRENT_WORKERS);
