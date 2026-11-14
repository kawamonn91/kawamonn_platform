import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme, type CSSVariablesResolver } from '@mantine/core';
import '@mantine/core/styles.css';
import App from './App.tsx';
import './index.css';

// Mantine のテーマは T-tech の共通トークン（src/styles/tokens.css）と同じ値で作る。
const theme = createTheme({
  // 差し色の朱。ライトでは 6、ダークでは明るい 4 を使う
  primaryColor: 'shu',
  primaryShade: { light: 6, dark: 4 },
  // ダークの朱のように明るい色の上では、文字を黒にする
  autoContrast: true,
  fontFamily:
    'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Consolas, "BIZ UDGothic", monospace',
  headings: { fontWeight: '700' },
  radius: { xs: '2px', sm: '3px', md: '6px', lg: '8px', xl: '12px' },
  defaultRadius: 'sm',
  colors: {
    shu: ['#fdf3f0', '#fbe4dc', '#f6c5b5', '#f2a38b', '#f0795a', '#e25c3c', '#c8442a', '#a93820', '#8a2e1b', '#6b2315'],
    // 紙と墨の中間色（ライトの枠線や控えめな文字）
    gray: ['#f7f6f3', '#f3f1ee', '#e9e6e1', '#e3e0db', '#c9c4bc', '#a39d94', '#736d64', '#57524b', '#3a3631', '#1c1a17'],
    // ダーク
    dark: ['#edeae5', '#d6d1c9', '#b5afa6', '#8c867d', '#4a453e', '#34302b', '#26221e', '#1e1b18', '#161412', '#0f0e0c'],
  },
  components: {
    Paper: { defaultProps: { shadow: 'none', radius: 'md' } },
    Card: { defaultProps: { shadow: 'none', radius: 'md' } },
    Modal: { defaultProps: { radius: 'md' } },
  },
});

// body はカードやヘッダーの面（surface）の色。ページの地（paper）は index.css で塗る。
const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-body': '#ffffff',
    '--mantine-color-text': '#1c1a17',
    '--mantine-color-dimmed': '#736d64',
    '--mantine-color-default-border': '#c9c4bc',
  },
  dark: {
    '--mantine-color-body': '#1e1b18',
    '--mantine-color-text': '#edeae5',
    '--mantine-color-dimmed': '#8c867d',
    '--mantine-color-default-border': '#4a453e',
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </StrictMode>,
);
