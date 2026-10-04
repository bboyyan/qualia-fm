/**
 * UI state only (tab, sheet, toast, draft, settings). Playback state lives in the engine and is
 * never mutated from here. Browser Back closes the open sheet first, then returns to the
 * previous tab (docs/02 導覽規則).
 */
import { create } from 'zustand';
import type { Capabilities, MockScenario, SeedKind } from '@qualia/contracts';
import type { ToastData } from '../ui/Toast';

export type Tab = 'home' | 'listen' | 'settings';
export type SheetKind = 'bridge' | 'queue' | 'tune' | 'environment';

export interface Settings {
  djEnabled: boolean;
  djLength: 'short' | 'standard';
}

export interface Draft {
  kind: SeedKind;
  text: string;
  artist: string;
}

const SETTINGS_KEY = 'qfm.settings.v1';
const DEFAULT_SETTINGS: Settings = { djEnabled: true, djLength: 'short' };

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      djEnabled: typeof parsed.djEnabled === 'boolean' ? parsed.djEnabled : DEFAULT_SETTINGS.djEnabled,
      djLength: parsed.djLength === 'standard' ? 'standard' : 'short',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings | null): void {
  try {
    if (settings) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    else window.localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // Storage can be unavailable (private mode); settings then last for this page only.
  }
}

interface NavOptions {
  fromHistory?: boolean;
}

export interface AppState {
  tab: Tab;
  sheet: SheetKind | null;
  toast: ToastData | null;
  live: string;
  draft: Draft;
  settings: Settings;
  mockScenario: MockScenario;
  capabilities: Capabilities | null;
  boot: 'loading' | 'ready' | 'error';
  setTab: (tab: Tab, options?: NavOptions) => void;
  openSheet: (sheet: SheetKind) => void;
  closeSheet: (options?: NavOptions) => void;
  showToast: (message: string, action?: ToastData['action']) => void;
  dismissToast: (id: number) => void;
  announce: (message: string) => void;
  setDraft: (patch: Partial<Draft>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  setMockScenario: (scenario: MockScenario) => void;
  setBoot: (boot: AppState['boot'], capabilities?: Capabilities | null) => void;
}

let toastId = 0;

export const useAppStore = create<AppState>()((set, get) => ({
  tab: 'home',
  sheet: null,
  toast: null,
  live: '',
  draft: { kind: 'feeling', text: '', artist: '' },
  settings: loadSettings(),
  mockScenario: 'five',
  capabilities: null,
  boot: 'loading',
  setTab: (tab, options = {}) => {
    if (get().tab === tab) return;
    if (!options.fromHistory) window.history.pushState({ qfmTab: tab }, '');
    set({ tab });
    window.scrollTo({ top: 0 });
  },
  openSheet: (sheet) => {
    if (get().sheet === sheet) return;
    if (get().sheet === null) window.history.pushState({ qfmSheet: sheet, qfmTab: get().tab }, '');
    set({ sheet });
  },
  closeSheet: (options = {}) => {
    if (get().sheet === null) return;
    set({ sheet: null });
    const state = window.history.state as { qfmSheet?: string } | null;
    if (!options.fromHistory && state?.qfmSheet) window.history.back();
  },
  showToast: (message, action) => set({ toast: { id: (toastId += 1), message, action } }),
  dismissToast: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },
  announce: (message) => set({ live: message }),
  setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
  },
  resetSettings: () => {
    saveSettings(null);
    set({ settings: DEFAULT_SETTINGS });
  },
  setMockScenario: (mockScenario) => set({ mockScenario }),
  setBoot: (boot, capabilities = null) => set({ boot, capabilities }),
}));
