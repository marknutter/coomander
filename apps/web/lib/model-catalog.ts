/**
 * Tiered AI model catalog — RE-EXPORT shim.
 *
 * The catalog itself now lives in `@coomander/core` (`packages/core/src/chat/
 * model-catalog.ts`) so the web SSE chat engine and the agent WebSocket engine
 * import ONE copy and can never drift (epic #483). This file preserves the
 * existing `@/lib/model-catalog` import path used across the web app (admin
 * model switcher, per-user preference, active-model resolution, chat engine).
 *
 * Add or change models in `@coomander/core` — NOT here.
 */

export {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  DEFAULT_OPEN_MODEL_ID,
  listModels,
  listUserSelectableModels,
  getModel,
  isValidModelId,
} from "@coomander/core";

export type {
  ModelCatalogEntry,
  ModelTier,
  ModelProvider,
  CostTier,
} from "@coomander/core";
