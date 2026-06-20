/**
 * @coomander/core chat surface — pure, env-free chat logic shared by the web SSE
 * engine and the agent WebSocket engine (epic #483). The single copy of the
 * model catalog, capability-gated message building, and context trimming, so
 * the two transports can never drift.
 */

// Tiered model catalog (entries, lookups, defaults, capability flags/types).
export {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  DEFAULT_OPEN_MODEL_ID,
  listModels,
  listUserSelectableModels,
  getModel,
  isValidModelId,
} from "./model-catalog";
export type {
  ModelCatalogEntry,
  ModelTier,
  ModelProvider,
  CostTier,
} from "./model-catalog";

// Capability-gated multimodal message building + context trimming.
export {
  applyContextWindow,
  buildModelMessages,
  isOfficeDocument,
} from "./messages";
export type {
  ChatEngineMessage,
  ModelPart,
  ModelMessageLike,
  BuildModelMessagesOptions,
} from "./messages";
