import type { ListingJob, PendingReview, Product } from "../api";
import { money } from "../api";
import Icon from "../components/Icon";
import { Badge, Button, EmptyState, PageHeading } from "../components/UI";

type Props = {
  products: Product[]; reviews?: PendingReview[]; pricingPending: number; jobs: ListingJob[];
  navigate: (page: string) => void; openCreate: () => void;
};

export default function Dashboard({ products, pricingPending, jobs, navigate, openCreate }: Props) {
  const pendingJobs = jobs.filter(j => j.status === "pending").length;
  const failedJobs = jobs.filter(j => j.status === "failed").length;
  const stats = [
    { title: "商品總數", value: products.length, note: "目前管理中的商品", icon: "box", tint: "blue" },
    { title: "待確認商品組", value: pricingPending, note: "Sean 最新定價方案", icon: "sparkles", tint: "violet" },
    { title: "等待上架", value: pendingJobs, note: "尚未開始的任務", icon: "upload", tint: "sky" },
    { title: "需要關注", value: failedJobs, note: "未完成的上架任務", icon: "alert", tint: "rose" },
  ];
  return <div className="page-stack">
    <PageHeading eyebrow="OVERVIEW" title="商店總覽" description="掌握商品動態，從這裡開始今天的工作。" action={<Button icon="plus" onClick={openCreate}>新增商品</Button>}/>
    <section className="welcome-banner animate-enter" style={{ animationDelay: "40ms" }}>
      <div className="welcome-copy"><span className="welcome-overline"><span className="live-dot"/> YOUR WORKSPACE</span><h2>讓每一次商品決策，<br/>都更簡單。</h2><p>管理商品、確認智慧定價建議，讓營運流程井然有序。</p><Button icon="arrowRight" className="welcome-button" onClick={()=>navigate("pricing")}>前往 AI 定價</Button></div>
      <div className="welcome-illustration" aria-hidden="true"><div className="illustration-ring ring-one"/><div className="illustration-ring ring-two"/><div className="floating-tile floating-tile-main"><Icon name="chart" size={39}/></div><div className="floating-tile floating-tile-small"><Icon name="check" size={23}/></div><div className="illustration-dot dot-a"/><div className="illustration-dot dot-b"/></div>
    </section>
    <section className="stats-grid animate-enter" style={{ animationDelay: "85ms" }} aria-label="營運統計">
      {stats.map(s => <div key={s.title} className="stat-card"><div className="stat-top"><span>{s.title}</span><span className={`stat-icon tint-${s.tint}`}><Icon name={s.icon} size={19}/></span></div><div className="stat-value">{s.value.toLocaleString()}</div><div className="stat-note">{s.note}</div></div>)}
    </section>
    <div className="dashboard-columns animate-enter" style={{ animationDelay: "140ms" }}>
      <section className="surface-card task-card"><div className="card-heading"><div><h2>待處理事項</h2><p>優先完成需要你確認的工作</p></div><Icon name="lightning" size={20}/></div>
        {pricingPending === 0 && pendingJobs === 0 && failedJobs === 0 ? <EmptyState icon="checkCircle" title="目前沒有待處理事項" detail="一切都已整理妥當，隨時可以開始新的工作。"/> : <div className="task-list">
          {pricingPending > 0 && <button className="task-row" onClick={()=>navigate("pricing")}><span className="task-icon task-blue"><Icon name="sparkles"/></span><span className="task-copy"><strong>{pricingPending} 個商品組等待確認定價</strong><small>查看建議並確認最終售價</small></span><Icon name="chevronRight" size={18}/></button>}
          {pendingJobs > 0 && <button className="task-row" onClick={()=>navigate("listings")}><span className="task-icon task-indigo"><Icon name="upload"/></span><span className="task-copy"><strong>{pendingJobs} 筆商品等待上架</strong><small>確認商品並開始上架作業</small></span><Icon name="chevronRight" size={18}/></button>}
          {failedJobs > 0 && <button className="task-row" onClick={()=>navigate("listings")}><span className="task-icon task-red"><Icon name="alert"/></span><span className="task-copy"><strong>{failedJobs} 筆上架作業需要關注</strong><small>查看執行狀態與詳細資訊</small></span><Icon name="chevronRight" size={18}/></button>}
        </div>}
      </section>
      <section className="surface-card recent-card"><div className="card-heading"><div><h2>最近商品</h2><p>快速檢視最新加入的商品</p></div><button className="link-button" onClick={()=>navigate("products")}>查看全部 <Icon name="arrowRight" size={15}/></button></div>
        {products.length === 0 ? <EmptyState icon="box" title="還沒有商品" detail="新增第一件商品，開始管理你的商店。" action={<Button variant="outline" icon="plus" onClick={openCreate}>新增商品</Button>}/> : <div className="recent-list">{[...products].sort((a,b)=>b.id-a.id).slice(0,4).map(product=><div className="recent-item" key={product.id}><span className="product-symbol"><Icon name="box" size={18}/></span><div className="recent-name"><strong>{product.name}</strong><small>{product.category || product.brand || `商品 #${product.id}`}</small></div><strong className="recent-price">{money(product.current_price)}</strong></div>)}</div>}
      </section>
    </div>
    <div className="dashboard-footnote"><Icon name="checkCircle" size={16}/> 所有數據皆取自目前商店資料</div>
  </div>;
}
