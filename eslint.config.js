import js from '@eslint/js';

export default [
  {
    files: ['public/js/*.js'],
    languageOptions: {
      globals: {
        Audio: 'readonly',
        CustomEvent: 'readonly',
        HTMLImageElement: 'readonly',
        MediaMetadata: 'readonly',
        MutationObserver: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        YT: 'readonly',
        alert: 'readonly',
        clearTimeout: 'readonly',
        confirm: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        prompt: 'readonly',
        requestAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        window: 'readonly',
      },
    },
    rules: js.configs.recommended.rules,
  },
];
