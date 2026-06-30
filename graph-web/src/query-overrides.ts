export type QueryOverrideState = {
  readonly depthOverridden: boolean;
  readonly sourcesOverridden: boolean;
  markDepthOverridden: () => void;
  markSourcesOverridden: () => void;
  resetForRun: (recordHistory: boolean) => void;
};

export function createQueryOverrideState(): QueryOverrideState {
  let depthOverridden = false;
  let sourcesOverridden = false;

  return {
    get depthOverridden() {
      return depthOverridden;
    },
    get sourcesOverridden() {
      return sourcesOverridden;
    },
    markDepthOverridden() {
      depthOverridden = true;
    },
    markSourcesOverridden() {
      sourcesOverridden = true;
    },
    resetForRun(recordHistory: boolean) {
      if (!recordHistory) return;
      depthOverridden = false;
      sourcesOverridden = false;
    },
  };
}
