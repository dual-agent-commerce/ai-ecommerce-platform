import { useCallback, useEffect, useMemo, useState } from "react";
import {
  archivePricingGroup, createPricingGroup, createSeanQuote, getPricingGroupQuotes,
  getPricingGroups, money, rejectSeanQuote, renamePricingGroup, selectSeanQuote,
  type PendingReview, type PricingGroup, type Product, type SeanPricingResult, type SeanQuote,
} from "../api";
import Icon from "../components/Icon";
import { Button, PageHeading } from "../components/UI";

type Props = {
  products: Product[];
  reviews?: PendingReview[]; // kept only for App.tsx compatibility; never displayed
  busy?: boolean;
  onCreateRecommendation?: (id: number) => Promise<boolean>;
  onApprove?: (r: PendingReview, price: number) => Promise<boolean>;
  onReject?: (r: PendingReview, reason: string) => Promise<boolean>;
  suggestedProductId?: number | null;
  onSeanApplied?: () => Promise<void>;
};

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}
function resultAvailable(result: SeanPricingResult | undefined, size: number): boolean {
  return Boolean(result?.prices && result.prices.length === size && result.prices.every(v => Number.isFinite(v) && v > 0));
}
function getQuoteState(q: SeanQuote | null) {
  return !q ? "尚未估價" : q.rejected_at ? "已拒絕" : q.selected_algorithm ? "已採用" : "待確認";
}
function groupTrainHint(group: PricingGroup) {
  if (group.model_available) return group.last_train_status === "training" || group.last_train_status === "running"
    ? "舊版模型可用，新版正在訓練" : "OLS + RR 已解鎖";
  if (group.last_train_status === "training" || group.last_train_status === "running") return "模型訓練中";
  if (group.last_train_status === "not_ready") return "資料尚不足，等待後續銷售紀錄";
  if (group.last_train_status === "failed" || group.last_train_status === "not_found" || group.last_train_status === "timed_out") return "訓練未完成，等待下次檢查";
  return "尚無可用模型";
}

