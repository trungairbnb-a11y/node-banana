/**
 * Provider Types
 *
 * Types for multi-provider support including image generation
 * providers and LLM providers.
 */

// Provider Types for multi-provider support (image/video generation)
export type ProviderType = "gemini" | "openai" | "ccs" | "anthropic" | "replicate" | "fal" | "kie" | "wavespeed" | "flow";

// Model pricing info (stored when model is selected)
export interface SelectedModelPricing {
  type: 'per-run' | 'per-second';
  amount: number;
}

// Selected model for image/video generation nodes
export interface SelectedModel {
  provider: ProviderType;
  modelId: string;
  displayName: string;
  pricing?: SelectedModelPricing;  // Optional pricing info from provider API
  capabilities?: string[];  // Model capabilities (e.g., "text-to-image", "image-to-3d")
}

export interface ProviderConfig {
  id: ProviderType;
  name: string;
  enabled: boolean;
  apiKey: string | null;
  apiKeyEnvVar?: string; // For providers using environment variables (e.g., Gemini)
}

export interface ProviderSettings {
  providers: Record<ProviderType, ProviderConfig>;
}

// LLM Provider Options
export type LLMProvider = "google" | "openai" | "ccs" | "anthropic";

// LLM Model Options
export type LLMModelType =
  | "gemini-2.5-flash"
  | "gemini-3-flash-preview"
  | "gemini-3-pro-preview"
  | "gemini-3.1-pro-preview"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash-lite"
  | "gemini-3.1-flash-lite-preview"
  | "gpt-4.1-mini"
  | "gpt-4.1-nano"
  | "gpt-5.5"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.3-codex"
  | "gpt-5.3-codex-spark"
  | "gpt-5.2"
  | "claude-opus-4.6"
  | "claude-sonnet-4.5"
  | "claude-haiku-4.5";

// Recently used models tracking
export interface RecentModel {
  provider: ProviderType;
  modelId: string;
  displayName: string;
  timestamp: number;
}
