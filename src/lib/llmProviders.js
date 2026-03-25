'use client';

import llmProviders from '../../shared/llm-providers.json';

export const API_PROVIDER_DEFS = llmProviders.apiProviders || [];

export const API_PROVIDERS = API_PROVIDER_DEFS.map((provider) => ({
  id: provider.id,
  label: provider.label,
}));

export const API_MODELS = Object.fromEntries(
  API_PROVIDER_DEFS.map((provider) => [provider.id, provider.models || []])
);

export function getApiProvider(providerId) {
  return API_PROVIDER_DEFS.find((provider) => provider.id === providerId) || null;
}

export function getDefaultModelForProvider(providerId) {
  return getApiProvider(providerId)?.models?.[0]?.id || '';
}

export function providerSupportsCustomModel(providerId) {
  return Boolean(getApiProvider(providerId)?.supportsCustomModel);
}

export function getModelSelectValue(providerId, modelId) {
  const models = API_MODELS[providerId] || [];
  if (!modelId) return providerSupportsCustomModel(providerId) ? '__custom__' : (models[0]?.id || '');
  return models.some((model) => model.id === modelId) ? modelId : '__custom__';
}
