import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { money, type Product, type ProductInput } from "../api";
import { Button } from "./UI";
import Icon from "./Icon";

type Props = {
  product: Product | null;
  mode: "create" | "detail";
  busy: boolean;
  onClose: () => void;
  onCreate: (data: ProductInput) => Promise<boolean>;
  onUpdatePrice: (id: number, price: number) => Promise<boolean>;
  onDelete: (product: Product) => void;
  onPricing: (id: number) => void;
};

const initial = { name: "", category: "", brand: "", cost: "", inventory: "" };

export default function ProductDrawer({ product, mode, busy, onClose, onCreate, onUpdatePrice, onDelete, onPricing }: Props) {
  const [form, setForm] = useState(initial);
  const [editingPrice, setEditingPrice] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [validation, setValidation] = useState("");

  useEffect(() => { setForm(initial); setEditingPrice(false); setNewPrice(String(product?.current_price ?? "")); setValidation(""); }, [mode, product]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; };
  }, [busy, onClose]);

  const set = (key: keyof typeof form, val: string) => setForm(p => ({ ...p, [key]: val }));
  const validNumber = (n: string) => n.trim() !== "" && Number.isSafeInteger(Number(n)) && Number(n) >= 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !validNumber(form.cost) || !validNumber(form.inventory)) {
      setValidation("請確認商品名稱、成本與庫存皆已正確填寫"); return;
    }
    setValidation("");
    const ok = await onCreate({
      name: form.name.trim(), category: form.category.trim() || null, brand: form.brand.trim() || null,
      cost: Number(form.cost), inventory: Number(form.inventory),
      specifications: {},
    });
    if (ok) onClose();
  }

  async function savePrice() {
    if (!product) return;
    if (!validNumber(newPrice)) { setValidation("售價必須是 0 以上的整數"); return; }
    setValidation("");
    const ok = await onUpdatePrice(product.id, Number(newPrice));
    if (ok) { setEditingPrice(false); onClose(); }
  }

  return <div className={`drawer-backdrop ${mode === "create" ? "create-modal-backdrop" : ""}`} onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <aside className={`drawer ${mode === "create" ? "product-create-modal" : ""}`} role="dialog" aria-modal="true" aria-label={mode === "create" ? "新增商品" : "商品詳情"}>
      <div className="drawer-header"><div><div className="eyebrow">PRODUCT CENTER</div><h2>{mode === "create" ? "新增商品" : "商品詳情"}</h2><p>{mode === "create" ? "填寫商品基本資訊，開始管理你的商品" : `商品編號 #${product?.id ?? ""}`}</p></div><button className="icon-button" aria-label="關閉" onClick={onClose} disabled={busy}><Icon name="close"/></button></div>
      {mode === "create" ? <form id="create-product-form" className="drawer-body" onSubmit={submit}>
        <div className="form-section-title">基本資訊</div>
        <label className="field-label">商品名稱 <span className="required">*</span><input autoFocus value={form.name} onChange={e=>set("name",e.target.value)} placeholder="例如：ASUS Vivobook 15" required /></label>
        <div className="field-grid"><label className="field-label">商品分類<input value={form.category} onChange={e=>set("category",e.target.value)} placeholder="例如：筆記型電腦" /></label><label className="field-label">品牌<input value={form.brand} onChange={e=>set("brand",e.target.value)} placeholder="例如：ASUS" /></label></div>
        <div className="field-hint">商品分類與詳細規格模板將於後續版本開放。</div>
        <div className="form-divider"/><div className="form-section-title">價格與庫存</div>
        <label className="field-label">進貨成本 <span className="required">*</span><div className="input-prefix"><span>NT$</span><input type="number" min="0" step="1" value={form.cost} onChange={e=>set("cost",e.target.value)} placeholder="0" required /></div></label>
        <div className="baseline-notice">
        <Icon name="sparkles" size={18}/>
        <div>
        <strong>商品售價可稍後設定</strong>
        <span>建立商品後，可透過 AI 定價取得建議售價，確認採用後才會更新商品價格。</span>
        </div>
        </div>
        <label className="field-label">庫存數量 <span className="required">*</span><input type="number" min="0" step="1" value={form.inventory} onChange={e=>set("inventory",e.target.value)} placeholder="0" required /></label>
        {validation && <div className="form-error">{validation}</div>}
      </form> : product && <div className="drawer-body">
        <div className="product-avatar-large"><Icon name="box" size={30}/></div><h3 className="detail-product-name">{product.name}</h3>
        <p className="detail-product-meta">{[product.category,product.brand].filter(Boolean).join(" · ") || "尚未設定分類與品牌"}</p>
        <div className="form-divider"/><div className="form-section-title">商品資訊</div>
        <div className="detail-row">
        <span>商品售價</span>
        <strong>
        {product.current_price == null
        ? "尚未定價"
        : money(product.current_price)}
        </strong>
        </div>
        <div className="detail-row"><span>進貨成本</span><strong>{money(product.cost)}</strong></div>
        <div className="detail-row"><span>庫存數量</span><strong>{product.inventory} 件</strong></div>
        {product.specifications && Object.keys(product.specifications).length > 0 && <><div className="form-divider"/><div className="form-section-title">詳細規格</div>{Object.entries(product.specifications).map(([key, value]) => <div className="detail-row" key={key}><span>{key.replaceAll("_", " ")}</span><strong>{Array.isArray(value) ? value.join("、") : value && typeof value === "object" ? Object.entries(value).map(([k, v]) => `${k}: ${String(v)}`).join("、") : String(value)}</strong></div>)}</>}
        <div className="form-divider"/>
        {editingPrice ? <div className="price-editor"><label className="field-label">設定新售價<div className="input-prefix"><span>NT$</span><input autoFocus type="number" min="0" step="1" value={newPrice} onChange={e=>setNewPrice(e.target.value)} /></div></label>{validation && <div className="form-error">{validation}</div>}<div className="row-gap"><Button variant="outline" onClick={()=>{setEditingPrice(false);setValidation("");}}>取消</Button><Button onClick={()=>void savePrice()} disabled={busy}>{busy ? "儲存中..." : "儲存售價"}</Button></div></div> : <div className="detail-actions"><Button variant="outline" icon="edit" onClick={()=>setEditingPrice(true)}>修改售價</Button><Button variant="outline" icon="sparkles" onClick={()=>onPricing(product.id)}>前往 AI 定價商品組</Button></div>}
        <button className="text-danger-action" onClick={()=>onDelete(product)}><Icon name="trash" size={16}/> 刪除商品</button>
      </div>}
      {mode === "create" && <div className="drawer-footer"><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button type="submit" form="create-product-form" disabled={busy}>{busy ? "建立中..." : "建立商品"}<Icon name="arrowRight" size={16}/></Button></div>}
    </aside>
  </div>;
}