export default function Pricing({ products, onSeanApplied, suggestedProductId }: Props) {
  const [groups, setGroups] = useState<PricingGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<SeanQuote[]>([]);
  const [viewQuoteId, setViewQuoteId] = useState<number | null>(null);
  const [algorithm, setAlgorithm] = useState("");
  const [search, setSearch] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const group = groups.find(g => g.group_id === selectedGroupId) ?? null;
  const lastQuote = group?.latest_quote ?? null;
  const shownQuote = viewQuoteId === null ? lastQuote : quotes.find(q => q.id === viewQuoteId) ?? lastQuote;
  const isLatestQuote = shownQuote?.id === lastQuote?.id;
  const canReview = Boolean(shownQuote && isLatestQuote && !shownQuote.selected_algorithm && !shownQuote.rejected_at);
  const availableDefault = shownQuote?.pricing_response.results.find(r => resultAvailable(r, shownQuote.products_snapshot.length));
  const selectedAlgorithm = (shownQuote?.selected_algorithm ?? algorithm) || availableDefault?.algorithm || "";
  const selectedResult = shownQuote?.pricing_response.results.find(r => r.algorithm === selectedAlgorithm);
  const pendingCount = groups.filter(g => g.latest_quote && !g.latest_quote.selected_algorithm && !g.latest_quote.rejected_at).length;
  const readyCount = groups.filter(g => g.model_available).length;
  const appliedCount = groups.filter(g => Boolean(g.active_algorithm)).length;

  const filteredGroups = useMemo(() => groups.filter(g =>
    `${g.name} ${g.products.map(p => p.name).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())
  ), [groups, search]);
  const filteredProducts = useMemo(() => products.filter(p =>
    p.name.toLowerCase().includes(productSearch.trim().toLowerCase()) || String(p.id).includes(productSearch.trim())
  ), [products, productSearch]);

  const refreshGroups = useCallback(async (focusId?: string) => {
    const data = await getPricingGroups();
    setGroups(data);
    setSelectedGroupId(previous => {
      const target = focusId ?? previous;
      if (target && data.some(g => g.group_id === target)) return target;
      const stored = window.sessionStorage.getItem("pricing-target-group");
      if (stored && data.some(g => g.group_id === stored)) {
        window.sessionStorage.removeItem("pricing-target-group");
        return stored;
      }
      if (suggestedProductId != null) {
        const suggested = data.find(g => g.product_ids.includes(suggestedProductId));
        if (suggested) return suggested.group_id;
      }
      return data[0]?.group_id ?? null;
    });
  }, [suggestedProductId]);

  useEffect(() => {
    const focus = (event: Event) => {
      const groupId = (event as CustomEvent<string>).detail;
      void refreshGroups(groupId).catch(() => setSelectedGroupId(groupId));
    };
    window.addEventListener("pricing:focus-group", focus);
    return () => window.removeEventListener("pricing:focus-group", focus);
  }, [refreshGroups]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshGroups().catch(() => undefined), 60000);
    return () => window.clearInterval(timer);
  }, [refreshGroups]);

  useEffect(() => {
    if (!createOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") resetCreate(); };
    window.addEventListener("keydown", handleEscape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", handleEscape); };
  }, [createOpen]);

  useEffect(() => {
    let active = true;
    void refreshGroups().catch(err => {
      if (active) setNotice({ text: err instanceof Error ? err.message : "讀取商品組失敗", error: true });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshGroups]);

  useEffect(() => {
    setViewQuoteId(null);
    setHistoryOpen(false);
    setRenaming(false);
    setNotice(null);
    setQuotes([]);
    if (!selectedGroupId) return;
    let active = true;
    void getPricingGroupQuotes(selectedGroupId).then(data => { if (active) setQuotes(data); }).catch(() => {
      if (active) setNotice({ text: "歷史估價暫時無法載入", error: true });
    });
    return () => { active = false; };
  }, [selectedGroupId]);

  useEffect(() => {
    const quote = shownQuote;
    setAlgorithm(quote?.selected_algorithm ?? quote?.pricing_response.results.find(r => resultAvailable(r, quote.products_snapshot.length))?.algorithm ?? "");
  }, [shownQuote?.id, shownQuote?.selected_algorithm]);

  async function runAction(task: () => Promise<void>) {
    setWorking(true);
    setNotice(null);
    try { await task(); }
    catch (e) { setNotice({ text: e instanceof Error ? e.message : "操作失敗", error: true }); }
    finally { setWorking(false); }
  }

  function resetCreate() {
    setNewName(""); setMemberIds([]); setProductSearch(""); setCreateOpen(false);
  }
  function toggleProduct(id: number, checked: boolean) {
    setMemberIds(old => checked ? [...old, id] : old.filter(p => p !== id));
  }
  async function addGroup() {
    if (!newName.trim() || !memberIds.length) {
      setNotice({ text: "請輸入組名並至少選擇一件商品", error: true }); return;
    }
    await runAction(async () => {
      const created = await createPricingGroup(newName.trim(), memberIds);
      resetCreate();
      await refreshGroups(created.group_id);
      window.dispatchEvent(new Event("pricing:changed"));
      setNotice({ text: `「${created.name}」已建立，現在可以取得定價`, error: false });
    });
  }
  async function generateQuote() {
    if (!group) return;
    await runAction(async () => {
      const quote = await createSeanQuote(group.group_id, group.product_ids);
      await refreshGroups(group.group_id);
      window.dispatchEvent(new Event("pricing:changed"));
      setQuotes(await getPricingGroupQuotes(group.group_id));
      setViewQuoteId(quote.id);
      setAlgorithm(quote.pricing_response.results.find(r => resultAvailable(r, quote.products_snapshot.length))?.algorithm ?? "");
      setHistoryOpen(false);
      setNotice({ text: "已收到 Sean 的定價結果並保存。請選擇方案，再決定採用或拒絕。", error: false });
    });
  }
  async function confirmQuote() {
    if (!shownQuote || !canReview || !selectedResult || !resultAvailable(selectedResult, shownQuote.products_snapshot.length)) return;
    if (!window.confirm(`確定採用「${group?.name}」的 ${selectedAlgorithm === "ols_rr" ? "OLS + RR" : "Cost Plus"} 定價？這會更新整組商品價格並建立上架工作。`)) return;
    await runAction(async () => {
      await selectSeanQuote(shownQuote.id, selectedAlgorithm);
      await Promise.all([refreshGroups(group?.group_id), onSeanApplied?.()]);
      if (group) setQuotes(await getPricingGroupQuotes(group.group_id));
      setNotice({ text: "已套用整組定價，建立待上架工作。", error: false });
    });
  }
  async function rejectQuote() {
    if (!shownQuote || !canReview) return;
    if (!window.confirm("確定拒絕本次估價？商品售價不會變動，也不需要填寫理由。")) return;
    await runAction(async () => {
      await rejectSeanQuote(shownQuote.id);
      await refreshGroups(group?.group_id);
      window.dispatchEvent(new Event("pricing:changed"));
      if (group) setQuotes(await getPricingGroupQuotes(group.group_id));
      setNotice({ text: "本次定價已拒絕。商品組仍保留，可重新取得建議。", error: false });
    });
  }
  async function saveName() {
    if (!group || !renameText.trim()) return;
    await runAction(async () => {
      await renamePricingGroup(group.group_id, renameText.trim());
      await refreshGroups(group.group_id);
      setRenaming(false);
      setNotice({ text: "商品組名稱已更新，商品成員及模型不受影響。", error: false });
    });
  }
  async function archive() {
    if (!group || !window.confirm(`確定封存「${group.name}」？它會從商品組清單移除，估價及上架紀錄仍會保留。`)) return;
    await runAction(async () => {
      await archivePricingGroup(group.group_id);
      await refreshGroups();
      window.dispatchEvent(new Event("pricing:changed"));
      setNotice({ text: "商品組已封存，歷史資料完整保留。", error: false });
    });
  }

  return <div className="page-stack group-pricing">
    <PageHeading eyebrow="AI PRICING WORKSPACE" title="AI 智慧定價" description="以商品組管理定價，不再讓同一件商品的估價紀錄塞滿清單。" />

    <div className="gp-metrics">
      <div className="gp-metric"><span>運作中的商品組</span><strong>{groups.length}</strong><small>固定成員，統一定價</small></div>
      <div className="gp-metric"><span>待確認的定價</span><strong>{pendingCount}</strong><small>需要商家決策</small></div>
      <div className="gp-metric gp-metric-gold"><span>OLS + RR 已解鎖</span><strong>{readyCount} <small>/ {groups.length}</small></strong><small>歷史資料訓練完成</small></div>
      <div className="gp-metric"><span>已有採用方案</span><strong>{appliedCount}</strong><small>可隨時再次取得估價</small></div>
    </div>

    <section className="gp-create-summary">
      <div className="gp-create-icon"><Icon name="layers" size={23}/></div>
      <div className="gp-create-copy"><strong>先建立商品組，再取得定價</strong><span>為商品組命名並選擇成員。之後估價及每週模型訓練都沿用相同商品順序。</span></div>
      <Button icon="plus" onClick={() => { setCreateOpen(true); setNotice(null); }}>建立商品組</Button>
    </section>

    {notice && <div role={notice.error ? "alert" : "status"} className={`gp-message ${notice.error ? "gp-error" : "gp-success"}`}>
      <span>{notice.text}</span><button type="button" aria-label="關閉提示" onClick={() => setNotice(null)}>×</button>
    </div>}

    <section className="gp-workspace">
      <aside className="gp-sidebar">
        <div className="gp-panel-heading"><div><h2>商品組管理</h2><p>每個商品組僅顯示一次</p></div><span className="gp-count">{filteredGroups.length}</span></div>
        <div className="gp-search"><Icon name="search" size={19}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋商品組或商品..." aria-label="搜尋商品組"/></div>
        {loading ? <div className="gp-empty">正在讀取商品組...</div> : !filteredGroups.length ?
          <div className="gp-empty"><Icon name="layers" size={30}/><strong>{groups.length ? "找不到符合的商品組" : "還沒有商品組"}</strong><p>{groups.length ? "試試不同的關鍵字" : "點擊上方「建立商品組」開始定價"}</p></div> :
          <div className="gp-group-list">
            {filteredGroups.map(g => {
              const isActive = g.group_id === selectedGroupId;
              const q = g.latest_quote;
              const ready = g.model_available;
              return <button type="button" key={g.group_id} className={`gp-group-item ${isActive ? "active" : ""}`} onClick={() => setSelectedGroupId(g.group_id)}>
                <div className="gp-group-item-head"><strong title={g.name}>{g.name}</strong><span className={`gp-mini-status ${q && !q.selected_algorithm && !q.rejected_at ? "waiting" : ""}`}>{getQuoteState(q)}</span></div>
                <div className="gp-group-item-sub">{g.products.length} 件商品 · {g.products.slice(0, 3).map(p => p.name).join("、")}{g.products.length > 3 ? "…" : ""}</div>
                <div className="gp-group-item-foot"><div className="gp-group-chips"><span className="gp-availability">{g.active_algorithm ? `最近採用：${g.active_algorithm === "ols_rr" ? "OLS + RR" : "Cost Plus"}` : "尚未採用定價"}</span><span className={`gp-availability ${ready ? "gold" : ""}`}>{ready ? "✦ OLS 已解鎖" : "OLS 未就緒"}</span></div><span className="gp-group-more"><Icon name="chevronRight" size={17}/></span></div>
              </button>;
            })}
          </div>}
        <div className="gp-sidebar-foot">商品組成員建立後即固定。需要不同組合時，請另外建立新組。</div>
      </aside>

      <main className="gp-detail">
        {!group ? <div className="gp-empty gp-detail-empty"><Icon name="sparkles" size={38}/><h3>選擇一個商品組</h3><p>查看組內商品、演算法資格、定價結果與訓練狀態。</p></div> : <>
          <div className="gp-detail-head">
            <div className="gp-detail-title">
              <span className="gp-eyebrow">PRODUCT PRICING GROUP</span>
              {renaming ? <div className="gp-rename"><input value={renameText} onChange={e => setRenameText(e.target.value)} maxLength={120} aria-label="編輯商品組名稱"/><Button disabled={working || !renameText.trim()} onClick={() => void saveName()}>儲存</Button><Button variant="outline" onClick={() => setRenaming(false)}>取消</Button></div>
                : <div className="gp-title-inline"><h2>{group.name}</h2><button type="button" className="gp-link" onClick={() => { setRenameText(group.name); setRenaming(true); }}>重新命名</button></div>}
              <p>{group.products.length} 件商品 · 最近採用：{group.active_algorithm ? (group.active_algorithm === "ols_rr" ? "OLS + RR" : "Cost Plus") : "尚未採用"} · 建立於 {formatDate(group.created_at)}</p>
            </div>
            <div className="gp-header-actions"><Button variant="outline" disabled={working} icon="refresh" onClick={() => void refreshGroups(group.group_id)}>更新狀態</Button><Button disabled={working || group.products.some(p => p.missing)} icon="sparkles" onClick={() => void generateQuote()}>{working ? "處理中…" : lastQuote ? "重新取得定價" : "取得 AI 定價"}</Button></div>
          </div>

          <div className="gp-members"><span>商品組成員</span><div>{group.products.map(p => <span className="gp-member" key={p.id}><Icon name="box" size={15}/>{p.name}<small>#{p.id}</small></span>)}</div></div>

          <div className={`gp-model-status ${group.model_available ? "unlocked" : ""}`}>
            <div className="gp-model-emblem">{group.model_available ? "✦" : <Icon name="clock" size={22}/>}</div>
            <div><strong>{group.model_available ? "金色估價方案已解鎖" : "OLS + RR 尚未解鎖"}</strong><p>{groupTrainHint(group)}{group.last_train_period ? ` · 最近訓練資料：${group.last_train_period}` : ""}</p>
              {!group.model_available && group.last_train_missing && group.last_train_missing.length > 0 && <small>待補資料：{group.last_train_missing.slice(0, 2).map(m => m.message ?? (m.need != null ? `${m.check} ${m.have ?? 0}/${m.need}` : m.check)).join("；")}</small>}
              {group.model_available && <small>{group.model_id ? `模型版本 ${group.model_id} · ` : ""}若目前報價沒有 OLS + RR，請重新取得定價。</small>}
            </div>
          </div>

          {shownQuote ? <>
            <div className="gp-section-heading"><div><h3>選擇定價方案</h3></div><span className={`gp-quote-state ${shownQuote.rejected_at ? "rejected" : ""}`}>{getQuoteState(shownQuote)} · #{shownQuote.id}</span></div>
            <div className="gp-algorithms">
              {(["cost_plus", "ols_rr"] as const).map(name => {
                const r = shownQuote.pricing_response.results.find(item => item.algorithm === name);
                const usable = resultAvailable(r, shownQuote.products_snapshot.length);
                const gold = name === "ols_rr";
                const selected = selectedAlgorithm === name;
                return <button type="button" key={name} disabled={!usable || !canReview}
                  aria-pressed={selected} onClick={() => setAlgorithm(name)}
                  className={`gp-algo-card ${gold ? "gp-gold" : ""} ${selected ? "selected" : ""} ${!usable ? "unavailable" : ""}`}>
                    <div className="gp-algo-top"><span className="gp-algo-name">{gold ? "✦ OLS + RR" : "Cost Plus"}</span><span className="gp-algo-tag">{usable ? (selected ? "已選擇" : "可選擇") : gold && group.model_available ? "需更新報價" : "尚不可用"}</span></div>
                    <strong className="gp-algo-label">{gold ? "模型估價 · 金色方案" : "成本加成 · 基礎方案"}</strong>
                    {usable ? <><span className="gp-algo-price">{money(r!.prices![0])}</span><span className="gp-algo-desc">第一件商品的建議售價 · {r!.prices!.length} 件商品</span></>
                      : <span className="gp-algo-desc gp-algo-fail">{gold && group.model_available ? "模型已就緒；此筆舊報價尚無模型結果，請重新取得定價。" : r?.error?.message ?? "目前沒有訓練完成的模型"}</span>}
                  </button>;
              })}
            </div>

            {selectedResult && resultAvailable(selectedResult, shownQuote.products_snapshot.length) ? <>
              <div className="gp-section-heading gp-price-heading"><div><h3>整組價格比較</h3><p>估價當下的售價與成本快照，核准前系統會再次檢查價格是否被更動。</p></div></div>
              <div className="gp-price-list">{shownQuote.products_snapshot.map((p, index) => {
                const suggested = selectedResult.prices![index];
                const change = p.current_price != null && p.current_price > 0
                ? (suggested / p.current_price - 1) * 100
                : null;
                const margin = suggested > 0 ? (suggested - p.cost) / suggested * 100 : null;
                return <div className="gp-price-item" key={p.id}>
                  <div className="gp-price-name"><strong>{p.name}</strong><span>商品 #{p.id} · 成本 {money(p.cost)}</span></div>
                  <div className="gp-price-compare"><span>目前售價</span><strong>{money(p.current_price)}</strong></div>
                  <Icon name="arrowRight" size={18}/>
                  <div className="gp-price-compare new"><span>建議售價</span><strong>{money(suggested)}</strong></div>
                  <div className="gp-price-change"><strong>{change === null ? "新定價" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}</strong><span>毛利率 {margin === null ? "—" : `${margin.toFixed(1)}%`}</span></div>
                </div>;
              })}</div>
            </> : <div className="gp-no-result">此筆報價沒有可用的價格方案。請稍後重新取得定價。</div>}

            <div className="gp-confirm-bar"><div><strong>{!isLatestQuote ? "歷史估價（唯讀）" : getQuoteState(shownQuote) === "待確認" ? "確認本次整組定價" : "此筆估價已完成"}</strong><p>{!isLatestQuote ? "歷史紀錄只能查看；請回到最新報價操作。" : shownQuote.selected_algorithm ? `已採用 ${shownQuote.selected_algorithm}，不能再次採用。` : shownQuote.rejected_at ? "此筆已拒絕，不會更新商品價格。" : "拒絕不必填原因；採用會一次更新組內所有商品的售價。"}</p></div>
              {canReview && <div className="gp-decision-buttons"><Button variant="outline" disabled={working} onClick={() => void rejectQuote()}>拒絕本次建議</Button><Button disabled={working || !selectedResult || !resultAvailable(selectedResult, shownQuote.products_snapshot.length)} icon="check" onClick={() => void confirmQuote()}>確認採用整組定價</Button></div>}
            </div>
          </> : <div className="gp-first-quote"><Icon name="sparkles" size={34}/><h3>這個商品組還沒有定價結果</h3><p>點擊「取得 AI 定價」，系統會向 Sean 傳送商品組成本與目前售價，並保存一次定價結果。</p><Button icon="sparkles" disabled={working} onClick={() => void generateQuote()}>取得 AI 定價</Button></div>}

          <div className="gp-history"><button className="gp-history-toggle" type="button" onClick={() => setHistoryOpen(v => !v)} aria-expanded={historyOpen}><span><Icon name="clock" size={19}/> 歷史定價紀錄 <small>（只在本商品組內查看，不重複出現在左側）</small></span><Icon name="chevronDown" size={18}/></button>
            {historyOpen && <div className="gp-history-list">{quotes.length ? quotes.map(q => <button type="button" key={q.id} className={shownQuote?.id === q.id ? "active" : ""} onClick={() => { setViewQuoteId(q.id); setNotice(null); }}>
              <span><strong>定價 #{q.id}</strong><small>{formatDate(q.created_at)}</small></span><span>{q.rejected_at ? "已拒絕" : q.selected_algorithm ? `已採用 ${q.selected_algorithm}` : "待確認"}</span>
            </button>) : <p>沒有歷史紀錄</p>}{viewQuoteId !== null && <button type="button" className="gp-return-latest" onClick={() => setViewQuoteId(null)}>返回最新估價</button>}</div>}
          </div>
          <div className="gp-archive-row"><button type="button" onClick={() => void archive()} disabled={working}>封存此商品組</button><span>只從運作清單隱藏，不會刪除定價及上架紀錄。</span></div>
        </>}
      </main>
    </section>

    {createOpen && <div className="gp-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) resetCreate(); }}>
      <div className="gp-modal" role="dialog" aria-modal="true" aria-labelledby="gp-create-title">
        <div className="gp-modal-head"><div><span className="gp-eyebrow">NEW PRICING GROUP</span><h2 id="gp-create-title">建立定價商品組</h2><p>幫這組商品取一個容易辨識的名稱，勾選本次要固定的成員。</p></div><button type="button" aria-label="關閉建立商品組浮窗" onClick={resetCreate}>×</button></div>
        <label className="gp-field-label" htmlFor="gp-name">商品組名稱</label>
        <input id="gp-name" className="gp-name-input" maxLength={120} value={newName} onChange={e => setNewName(e.target.value)} placeholder="例如：NVIDIA 顯示卡" autoFocus/>
        <div className="gp-modal-sub"><strong>選擇商品</strong><span>已選 {memberIds.length} 件</span></div>
        <div className="gp-search"><Icon name="search" size={18}/><input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="搜尋商品名稱或編號" /></div>
        <div className="gp-pick-list">{filteredProducts.map(p => <label key={p.id} className={memberIds.includes(p.id) ? "checked" : ""}>
          <input type="checkbox" checked={memberIds.includes(p.id)} onChange={e => toggleProduct(p.id, e.target.checked)}/><span><strong>{p.name}</strong><small>商品 #{p.id} · 成本 {money(p.cost)}</small></span><span className="gp-pick-price">{money(p.current_price)}</span>
        </label>)}</div>
        <p className="gp-modal-note"><Icon name="info" size={16}/> 商品組成員建立後不提供插入／刪除；組名可以修改。模型需使用相同成員與順序。</p>
        {notice?.error && <div className="gp-message gp-error" role="alert">{notice.text}</div>}
        <div className="gp-modal-actions"><Button variant="outline" onClick={resetCreate} disabled={working}>取消</Button><Button disabled={working || !newName.trim() || !memberIds.length} onClick={() => void addGroup()}>{working ? "建立中..." : `建立商品組（${memberIds.length} 件）`}</Button></div>
      </div>
    </div>}
  </div>;
}
