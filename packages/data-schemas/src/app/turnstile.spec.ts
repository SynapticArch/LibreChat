import { getConfigDefaults } from 'librechat-data-provider';
import { loadTurnstileConfig } from './turnstile';
import logger from '~/config/winston';

jest.mock('~/config/winston', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
}));

const envKeys = ['TURNSTILE_SITE_KEY', 'TURNSTILE_LANGUAGE', 'TURNSTILE_SIZE', 'TURNSTILE_THEME'];

describe('loadTurnstileConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    envKeys.forEach((key) => {
      delete process.env[key];
    });
  });

  afterAll(() => {
    envKeys.forEach((key) => {
      delete process.env[key];
    });
  });

  it('loads public turnstile config from environment variables', () => {
    process.env.TURNSTILE_SITE_KEY = 'env-site-key';
    process.env.TURNSTILE_LANGUAGE = 'zh-CN';
    process.env.TURNSTILE_SIZE = 'compact';
    process.env.TURNSTILE_THEME = 'dark';

    const result = loadTurnstileConfig(
      {
        turnstile: {
          siteKey: 'custom-site-key',
          options: { language: 'en', size: 'normal', theme: 'light' },
        },
      },
      getConfigDefaults(),
    );

    expect(result).toEqual({
      siteKey: 'env-site-key',
      options: {
        language: 'zh-CN',
        size: 'compact',
        theme: 'dark',
      },
    });
  });

  it('ignores invalid environment size and theme values', () => {
    process.env.TURNSTILE_SIZE = 'full';
    process.env.TURNSTILE_THEME = 'purple';

    const result = loadTurnstileConfig(
      {
        turnstile: {
          siteKey: 'custom-site-key',
          options: { language: 'en', size: 'normal', theme: 'light' },
        },
      },
      getConfigDefaults(),
    );

    expect(result).toEqual({
      siteKey: 'custom-site-key',
      options: {
        language: 'en',
        size: 'normal',
        theme: 'light',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith('[Turnstile] Ignoring invalid TURNSTILE_SIZE: full');
    expect(logger.warn).toHaveBeenCalledWith(
      '[Turnstile] Ignoring invalid TURNSTILE_THEME: purple',
    );
  });
});
