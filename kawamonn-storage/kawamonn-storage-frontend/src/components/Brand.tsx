import { Menu, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';

// T-tech のマーク。朱の角印に T。public/favicon.svg と同じ形（www・store・学習とも共通）。
export function BrandSeal({ className = 'brand-seal' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="5" fill="var(--accent)" />
      <rect x="4" y="4" width="24" height="24" rx="2.5" fill="none" stroke="var(--accent-ink)" strokeWidth="1.2" opacity="0.55" />
      <path d="M9 10h14v3.2h-5.4V24h-3.2V13.2H9z" fill="var(--accent-ink)" />
    </svg>
  );
}

// このサービスの中のページ
const HERE = [
  { to: '/', name: 'ファイル', note: 'ストレージのトップ' },
  { to: '/ssh', name: 'SSH 端末', note: '自分専用の Linux 環境' },
];

// T-tech のほかのページ。ハブ（www）・ストア・学習と同じ並び（T-tech のトップ → ストア → 学習）。
const OTHER_SITES = [
  { href: 'https://www.kawamonn.com/', name: 'T-tech のトップ', note: 'サービスの一覧' },
  { href: 'https://store.kawamonn.com/', name: 'T-tech Store', note: 'Android アプリ' },
  { href: 'https://labs.kawamonn.com/', name: 'UoA Online 学習', note: 'ネットワークとセキュリティの教材' },
];

function Item({ name, note, current }: { name: string; note: string; current?: boolean }) {
  return (
    <span className="brand-menu-item">
      <span className="brand-menu-name">
        {name}
        {current && <span className="brand-menu-dot" aria-label="（今のページ）" />}
      </span>
      <span className="brand-menu-note">{note}</span>
    </span>
  );
}

// 「[角印] UoA Online | ストレージ ⌄」。押すと、このサービスのページと T-tech のほかのページへ進めるメニューが開く。
// admin を付けると、管理者画面もメニューに入れる。
export function BrandLockup({ section = 'ストレージ', admin = false }: { section?: string; admin?: boolean }) {
  const { pathname } = useLocation();
  const here = admin ? [...HERE, { to: '/admin', name: '管理者画面', note: 'ユーザーの管理' }] : HERE;

  return (
    <Menu position="bottom-start" offset={6} width={280} shadow="md" radius="md">
      <Menu.Target>
        <UnstyledButton className="brand brand-button" aria-label={`UoA Online ${section}（メニュー）`}>
          <BrandSeal />
          <span className="brand-name">UoA Online</span>
          <span className="brand-section">{section}</span>
          <IconChevronDown size={14} className="brand-caret" aria-hidden="true" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>UoA Online ストレージ</Menu.Label>
        {here.map((page) => (
          <Menu.Item key={page.to} component={Link} to={page.to}>
            <Item name={page.name} note={page.note} current={pathname === page.to} />
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Label>T-tech のほかのページ</Menu.Label>
        {OTHER_SITES.map((site) => (
          <Menu.Item key={site.href} component="a" href={site.href}>
            <Item name={site.name} note={site.note} />
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
