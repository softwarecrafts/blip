/**
 * Service-adapter registry.
 *
 * Each platform registers a service adapter here. The background orchestrator
 * iterates the enabled ones — it has no per-platform knowledge beyond this map.
 *
 * To add a platform (e.g. ChatGPT): write adapters/<id>.js implementing the
 * same interface, import it here, add it to ADAPTERS, add a DOM entry in
 * content.js, and (per the optional-permissions plan) request its host when
 * the user enables it in Options.
 */
import { claudeAdapter } from './claude.js';

export const ADAPTERS = {
  [claudeAdapter.id]: claudeAdapter,
};

/** Adapters the user has switched on (settings.platforms[id] === true). */
export function enabledAdapters(settings, registry = ADAPTERS) {
  return Object.values(registry).filter((a) => settings.platforms?.[a.id] === true);
}
