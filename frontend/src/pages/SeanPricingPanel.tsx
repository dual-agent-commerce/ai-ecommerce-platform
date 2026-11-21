import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api, money } from "../api";
import type { Product } from "../api";

type Result = { algorithm: string; prices?: number[]; reason?: string; error?: { code: string; message: string } };
type Quote = {
  id: number;
  group_id: string;
  products_snapshot: Pick<Product, "id" | "name" | "cost" | "current_price">[];
  pricing_response: { group_id: string; results: Result[] };
  selected_algorithm: string | null;
  created_at: string;
};

type Props = { products: Product[]; onApplied: () => Promise<void> };

export default function SeanPricingPanel({ products, onApplied }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [groupId, setGroupId] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const active = quotes.find(q => q.id === activeId) ?? quotes[0];

  async function reload() {
    const data = await api<Quote[]>("/sean-pricing/quotes");
    setQuotes(data);
  }
  useEffect(() => { void reload().catch(() => { /* migration may not be applied yet */ }); }, []);

  async function generate() {
    if (!groupId.trim() || !selected.length) { setError("請輸入商品組 ID 並勾選商品"); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const quote = await api<Quote>("/sean-pricing/quotes", {
        method: "POST", body: JSON.stringify({ group_id: groupId.trim(), product_ids: selected })
      });
      await reload(); setActiveId(quote.id); setMessage("已取得並保存 Sean 的定價結果");
    } catch (e) { setError(e instanceof Error ? e.message : "定價失敗"); }
    finally { setBusy(false); }
  }

  async function choose(algorithm: string) {
    if (!active || !window.confirm(`確定採用 ${algorithm} 的整組價格？這會更新商品售價並建立上架工作。`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/sean-pricing/quotes/${active.id}/select`, {
        method: "POST", body: JSON.stringify({ algorithm })
      });
      await reload(); await onApplied(); setMessage(`已採用 ${algorithm}，商品價格已更新`);
    } catch (e) { setError(e instanceof Error ? e.message : "選擇失敗"); }
    finally { setBusy(false); }
  }

  const fieldStyle: CSSProperties = { padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white" };
  return <section className="generator-card" style={{ marginBottom: 24, display: "grid", gap: 16 }}>
    <div><div className="eyebrow">SEAN PRICING ENGINE</div><h2>多演算法定價</h2>
      <p>選擇同一商品組，取得並保存 Cost Plus / OLS + RR 的價格方案。</p></div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <input style={fieldStyle} value={groupId} placeholder="商品組 ID，例如 shop1_gpu" onChange={e => setGroupId(e.target.value)} />
      <button type="button" disabled={busy} onClick={() => void generate()} style={fieldStyle}>{busy ? "處理中..." : "向 Sean 取得定價"}</button>
      <button type="button" disabled={busy} onClick={() => void reload().catch(e => setError(String(e)))} style={fieldStyle}>重新整理紀錄</button>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {products.map(p => <label key={p.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))}/>
        {p.name} (#{p.id})
      </label>)}
    </div>
    {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {quotes.length > 0 && <select aria-label="歷史定價紀錄" style={fieldStyle} value={active?.id ?? ""} onChange={e => setActiveId(Number(e.target.value))}>
      {quotes.map(q => <option key={q.id} value={q.id}>#{q.id} · {q.group_id} · {q.selected_algorithm ? `已採用 ${q.selected_algorithm}` : "待選擇"}</option>)}
    </select>}
    {active && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
      {active.pricing_response.results.map(r => <div key={r.algorithm} style={{ border: "1px solid #dbe2ea", borderRadius: 12, padding: 18, display: "grid", gap: 12 }}>
        <h3>{r.algorithm === "cost_plus" ? "Cost Plus 成本加成" : r.algorithm === "ols_rr" ? "OLS + RR 模型定價" : r.algorithm}</h3>
        {r.prices ? <>
          {active.products_snapshot.map((p, i) => <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{p.name}</span><strong>{money(r.prices![i])}</strong>
          </div>)}
          {r.reason && <small style={{ color: "#64748b" }}>{r.reason}</small>}
          <button type="button" style={fieldStyle} disabled={busy || !!active.selected_algorithm} onClick={() => void choose(r.algorithm)}>
            {active.selected_algorithm === r.algorithm ? "已採用" : active.selected_algorithm ? "已選擇其他方案" : `採用 ${r.algorithm}`}
          </button>
        </> : <p style={{ color: "#64748b" }}>{r.error?.message ?? "目前無法使用"}</p>}
      </div>)}
    </div>}
  </section>;
}
