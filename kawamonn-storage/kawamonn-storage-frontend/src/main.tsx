import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import App from './App.tsx';
import './index.css';

const theme = createTheme({
  primaryColor: 'gray',
  defaultRadius: 'sm',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Hiragino Sans", "Yu Gothic UI", Roboto, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  colors: {
    dark: [
      '#f4f4f5',
      '#d4d4d8',
      '#a1a1aa',
      '#71717a',
      '#3f3f46',
      '#27272a',
      '#18181b',
      '#121215',
      '#09090b',
      '#09090b',
    ],
  },
  components: {
    Paper: {
      defaultProps: {
        shadow: 'none',
        radius: 'md',
      },
    },
    Card: {
      defaultProps: {
        shadow: 'none',
        radius: 'md',
      },
    },
    Button: {
      defaultProps: {
        radius: 'sm',
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'sm',
      },
    },
    PasswordInput: {
      defaultProps: {
        radius: 'sm',
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </StrictMode>,
);
