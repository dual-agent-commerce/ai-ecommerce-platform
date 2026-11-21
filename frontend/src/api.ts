/** 商家前端 API：僅保留現有 FastAPI 已支援的操作。 */
export const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export type Product = {
  id: number;
  name: string;
  cost: number;
  current_price: number | null;
  inventory: number;
  category?: string | null;
  brand?: string | null;
  specifications?: Record<string, unknown> | null;
};

export type ProductInput = Pick<Product, "name" | "cost" | "inventory"> & {
  category: string | null;
  brand: string | null;
  specifications: Record<string, unknown>;
};

export type PendingReview = {
  review_id: number;
  product_id: number;
  product_name: string;
  original_price: number;
  suggested_price: number;
  status: string;
  created_at?: string;
};

export type ListingJob = {
  id: number;
  review_id: number;
  product_id: number;
  approved_price: number;
  target_platform: string;
  status: "pending" | "processing" | "success" | "failed";
  platform_item_id: string | null;
  error_message: string | null;
  attempts: number;
  created_at?: string;
};

export type RecommendationResponse = {
  review_id: number;
  product_id: number;
  product_name: string;
  original_price: number;
  pricing_result: {
    suggested_price: number;
    method?: string;
    confidence?: number;
  };
  status: string;
};

export const money = (n: number | null | undefined) =>
  n == null ? "尚未定價" : `NT$${Number(n).toLocaleString("zh-TW")}`;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("目前無法連線，請稍後再試");
  }

  if (!response.ok) {
    let detail = `操作失敗（${response.status}）`;
    try {
      const body: { detail?: unknown } = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = "請檢查輸入的資料是否正確";
    } catch { /* 非 JSON 回應時保留 HTTP 訊息 */ }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const getProducts = () => api<Product[]>("/products");
export const createProduct = (data: ProductInput) => api<Product>("/products", { method: "POST", body: JSON.stringify(data) });
export const updateProductPrice = (id: number, price: number) => api<unknown>(`/products/${id}/price`, { method: "PATCH", body: JSON.stringify({ current_price: price }) });
export const deleteProduct = (id: number) => api<unknown>(`/products/${id}`, { method: "DELETE" });
export const getPendingReviews = () => api<PendingReview[]>("/workflow/pending");
export const createRecommendation = (productId: number) => api<RecommendationResponse>(`/workflow/${productId}`, { method: "POST" });
export const approveReview = (id: number, price: number) => api<unknown>(`/workflow/reviews/${id}/approve`, { method: "POST", body: JSON.stringify({ approved_price: price }) });
export const rejectReview = (id: number, reason: string) => api<unknown>(`/workflow/reviews/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
export const getListingJobs = () => api<ListingJob[]>("/listing-jobs");
export const executeJob = (id: number) => api<unknown>(`/listing-jobs/${id}/execute`, { method: "POST" });
export const retryJob = (id: number) => api<unknown>(`/listing-jobs/${id}/retry`, { method: "POST" });

// Sean 定價：只經由本平台 Backend 讀寫，保留原始價格與商品順序。
export type SeanPricingResult = {
  algorithm: string;
  prices?: number[];
  reason?: string;
  error?: { code: string; message: string; suggestion?: string };
  model_id?: string;
};
export type SeanQuote = {
  id: number;
  group_id: string;
  products_snapshot: Pick<Product, "id" | "name" | "cost" | "current_price">[];
  pricing_response: { group_id: string; results: SeanPricingResult[] };
  selected_algorithm: string | null;
  rejected_at?: string | null;
  created_at: string;
};
export const getSeanQuotes = () => api<SeanQuote[]>("/sean-pricing/quotes");
export const createSeanQuote = (group_id: string, product_ids: number[]) =>
  api<SeanQuote>("/sean-pricing/quotes", {
    method: "POST", body: JSON.stringify({ group_id, product_ids }),
  });
export const selectSeanQuote = (id: number, algorithm: string) =>
  api<{quote_id: number; algorithm: string}>(`/sean-pricing/quotes/${id}/select`, {
    method: "POST", body: JSON.stringify({ algorithm }),
  });

// 拒絕整組 Sean 定價：只更新審核狀態，不更動商品或上架工作。
export const rejectSeanQuote = (id: number) =>
  api<{quote_id: number; status: string}>(`/sean-pricing/quotes/${id}/reject`, { method: "POST" });

// ===== AI 定價商品組（同一商品組永遠只有一張管理卡片） =====
export type PriceGroupProduct = Pick<Product, "id" | "name" | "cost" | "current_price" | "inventory"> & { missing?: boolean };
export type PricingTrainingRun = {
  id: number;
  group_id: string;
  period: string | null;
  status: string;
  job_id: string | null;
  model_id: string | null;
  previous_model_id: string | null;
  missing: Array<{ check: string; have?: number; need?: number; message?: string; period?: string }> | null;
  created_at: string;
  completed_at: string | null;
};
export type PricingGroup = {
  group_id: string;
  name: string;
  product_ids: number[];
  products: PriceGroupProduct[];
  model_id: string | null;
  model_available: boolean;
  active_algorithm: string | null;
  active_quote_id: number | null;
  last_applied_at: string | null;
  last_train_status: string | null;
  last_train_period: string | null;
  last_train_missing: PricingTrainingRun["missing"];
  last_train_at: string | null;
  latest_training: PricingTrainingRun | null;
  latest_quote: SeanQuote | null;
  created_at: string;
};
export type PricingNotice = {
  id: number;
  group_id: string;
  kind: "model_ready" | "model_updated" | string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

export const getPricingGroups = () => api<PricingGroup[]>("/sean-pricing/groups");
export const createPricingGroup = (name: string, product_ids: number[]) =>
  api<PricingGroup>("/sean-pricing/groups", { method: "POST", body: JSON.stringify({ name, product_ids }) });
export const renamePricingGroup = (group_id: string, name: string) =>
  api<PricingGroup>(`/sean-pricing/groups/${encodeURIComponent(group_id)}`, {
    method: "PATCH", body: JSON.stringify({ name }),
  });
export const archivePricingGroup = (group_id: string) =>
  api<{ group_id: string; status: string }>(`/sean-pricing/groups/${encodeURIComponent(group_id)}/archive`, { method: "POST" });
export const getPricingGroupQuotes = (group_id: string) =>
  api<SeanQuote[]>(`/sean-pricing/groups/${encodeURIComponent(group_id)}/quotes`);
export const getPricingNotifications = () => api<PricingNotice[]>("/sean-pricing/notifications");
export const readPricingNotification = (id: number) =>
  api<{ id: number; status: string }>(`/sean-pricing/notifications/${id}/read`, { method: "POST" });
