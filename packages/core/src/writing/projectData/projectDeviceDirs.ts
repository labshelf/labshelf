// Declares the device-local places, outside the synced library, where project data keeps its files.
export interface ProjectDeviceDirs {
  /** The list of project folders that live outside the library. */
  readonly projectRegistryPath: string;
  /** Holds one build folder per project id. */
  readonly buildCacheDir: string;
  /** Per project text file, the content last known to be common with other devices. */
  readonly mergeBasesDir: string;
}
