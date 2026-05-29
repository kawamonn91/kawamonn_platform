module.exports = {
    apps: [
        {
            name: 'kawamonn-backend',
            script: 'npm',
            args: 'run start:dev',
            cwd: '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-backend',
            env: {
                NODE_ENV: 'development'
            },
            // --- 再発防止設定 ---
            // 連続クラッシュ時の最大再起動回数 (上限を超えたら停止)
            max_restarts: 5,
            // 再起動前の待機時間 (ms) - 最初は5秒待つ
            restart_delay: 5000,
            // 指数バックオフ: 失敗するたびに待機時間を倍増 (最大30秒)
            exp_backoff_restart_delay: 100,
            // この時間(ms)以上稼働して初めて「正常起動」とみなす
            // (これ未満で落ちた場合はリトライカウントを増やす)
            min_uptime: 10000,
            // プロセスがリッスン開始するまでのタイムアウト (ms)
            listen_timeout: 60000
        },
        {
            name: 'kawamonn-frontend',
            script: 'npm',
            args: 'run dev -- --host --port 8080',
            cwd: '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-frontend',
            env: {
                NODE_ENV: 'development'
            },
            // --- 再発防止設定 ---
            max_restarts: 5,
            restart_delay: 5000,
            exp_backoff_restart_delay: 100,
            min_uptime: 10000,
            listen_timeout: 60000
        }
    ]
};
