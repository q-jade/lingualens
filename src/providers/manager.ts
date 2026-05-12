import { OpenAICompatProvider } from './openai-compat';
import { OllamaProvider } from './ollama';
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
      case 'lmstudio':
        return new OpenAICompatProvider(config);
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

  getProvider(config: ProviderConfig): BaseProvider {
    let provider = this.providers.get(config.id);
    if (!provider) {
      provider = this.createProvider(config);
      this.providers.set(config.id, provider);
    }
    return provider;
  }

  clearCache(): void {
    this.providers.clear();
  }
}
