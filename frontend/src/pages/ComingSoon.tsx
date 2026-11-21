import Icon from "../components/Icon";
import { Badge, Button, PageHeading } from "../components/UI";
export default function ComingSoon({ title, description, icon, navigate }: {title:string;description:string;icon:string;navigate:(page:string)=>void}){
  return <div className="page-stack"><PageHeading eyebrow="COMING SOON" title={title} description={description}/><section className="coming-soon-card animate-enter"><div className="coming-decoration deco-one"/><div className="coming-decoration deco-two"/><div className="coming-icon"><Icon name={icon} size={34}/></div><Badge tone="blue">持續開發中</Badge><h2>更多精彩功能，即將推出。</h2><p>這個工作區正在準備中。你可以先使用商品管理、AI 智慧定價和商品上架功能。</p><Button icon="arrowRight" onClick={()=>navigate("dashboard")}>返回商店總覽</Button></section></div>;
}
