/**
 * 続けて頼んだ読み込みのうち、最後に頼んだものの結果だけを使うための番号札。
 * フォルダを素早く移動すると、先に頼んだ一覧の結果が後から届き、新しいフォルダの一覧を
 * 古い一覧で上書きしてしまうことがある(回線の遅延や再試行で順番が入れ替わる)。
 *
 *   const latest = useRef(createLatestTracker());
 *   const id = latest.current.next();
 *   const items = await load();
 *   if (latest.current.isLatest(id)) setItems(items);
 */
export function createLatestTracker() {
    let latest = 0;
    return {
        next: () => ++latest,
        isLatest: (id: number) => id === latest,
    };
}
