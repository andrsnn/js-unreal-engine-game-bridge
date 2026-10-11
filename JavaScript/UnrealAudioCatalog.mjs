// Optional host integration utility. Does not change scene protocol v1 or take
// ownership of gameplay, preferences, source voice lifetimes or adaptive music.
export function createUnrealAudioCatalog(registry) {
  if (registry?.version !== 1 || !registry.assets) throw Error('Invalid Unreal audio registry');
  const resolve = key => {
    const entry = registry.assets[key];
    if (!entry?.sound) throw Error('Unregistered sound key: ' + key);
    return entry;
  };
  return {
    resolve,
    control(key) {return registry.eventControls?.[key] ?? null;},
    mergeAssets(existing = {}) {
      const merged = {...existing};
      for (const [key, entry] of Object.entries(registry.assets)) merged[key] = {...existing[key], ...entry};
      return merged;
    },
    oneShot(key, {volume = 1, pitch = 1, position, parameters = {}} = {}) {
      const entry = resolve(key);
      // Current ApplyScene sound events are fire-and-forget. A looping cue
      // would otherwise remain audible forever without an owning component.
      if (entry.loop) throw Error('Loop requires a persistent stoppable host voice: ' + key);
      if (!Number.isFinite(volume) || volume < 0 || !Number.isFinite(pitch) || pitch <= 0) throw Error('Invalid sound level or pitch');
      if (position && (position.length !== 3 || position.some(value => !Number.isFinite(value)))) throw Error('Invalid sound position');
      return {kind: 'sound', key, volume, pitch, ...(position ? {position: [...position]} : {}), parameters: {...parameters}};
    }
  };
}
