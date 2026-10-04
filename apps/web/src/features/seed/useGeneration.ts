import { useSyncExternalStore } from 'react';
import type { GenerationController, GenerationState } from './generationController';

export function useGeneration(controller: GenerationController): GenerationState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}
