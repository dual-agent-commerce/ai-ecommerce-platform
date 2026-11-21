import { useCallback, useEffect, useState } from "react";
import {
  approveReview, executeJob, getListingJobs, getPendingReviews,
  rejectReview, retryJob,
} from "../api";
import type { ListingJob, PendingReview } from "../api";

const money = (n: number) => `NT$${n.toLocaleString("zh-TW")}`;

type Props = { onPriceChanged: () => void };

export default function PricingReview({ onPriceChanged }: Props) {
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [jobs, setJobs] = useState<ListingJob[]>([]);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [nextReviews, nextJobs] = await Promise.all([
      getPendingReviews(), getListingJobs(),
    ]);
    setReviews(nextReviews);
    setJobs(nextJobs);
    setPrices((prev) => {
      const updated = { ...prev };
      for (const review of nextReviews) {
        if (updated[review.review_id] === undefined) {
          updated[review.review_id] = String(review.suggested_price);
        }
      }
      return updated;
    });
  }, []);

  useEffect(() => {
    void refresh().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "資料載入失敗")
    ).finally(() => setLoading(false));
  }, [refresh]);

  async function run(key: string, action: () => Promise<unknown>, priceChanged = false) {
    if (busy) return;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      if (priceChanged) onPriceChanged();
      setMessage("操作成功，資料已更新");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
      // Re-fetch in case the server completed the action but the client lost the response.
      try { await refresh(); } catch { /* Keep original error. */ }
    } finally {
      setBusy(null);
    }
  }

  function approve(review: PendingReview) {
    const raw = prices[review.review_id] ?? String(review.suggested_price);
    const price = Number(raw);
    if (raw.trim() === "" || !Number.isSafeInteger(price) || price < 0) {
      setError("核准價格必須是非負整數");
      return;
    }
    void run(`review-${review.review_id}`,
      () => approveReview(review.review_id, price), true);
  }

  function reject(review: PendingReview) {
    const reason = (reasons[review.review_id] ?? "").trim();
    if (!reason) {
      setError("請先填寫拒絕原因");
      return;
    }
    void run(`review-${review.review_id}`,
      () => rejectReview(review.review_id, reason));
  }

  return (
    <section className="panel review-section" id="pricing-reviews">
      <div className="section-heading">
        <div>
          <h2>AI 定價人工審核</h2>
          <p>確認 Agent 1 建議後，再建立 Agent 2 上架工作</p>
        </div>
        <button className="secondary-button" disabled={busy !== null}
          onClick={() => void run("refresh", refresh)}>重新整理</button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      {loading ? <p>讀取中...</p> : reviews.length === 0 ? (
        <p className="empty-state">目前沒有待審核建議。請先在上方執行 AI Workflow，再按「重新整理」。</p>
      ) : (
        <div className="review-grid">
          {reviews.map((review) => (
            <article className="review-card" key={review.review_id}>
              <div className="review-card-heading">
                <strong>{review.product_name}</strong>
                <span className="review-tag">待審核 #{review.review_id}</span>
              </div>
              <div className="review-prices">
                <div><span>目前售價</span><strong>{money(review.original_price)}</strong></div>
                <div><span>AI 建議</span><strong>{money(review.suggested_price)}</strong></div>
              </div>
              <label className="review-field">人工核准價格
                <input type="number" min="0" step="1"
                  value={prices[review.review_id] ?? String(review.suggested_price)}
                  onChange={(e) => setPrices((prev) => ({ ...prev, [review.review_id]: e.target.value }))} />
              </label>
              <label className="review-field">拒絕原因（拒絕時必填）
                <textarea rows={2} placeholder="例如：建議價格過高"
                  value={reasons[review.review_id] ?? ""}
                  onChange={(e) => setReasons((prev) => ({ ...prev, [review.review_id]: e.target.value }))} />
              </label>
              <div className="review-actions">
                <button className="danger-button" disabled={busy !== null}
                  onClick={() => reject(review)}>拒絕</button>
                <button className="primary-button" disabled={busy !== null}
                  onClick={() => approve(review)}>核准價格</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="section-heading listing-heading">
        <div>
          <h2>Agent 2 上架工作</h2>
          <p>核准後產生 pending 工作；點擊執行才會呼叫 Mock Agent 2</p>
        </div>
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th>Job ID</th><th>商品 ID</th><th>核准價格</th><th>平台</th><th>狀態</th><th>結果 / 錯誤</th><th>操作</th></tr></thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr><td colSpan={7} className="empty-state">目前沒有上架工作</td></tr>
            ) : jobs.map((job) => (
              <tr key={job.id}>
                <td>#{job.id}</td><td>{job.product_id}</td>
                <td>{money(job.approved_price)}</td><td>{job.target_platform}</td>
                <td><span className={`job-status job-${job.status}`}>{job.status}</span></td>
                <td>{job.platform_item_id || job.error_message || "—"}</td>
                <td>
                  {job.status === "pending" && (
                    <button className="primary-button" disabled={busy !== null}
                      onClick={() => void run(`job-${job.id}`, () => executeJob(job.id))}>執行上架</button>
                  )}
                  {job.status === "failed" && (
                    <button className="secondary-button" disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm("請先確認平台上沒有成功發布此商品。確定重新排入工作？")) {
                          void run(`job-${job.id}`, () => retryJob(job.id));
                        }
                      }}>重試前確認</button>
                  )}
                  {job.status === "success" && "已完成"}
                  {job.status === "processing" && "執行中"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="workflow-note">提醒：Mock Agent 2 不代表真實平台已發布。真實平台重試前需確認是否已上架，避免重複商品。</p>
    </section>
  );
}
