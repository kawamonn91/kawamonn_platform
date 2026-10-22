import { Prisma } from '@prisma/client';

export const USER_LIST_FIELDS = {
  id: true,
  account_name: true,
  email: true,
  role: true,
  status: true,
  quota_bytes: true,
  used_bytes: true,
  expiry_at: true,
  created_at: true,
} satisfies Prisma.UserSelect;

export type ListedUser = Prisma.UserGetPayload<{
  select: typeof USER_LIST_FIELDS;
}>;

/** 画面に返す利用者情報の基本形(BigInt と日時は文字列にする) */
export function serializeUserSummary(u: ListedUser) {
  return {
    id: u.id,
    account_name: u.account_name,
    email: u.email,
    role: u.role,
    status: u.status,
    quota_bytes: u.quota_bytes.toString(),
    used_bytes: u.used_bytes.toString(),
    created_at: u.created_at.toISOString(),
    expiry_at: u.expiry_at?.toISOString() ?? null,
  };
}
