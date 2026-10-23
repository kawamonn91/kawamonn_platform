import { Modal, Stack, Text, Group, TextInput, CopyButton, Button } from '@mantine/core';

interface TempPasswordModalProps {
    tempPassword: { account_name: string; password: string } | null;
    onClose: () => void;
}

export function TempPasswordModal({ tempPassword, onClose }: TempPasswordModalProps) {
    return (
        <Modal opened={tempPassword !== null} onClose={onClose} title="仮パスワード">
            <Stack gap="sm">
                <Text size="sm">
                    「{tempPassword?.account_name}」の仮パスワードです。この画面を閉じると二度と表示できません。
                    本人に安全な方法で伝え、ログイン後に設定画面で変えてもらってください。
                </Text>
                <Group gap="xs">
                    <TextInput
                        value={tempPassword?.password ?? ''}
                        readOnly
                        style={{ flex: 1 }}
                        styles={{ input: { fontFamily: 'monospace' } }}
                    />
                    <CopyButton value={tempPassword?.password ?? ''}>
                        {({ copied, copy }) => (
                            <Button color={copied ? 'teal' : 'blue'} onClick={copy}>
                                {copied ? 'コピーしました' : 'コピー'}
                            </Button>
                        )}
                    </CopyButton>
                </Group>
                <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>閉じる</Button>
                </Group>
            </Stack>
        </Modal>
    );
}
