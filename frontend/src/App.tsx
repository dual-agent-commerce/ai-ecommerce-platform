import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveReview, createProduct, createRecommendation, deleteProduct, executeJob,
  getListingJobs, getPendingReviews, getProducts, rejectReview, retryJob, updateProductPrice,
  getPricingNotifications, readPricingNotification, getPricingGroups,
  type ListingJob, type PendingReview, type Product, type ProductInput, type PricingNotice, type PricingGroup,
} from "./api";
import Icon from "./components/Icon";
import ProductDrawer from "./components/ProductDrawer";
import { Button, LoadingState } from "./components/UI";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Pricing from "./pages/Pricing";
import Listings from "./pages/Listings";
import ComingSoon from "./pages/ComingSoon";
import "./App.css";

type Page = "dashboard" | "products" | "pricing" | "listings" | "insights" | "categories" | "settings";
type Toast = { message: string; kind: "success" | "error" };

const menuGroups: { label: string; items: { id: Page; label: string; icon: string }[] }[] = [
  { label: "工作空間", items: [
    { id: "dashboard", label: "商店總覽", icon: "grid" },
    { id: "products", label: "商品管理", icon: "box" },
    { id: "pricing", label: "AI 智慧定價", icon: "sparkles" },
    { id: "listings", label: "商品上架", icon: "upload" },
  ] },
  { label: "更多功能", items: [
    { id: "insights", label: "市場分析", icon: "chart" },
    { id: "categories", label: "分類管理", icon: "layers" },
    { id: "settings", label: "設定", icon: "settings" },
  ] },
];
const pagePaths: Record<Page,string> = {dashboard:"/", products:"/products",pricing:"/pricing",listings:"/listings",insights:"/insights",categories:"/categories",settings:"/settings"};
const pageFromPath = (path:string): Page => (Object.entries(pagePaths).find(([,p])=>p===path.replace(/\/$/,"")||p===path)?.[0]??"dashboard") as Page;
const pageTitles: Record<Page,string> = {dashboard:"商店總覽",products:"商品管理",pricing:"AI 智慧定價",listings:"商品上架",insights:"市場分析",categories:"分類管理",settings:"設定"};

