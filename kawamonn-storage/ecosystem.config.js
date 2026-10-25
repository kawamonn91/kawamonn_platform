// 画面(frontend)は PM2 ではなく、infrastructure/docker の compose の nginx のコンテナ(kawamonn_storage_web)が配信する
module.exports = {
    apps: [
        {
            name: 'kawamonn-backend',
            script: 'npm',
            // Runs the compiled dist/ build instead of `nest start --watch`.
            // Requires `npm run build` in kawamonn-storage-backend before (re)starting.
            args: 'run start:prod',
            cwd: '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-backend',
            env: {
                NODE_ENV: 'production'
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
        }
    ]
};
