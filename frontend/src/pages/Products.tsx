import { useMemo, useState } from "react";
import type { Product } from "../api";
import { money } from "../api";
import Icon from "../components/Icon";
import { Badge, Button, EmptyState, PageHeading } from "../components/UI";

export default function Products({ products, openCreate, openDetails, onPricing }: { products: Product[]; openCreate: ()=>void; openDetails: (product:Product)=>void; onPricing:(id:number)=>void }) {
  const [search,setSearch] = useState("");
  const [category,setCategory] = useState("all");
  const [menu,setMenu] = useState<number|null>(null);
  const categories = useMemo(()=>[...new Set(products.map(p=>p.category?.trim()).filter((c):c is string=>Boolean(c)))].sort(),[products]);
  const filtered = useMemo(()=>products.filter(p => (category==="all"||p.category===category) && (`${p.name} ${p.brand||""} ${p.id}`).toLowerCase().includes(search.toLowerCase())),[products,search,category]);
  return <div className="page-stack" onClick={()=>{ if(menu!==null) setMenu(null); }}>
    <PageHeading eyebrow="CATALOG" title="商品管理" description="在同一個地方整理你的所有商品。" action={<Button icon="plus" onClick={openCreate}>新增商品</Button>}/>
    <section className="surface-card product-surface animate-enter" style={{animationDelay:"75ms"}}>
      <div className="table-toolbar"><div className="toolbar-intro"><h2>全部商品 <span className="count-pill">{products.length}</span></h2><p>管理價格、庫存及商品資訊</p></div><div className="toolbar-filters"><div className="search-field"><Icon name="search" size={18}/><input aria-label="搜尋商品" placeholder="搜尋商品名稱、品牌或編號" value={search} onChange={e=>setSearch(e.target.value)}/>{search && <button aria-label="清除搜尋" className="clear-search" onClick={()=>setSearch("")}><Icon name="close" size={15}/></button>}</div><div className="select-wrapper"><Icon name="filter" size={16}/><select aria-label="篩選分類" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">所有分類</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select><Icon name="chevronDown" size={15}/></div></div></div>
      {filtered.length === 0 ? <EmptyState icon="search" title={products.length===0?"還沒有商品":"沒有符合條件的商品"} detail={products.length===0?"建立你的第一件商品，就可以開始管理定價與庫存。":"試試其他關鍵字，或清除目前的篩選條件。"} action={products.length===0?<Button onClick={openCreate} icon="plus">新增商品</Button>:<Button variant="outline" onClick={()=>{setSearch("");setCategory("all");}}>清除篩選</Button>}/> : <div className="data-table-scroll"><table className="data-table"><thead><tr><th>商品資訊</th><th>分類 / 品牌</th><th>進貨成本</th><th>目前售價</th><th>庫存</th><th aria-label="操作"/></tr></thead><tbody>{filtered.map(p=><tr key={p.id}><td><button className="product-name-button" onClick={()=>openDetails(p)}><span className="product-symbol"><Icon name="box" size={19}/></span><span className="product-title"><strong>{p.name}</strong><small>#{p.id}</small></span></button></td><td><div className="cell-stack"><span>{p.category||"未分類"}</span><small>{p.brand||"—"}</small></div></td><td className="numeric-cell">{money(p.cost)}</td><td className="numeric-cell price-strong">{money(p.current_price)}</td><td><Badge tone={p.inventory===0?"red":p.inventory<=5?"amber":"green"}>{p.inventory===0?"無庫存":p.inventory<=5?`庫存偏低 · ${p.inventory}`:`${p.inventory} 件`}</Badge></td><td className="row-menu-cell"><button className="icon-button row-dots" aria-label={`${p.name} 的更多操作`} aria-expanded={menu===p.id} onClick={e=>{e.stopPropagation();setMenu(menu===p.id?null:p.id);}}><Icon name="ellipsis" size={20}/></button>{menu===p.id && <div className="row-menu" onClick={e=>e.stopPropagation()}><button onClick={()=>{setMenu(null);openDetails(p);}}><Icon name="edit" size={16}/> 查看 / 編輯價格</button><button onClick={()=>{setMenu(null);onPricing(p.id);}}><Icon name="sparkles" size={16}/> 前往 AI 定價商品組</button></div>}</td></tr>)}</tbody></table></div>}
      {filtered.length>0 && <div className="table-footer">顯示 {filtered.length} / {products.length} 件商品</div>}
    </section>
  </div>;
}