export default function App() {
  const [page,setPage] = useState<Page>(()=>pageFromPath(window.location.pathname));
  const [collapsed,setCollapsed] = useState(()=>window.localStorage.getItem("commerce-sidebar-collapsed")==="true");
  const [mobileNav,setMobileNav] = useState(false);
  const [products,setProducts] = useState<Product[]>([]);
  const [reviews,setReviews] = useState<PendingReview[]>([]);
  const [jobs,setJobs] = useState<ListingJob[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [toast,setToast] = useState<Toast|null>(null);
  const [drawer,setDrawer] = useState<null|{mode:"create"}|{mode:"detail";productId:number}>(null);
  const [deleteConfirm,setDeleteConfirm] = useState<Product|null>(null);
  const [prefillId,setPrefillId] = useState<number|null>(null);
  const [pricingNotices,setPricingNotices] = useState<PricingNotice[]>([]);
  const [pricingGroups,setPricingGroups] = useState<PricingGroup[]>([]);
  const pendingPricingGroups = pricingGroups.filter(g => g.latest_quote && !g.latest_quote.selected_algorithm && !g.latest_quote.rejected_at).length;
  const [notificationOpen,setNotificationOpen] = useState(false);
  const seenNotices = useRef<Set<number>>(new Set());
  const noticesLoaded = useRef(false);
  const unreadNotices = pricingNotices.filter(n => !n.read_at);

  useEffect(()=>{window.localStorage.setItem("commerce-sidebar-collapsed",String(collapsed));},[collapsed]);
  useEffect(()=>{const handler=()=>setPage(pageFromPath(window.location.pathname));window.addEventListener("popstate",handler);return()=>window.removeEventListener("popstate",handler);},[]);
  useEffect(()=>{if(!toast)return;const handle=window.setTimeout(()=>setToast(null),4600);return()=>window.clearTimeout(handle);},[toast]);

  const notify=useCallback((message:string,kind:Toast["kind"]="success")=>setToast({message,kind}),[]);

  const refreshNotices = useCallback(async () => {
    try {
      const list = await getPricingNotifications();
      if (noticesLoaded.current) {
        const fresh = list.filter(n => !n.read_at && !seenNotices.current.has(n.id));
        if (fresh.length) notify(fresh[0].title);
      }
      seenNotices.current = new Set(list.map(n => n.id));
      noticesLoaded.current = true;
      setPricingNotices(list);
    } catch { /* 不讓通知端點故障影響既有商品/上架頁 */ }
  },[notify]);

  useEffect(() => {
    void refreshNotices();
    const timer = window.setInterval(() => void refreshNotices(), 60000);
    return () => window.clearInterval(timer);
  },[refreshNotices]);

  async function openPricingNotice(notice: PricingNotice) {
    window.sessionStorage.setItem("pricing-target-group", notice.group_id);
    if (!notice.read_at) {
      try { await readPricingNotification(notice.id); await refreshNotices(); }
      catch { /* 使用者仍可開啟商品組 */ }
    }
    setNotificationOpen(false);
    navigate("pricing");
    window.dispatchEvent(new CustomEvent("pricing:focus-group", { detail: notice.group_id }));
  }

  const refreshAll=useCallback(async(showError=true)=>{
    const results=await Promise.allSettled([getProducts(),getPendingReviews(),getListingJobs(),getPricingGroups()]);
    if(results[0].status==="fulfilled")setProducts(results[0].value);
    if(results[1].status==="fulfilled")setReviews(results[1].value);
    if(results[2].status==="fulfilled")setJobs(results[2].value);
    if(results[3].status==="fulfilled")setPricingGroups(results[3].value);
    if(showError&&results.some(r=>r.status==="rejected"))notify("部分資料暫時無法載入，請稍後再試","error");
    setLoading(false);
  },[notify]);

  useEffect(()=>{void refreshAll();},[refreshAll]);
  useEffect(() => {
    const handlePricingChanged = () => { void refreshAll(false); };
    window.addEventListener("pricing:changed", handlePricingChanged);
    return () => window.removeEventListener("pricing:changed", handlePricingChanged);
  }, [refreshAll]);

  function navigate(id:string){
    const next=id as Page;
    if(!(next in pagePaths))return;
    if(window.location.pathname!==pagePaths[next])window.history.pushState({},"",pagePaths[next]);
    setPage(next);setMobileNav(false);window.scrollTo({top:0,behavior:"smooth"});
  }

  async function perform(task:()=>Promise<unknown>,successMessage:string):Promise<boolean>{
    if(busy)return false;
    setBusy(true);
    try{await task();await refreshAll(false);notify(successMessage);return true;}
    catch(e){notify(e instanceof Error?e.message:"操作未完成，請稍後再試","error");await refreshAll(false);return false;}
    finally{setBusy(false);}
  }

  async function addProduct(data:ProductInput){return perform(()=>createProduct(data),"商品建立成功");}
  async function changePrice(id:number,price:number){return perform(()=>updateProductPrice(id,price),"商品售價已更新");}
  async function makeRecommendation(id:number){return perform(()=>createRecommendation(id),"新的定價建議已產生");}
  async function approve(review:PendingReview,price:number){return perform(()=>approveReview(review.review_id,price),"價格已核准，上架作業已建立");}
  async function reject(review:PendingReview,reason:string){return perform(()=>rejectReview(review.review_id,reason),"已記錄你的決定");}
  async function execute(job:ListingJob){return perform(()=>executeJob(job.id),"上架作業已處理");}
  async function retry(job:ListingJob){return perform(()=>retryJob(job.id),"已重新排入上架作業");}

  function goPricing(id:number){setDrawer(null);setPrefillId(id);navigate("pricing");}
  function confirmDelete(product:Product){setDrawer(null);setDeleteConfirm(product);}
  async function removeProduct(){
    if(!deleteConfirm)return;
    const ok=await perform(()=>deleteProduct(deleteConfirm.id),"商品已刪除");
    if(ok)setDeleteConfirm(null);
  }

  const currentDrawerProduct=drawer?.mode==="detail"?products.find(p=>p.id===drawer.productId)??null:null;

  return <div className={`app-shell ${collapsed?"sidebar-collapsed":""}`}>
    {mobileNav&&<div className="mobile-scrim" onClick={()=>setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav?"mobile-open":""}`} aria-label="主要導覽">
      <div className="brand-row"><div className="brand-mark"><Icon name="layers" size={23} strokeWidth={2}/></div><div className="brand-copy"><strong>Commerce</strong><span>商家管理平台</span></div><button className="mobile-nav-close icon-button" aria-label="關閉選單" onClick={()=>setMobileNav(false)}><Icon name="close"/></button></div>
      <div className="nav-area">{menuGroups.map(group=><div className="nav-group" key={group.label}><div className="nav-group-label">{group.label}</div><div className="nav-items">{group.items.map(item=><button title={collapsed?item.label:undefined} key={item.id} className={`nav-item ${page===item.id?"nav-active":""}`} onClick={()=>navigate(item.id)} aria-current={page===item.id?"page":undefined}><Icon name={item.icon} size={20}/><span className="nav-label">{item.label}</span>{item.id==="pricing"&&unreadNotices.length>0&&<span className="nav-count">{unreadNotices.length}</span>}</button>)}</div></div>)}</div>
      <div className="sidebar-bottom"><button className="collapse-button" onClick={()=>setCollapsed(v=>!v)} aria-label={collapsed?"展開側邊欄":"收合側邊欄"}><Icon name={collapsed?"chevronRight":"chevronLeft"} size={17}/><span>{collapsed?"":"收合選單"}</span></button></div>
    </aside>
    <div className="app-main">
      <header className="topbar"><div className="topbar-left"><button className="topbar-menu icon-button" aria-label="開啟導覽列" onClick={()=>setMobileNav(true)}><Icon name="menu"/></button><div className="breadcrumb"><span>工作空間</span><Icon name="chevronRight" size={14}/><strong>{pageTitles[page]}</strong></div></div><div className="topbar-right"><span className="today-label">{new Date().toLocaleDateString("zh-TW",{month:"long",day:"numeric",weekday:"short"})}</span><div className="gp-bell-wrap">
        <button type="button" className="gp-bell-button" aria-label={`模型訓練通知，${unreadNotices.length} 則未讀`} title="模型訓練通知"
          aria-expanded={notificationOpen} onClick={() => setNotificationOpen(v => !v)}>
          <span aria-hidden="true">🔔</span>{unreadNotices.length > 0 && <span className="gp-bell-count">{unreadNotices.length}</span>}
        </button>
        {notificationOpen && <div className="gp-notice-popover" role="region" aria-label="模型訓練通知">
          <div className="gp-notice-head"><strong>模型訓練通知</strong><button type="button" onClick={() => setNotificationOpen(false)}>×</button></div>
          {pricingNotices.length === 0 ? <p className="gp-no-notice">還沒有訓練完成通知。模型完成後會在這裡提醒。</p>
            : pricingNotices.slice(0, 12).map(n => <button type="button" key={n.id} className={`gp-notice-row ${!n.read_at ? "unread" : ""}`} onClick={() => void openPricingNotice(n)}>
              <strong>{n.title}</strong><span>{n.message}</span><small>{new Date(n.created_at).toLocaleString("zh-TW")}</small>
            </button>)}
        </div>}
      </div><button className="topbar-refresh icon-button" aria-label="重新整理資料" title="重新整理資料" onClick={()=>void refreshAll()}><Icon name="refresh" size={18}/></button><span className="topbar-avatar" aria-label="商家帳號">店</span></div></header>
      <main className="main-content" key={page}>
        {loading?<LoadingState/>:page==="dashboard"?<Dashboard products={products} reviews={reviews} pricingPending={pendingPricingGroups} jobs={jobs} navigate={navigate} openCreate={()=>setDrawer({mode:"create"})}/>
        :page==="products"?<Products products={products} openCreate={()=>setDrawer({mode:"create"})} openDetails={p=>setDrawer({mode:"detail",productId:p.id})} onPricing={goPricing}/>
        :page==="pricing"?<Pricing products={products} reviews={reviews} busy={busy} onCreateRecommendation={makeRecommendation} onApprove={approve} onReject={reject} suggestedProductId={prefillId} onSeanApplied={() => refreshAll(false)}/>
        :page==="listings"?<Listings products={products} jobs={jobs} busy={busy} onExecute={execute} onRetry={retry}/>
        :page==="insights"?<ComingSoon title="市場分析" description="透過市場動態，探索更多商品營運機會。" icon="chart" navigate={navigate}/>
        :page==="categories"?<ComingSoon title="分類管理" description="打造符合商店需求的商品分類與規格模板。" icon="layers" navigate={navigate}/>
        :<ComingSoon title="設定" description="打造更符合你工作習慣的商店管理環境。" icon="settings" navigate={navigate}/>}
      </main>
      <footer className="app-footer"><span>Commerce Workspace</span><span>讓商品管理變得簡單</span></footer>
    </div>
    {drawer&&<ProductDrawer mode={drawer.mode} product={currentDrawerProduct} busy={busy} onClose={()=>setDrawer(null)} onCreate={addProduct} onUpdatePrice={changePrice} onDelete={confirmDelete} onPricing={goPricing}/>}
    {deleteConfirm&&<div className="modal-backdrop"><div className="confirm-modal" role="dialog" aria-modal="true" aria-label="刪除商品"><span className="modal-icon danger-modal-icon"><Icon name="trash" size={22}/></span><h2>確定刪除商品？</h2><p>「{deleteConfirm.name}」刪除後將無法復原。請確認是否繼續。</p><div className="decision-buttons"><Button variant="outline" disabled={busy} onClick={()=>setDeleteConfirm(null)}>取消</Button><Button variant="danger" disabled={busy} onClick={()=>void removeProduct()}>{busy?"處理中...":"刪除商品"}</Button></div></div></div>}
    {toast&&<div role="status" className={`toast toast-${toast.kind}`}><span className="toast-icon"><Icon name={toast.kind==="success"?"checkCircle":"alert"} size={19}/></span><span>{toast.message}</span><button className="icon-button" aria-label="關閉通知" onClick={()=>setToast(null)}><Icon name="close" size={16}/></button></div>}
  </div>;
}
