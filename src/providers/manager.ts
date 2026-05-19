import { OpenAICompatProvider } from './openai-compat';
import { OllamaProvider } from './ollama';
import { LmStudioProvider } from './lmstudio';
import { DeepLProvider } from './deepl';
import { GoogleTranslateProvider } from './google-translate';
import { CustomProvider } from './custom';
import { BaseProvider } from './base';
import type { ProviderConfig } from '../shared/types';

export class ProviderManager {
  private providers = new Map<string, BaseProvider>();

  createProvider(config: ProviderConfig): BaseProvider {
    switch (config.type) {
      case 'openai-compat':
      case 'openai':
        return new OpenAICompatProvider(config);
      case 'lmstudio':
        return new LmStudioProvider(config);
      case 'ollama':
        return new OllamaProvider(config);
      case 'deepl':
        return new DeepLProvider(config);
      case 'google':
        return new GoogleTranslateProvider(config);
      case 'custom':
        return new CustomProvider(config);
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  getProvider(config: ProviderConfig, { useCache = true } = {}): BaseProvider {
    if (useCache) {
      const cached = this.providers.get(config.id);
      if (cached) return cached;
    }
    const provider = this.createProvider(config);
    if (useCache) {
      this.providers.set(config.id, provider);
    }
    return provider;
  }

  clearCache(): void {
    this.providers.clear();
  }
}
