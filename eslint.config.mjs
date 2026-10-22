import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/.cache/**',
    '**/.pnpm-store/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['client/src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowExportNames: ['buttonVariants', 'badgeVariants'],
        },
      ],
    },
  },
  {
    files: ['client/src/pages/**/*.tsx', 'client/src/layouts/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowExportNames: [
            'homeLoader',
            'newAgentLoader',
            'projectsLoader',
            'newProjectAction',
            'projectLoader',
            'sessionsLoader',
            'schedulesLoader',
            'sessionLoader',
            'sessionAction',
            'agentsLoader',
            'agentLoader',
            'newAgentAction',
            'editAgentAction',
            'skillsLoader',
            'skillLoader',
            'newSkillAction',
            'editSkillAction',
            'jobsLoader',
            'jobLoader',
            'jobAction',
            'runsLoader',
            'runLoader',
            'runAction',
            'scheduleLoader',
            'scheduleAction',
            'settingsLoader',
            'settingsAction',
            'mcpsLoader',
            'mcpsAction',
            'usageLoader',
          ],
        },
      ],
    },
  },
  {
    files: ['skills/**/*.mjs'],
    extends: [js.configs.recommended],
  },
  {
    files: [
      'server/src/**/*.ts',
      'server/tests/**/*.mjs',
      'skills/**/*.mjs',
      'client/vite.config.ts',
      '*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
]);
