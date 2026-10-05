/** 裝置狀態小元件的資料來源：由 Spotify 輸出（路徑 P／C）回報，UI 只讀。 */
import { useSyncExternalStore } from 'react';
import type { SpotifyDeviceStatus } from '../../audio/spotify/types';

export class DeviceStatusStore {
  private status: SpotifyDeviceStatus | null = null;
  private readonly listeners = new Set<() => void>();

  get = (): SpotifyDeviceStatus | null => this.status;

  set = (status: SpotifyDeviceStatus | null): void => {
    this.status = status;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const deviceStatus = new DeviceStatusStore();

export function useDeviceStatus(): SpotifyDeviceStatus | null {
  return useSyncExternalStore(deviceStatus.subscribe, deviceStatus.get, deviceStatus.get);
}
